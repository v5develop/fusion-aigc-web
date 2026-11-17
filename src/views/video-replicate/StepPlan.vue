<script setup lang="ts">
/**
 * 第三步：选要换的 → 方案卡（改什么 / 拆几段 / 用哪个模型 / 费用）→ 确认。
 * 多段默认「先做第 1 段」（满意后再继续，其余段现在不收）；点数只来自后端报价，报价中 / 失败显示「—」，不拿前端估算顶上。
 * 文案取自 EXPERIENCE §4.5 / 4.6，不出现「维度 / 重叠 / 冻结」等内部词。
 * 编辑先只改本地，停手 1.5 秒或点「更新报价」才在当前方案上改出一张新方案（提交中再改则合并到下一次）（EXPERIENCE §3.4.1）；缺图可以在行内直接放；方案出来后可「保存为我的方案」（§3.9.2）。
 */
import { NModal } from 'naive-ui'
import { CONFIRM_THRESHOLD_POINTS, type ReplicateAudio } from '@/api/replicate.ts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hasBillingPage, openBillingPage } from '@/utils/billing.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { DIM_SLOT, INTENTS, SLOTS, fmtPts, mm, type SlotKey } from './constants.ts'
import QuoteBlock from './parts/QuoteBlock.vue'
import ContinuityPicker from './parts/ContinuityPicker.vue'
import type { useReplicate } from './useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const rep = props.rep
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const MODES = [
  { key: 'keep', label: '不改' },
  { key: 'replace', label: '换成我的图' },
  { key: 'describe', label: '按我写的改' },
] as const

const plan = computed(() => rep.plan.value)
const q = computed(() => plan.value?.cost ?? null)
const summary = computed(() => {
  if (plan.value?.overview) return plan.value.overview
  const names = INTENTS.filter((i) => rep.intentOn(i)).map((i) => i.label)
  return names.join(' · ') || '还没选要换的地方'
})
const staged = computed(() => rep.stage.value === 'first' && rep.multiSegment.value)
const segs = computed(() => plan.value?.timeline.segments ?? [])
const segCount = computed(() => segs.value.length)
const eta = computed(() => {
  const e = plan.value?.eta
  if (!e) return ''
  return (staged.value ? e.first : e.total)?.text ?? e.total.text
})

// 报价有效期倒计时
const nowTs = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => (tick = setInterval(() => (nowTs.value = Date.now()), 1000)))
onBeforeUnmount(() => clearInterval(tick))
const leftSec = computed(() => {
  const v = q.value?.validUntil
  return v ? Math.round((new Date(v).getTime() - nowTs.value) / 1000) : null
})
const expired = computed(() => leftSec.value != null && leftSec.value <= 0)
/** 提交被拒是方案过期（PLAN_EXPIRED 文案里带「重新生成方案」）：给个按钮 */
const expiredPlan = computed(() => rep.submitError.value.includes('重新生成方案'))

// 主按钮：与方案默认确认方式一致时用后端给的文案；用户切了确认方式，数字仍取后端 stageQuotes
const buttonText = computed(() => {
  if (rep.submitting.value) return '正在提交…'
  if (rep.planBusy.value) return '正在更新报价…'
  if (rep.planDirty.value) return '先更新报价'
  if (rep.shortfall.value > 0) return hasBillingPage() ? '点数不够，去充值' : '点数不足'
  const p = plan.value
  if (!p) return rep.planBusy.value ? '正在算价格…' : '确认并生成'
  if (rep.stage.value === p.cost.defaultStage) return p.confirmButton
  if (rep.needPoints.value <= 0) return '价格还没出来'
  return staged.value ? `先做第 1 段（${fmtPts(rep.needPoints.value)} 点）` : `确认并生成（${fmtPts(rep.needPoints.value)} 点）`
})

// 行内放图（从示例 / 我的方案进来时没经过上一步的放图区）
const slotInputs = ref<Partial<Record<SlotKey, HTMLInputElement>>>({})
const assetImageOpen = ref(false)
const assetSlot = ref<SlotKey | null>(null)
function openSlotAsset(k: SlotKey) {
  assetSlot.value = k
  assetImageOpen.value = true
}
function onAssetSlot(urls: string[]) {
  const u = urls[0]
  const k = assetSlot.value
  if (!u || !k) return
  rep.pickSlotAsset(k, u, SLOTS.find((s) => s.key === k)?.label ?? '图片')
}
function onSlot(k: SlotKey, e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void rep.pickSlotImage(k, f)
  ;(e.target as HTMLInputElement).value = ''
}

// 保存为我的方案：一次点击用默认名保存，保存后可以就地改名再存
const nameDraft = ref('')
watch(
  () => rep.savedPlan.value?.name,
  (n) => (nameDraft.value = n ?? ''),
)
const renameDirty = computed(() => rep.planSaved.value && !!nameDraft.value.trim() && nameDraft.value.trim() !== rep.savedPlan.value?.name)

function onConfirm() {
  if (rep.shortfall.value > 0) {
    if (hasBillingPage()) openBillingPage()
    return
  }
  if (expired.value) return void rep.refreshQuote()
  if (rep.needPoints.value <= 0) return
  // 本次总价超过阈值：先二次确认，不超不弹
  if (needSecondConfirm.value) {
    confirmOpen.value = true
    return
  }
  void rep.confirm()
}

// 二次确认：阈值取后端 limits 下发的，缺省用前端常量
const threshold = computed(() => rep.limits.value?.confirmThresholdPoints ?? CONFIRM_THRESHOLD_POINTS)
/** 本次要花的点数：先做第 1 段 = 第 1 段报价，否则 = 总价 */
const spendNow = computed(() => rep.needPoints.value)
const pricePending = computed(() => !!plan.value && rep.needPoints.value <= 0)
/** 本次生成的段数：先做第 1 段 = 1 段 */
const spendSegs = computed(() => (staged.value ? 1 : Math.max(segCount.value, 1)))
const needSecondConfirm = computed(() => spendNow.value > threshold.value)
const confirmOpen = ref(false)
function doConfirm() {
  confirmOpen.value = false
  void rep.confirm()
}

/** 声音选项：「换个声音」只在对话里设置（音色 / 台词），独立页只在方案本来就是它时显示，保持不丢 */
const audioOptions = computed<{ k: ReplicateAudio; l: string }[]>(() => [
  { k: 'regenerate', l: '重新配乐' },
  { k: 'keep', l: '保留原声' },
  { k: 'mute', l: '无声' },
  ...(props.rep.audio.value === 'revoice' ? [{ k: 'revoice' as const, l: '换个声音' }] : []),
])
</script>

<template>
  <div class="flex flex-col gap-16px pb-80px max-sm:pb-96px">
    <section class="vr-panel">
      <h3 class="vr-h3">
        <svg class="mr-6px inline h-14px w-14px text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
        看懂了
        <template v-if="rep.analysis.value?.result?.sections?.length">：{{ rep.analysis.value.result.sections.length }} 个镜头</template>
      </h3>
      <p class="vr-sub">{{ rep.summaryText.value || '方案就是这次要怎么改、花多少点数、要多久。' }}</p>
      <p v-if="rep.sampleId.value" class="m-0 mb-10px rounded-10px bg-surface2 px-12px py-8px text-12px leading-18px text-ink-2">
        用的是示例视频{{ rep.sampleTitle.value ? `「${rep.sampleTitle.value}」` : '' }}。放上你自己的图，先看报价再决定
      </p>
      <div class="mb-6px flex items-center gap-8px"><b class="text-13px font-600">想换什么</b><span class="text-12px text-muted">勾出你想换的地方，没勾的保持原样</span></div>
      <div class="flex flex-wrap gap-8px" role="group" aria-label="想换什么">
        <button
          v-for="i in INTENTS"
          :key="i.label"
          type="button"
          :aria-pressed="rep.intentOn(i)"
          :class="[
            'inline-flex h-32px items-center gap-4px rounded-16px border border-solid px-14px text-12px cursor-pointer select-none',
            rep.intentOn(i) ? 'border-violet-line bg-violet-tint font-600 text-violet-ink' : 'border-soft-line bg-surface text-muted hover:text-ink',
            FOCUS,
          ]"
          @click="rep.toggleIntent(i)"
        >
          <svg v-if="rep.intentOn(i)" class="h-12px w-12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          {{ i.label }}
        </button>
      </div>
    </section>

    <section class="vr-panel">
      <div class="flex items-center gap-8px">
        <h3 class="vr-h3 !m-0">这条方案会改什么</h3>
        <span v-if="rep.changedCount.value" class="inline-flex h-18px items-center rounded-9px bg-violet-soft px-8px text-10px font-600 text-violet-ink">已改 {{ rep.changedCount.value }} 处</span>
        <button v-if="rep.changedCount.value" type="button" class="ml-auto border-0 bg-transparent text-12px text-violet-ink cursor-pointer hover:underline" :class="FOCUS" @click="rep.resetMarks()">恢复默认</button>
      </div>
      <p class="vr-sub !mt-4px">{{ summary }}</p>
      <ul v-if="plan?.risks?.length" class="m-0 mb-6px flex list-none flex-col gap-4px p-0" aria-label="需要留意">
        <li v-for="r in plan.risks" :key="r" class="text-12px leading-18px text-warning">{{ r }}</li>
      </ul>

      <p v-if="!rep.dims.value.length" class="m-0 py-8px text-13px text-muted">
        这条视频里没有明显可替换的人物或商品。可以直接「按我写的改」来描述想要的变化
      </p>
      <div v-for="d in rep.dims.value" :key="d.key" class="grid grid-cols-[110px_1fr_auto] items-start gap-12px border-0 border-t border-solid border-line py-12px max-sm:grid-cols-1 max-sm:gap-6px">
        <b class="pt-6px text-13px font-600 text-ink">{{ d.label }}</b>
        <div class="min-w-0">
          <div v-if="d.present" class="inline-flex gap-2px rounded-12px bg-surface3 p-2px" role="radiogroup" :aria-label="`${d.label}怎么改`">
            <template v-for="m in MODES" :key="m.key">
              <button
                v-if="m.key !== 'replace' || DIM_SLOT[d.key]"
                type="button"
                role="radio"
                :aria-checked="rep.markOf(d.key).mode === m.key"
                :class="[
                  'h-28px rounded-10px border-0 px-10px text-12px cursor-pointer',
                  rep.markOf(d.key).mode === m.key ? 'bg-surface font-600 text-violet-ink shadow-soft' : 'bg-transparent text-muted hover:text-ink',
                  FOCUS,
                ]"
                @click="rep.setMode(d.key, m.key)"
              >
                {{ m.label }}
              </button>
            </template>
          </div>
          <span v-else class="text-12px text-placeholder">视频里没有这一项</span>
          <small v-if="d.present && d.now" class="mt-4px block text-11px leading-16px text-placeholder">视频里现在是：{{ d.now }}</small>
          <input
            v-if="d.present && rep.markOf(d.key).mode === 'describe'"
            :value="rep.markOf(d.key).note"
            maxlength="200"
            :aria-label="`${d.label}按我写的改`"
            placeholder="写一句话，比如：改成红色连衣裙"
            class="vr-input mt-8px"
            @input="rep.setNote(d.key, ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="pt-4px">
          <span v-if="d.present && rep.markOf(d.key).mode === 'replace' && DIM_SLOT[d.key]" class="flex flex-col items-end gap-4px max-sm:items-start">
            <span v-if="rep.slots[DIM_SLOT[d.key]!]" class="inline-flex items-center gap-6px">
              <img v-if="rep.slots[DIM_SLOT[d.key]!]!.url" :src="rep.slots[DIM_SLOT[d.key]!]!.url" alt="" class="h-28px w-28px rounded-6px object-cover" aria-hidden="true" />
              <span class="inline-flex h-20px items-center rounded-4px bg-success-soft px-6px text-11px text-success">已放图</span>
              <button type="button" class="sx-soft-btn" :disabled="rep.slotBusy[DIM_SLOT[d.key]!]" @click="slotInputs[DIM_SLOT[d.key]!]?.click()">换一张</button>
            </span>
            <template v-else>
              <span class="text-12px text-warning">需要放一张图</span>
              <button type="button" class="sx-soft-btn" :disabled="rep.slotBusy[DIM_SLOT[d.key]!]" @click="slotInputs[DIM_SLOT[d.key]!]?.click()">
                {{ rep.slotBusy[DIM_SLOT[d.key]!] ? '上传中…' : '放一张图' }}
              </button>
            </template>
            <small v-if="rep.slotError[DIM_SLOT[d.key]!]" class="text-11px text-danger" role="alert">{{ rep.slotError[DIM_SLOT[d.key]!] }}</small>
            <button
              type="button"
              class="sx-soft-btn"
              :disabled="rep.slotBusy[DIM_SLOT[d.key]!]"
              @click="openSlotAsset(DIM_SLOT[d.key]!)"
            >
              从资产库添加
            </button>
            <input
              :ref="(el) => el && (slotInputs[DIM_SLOT[d.key]!] = el as HTMLInputElement)"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="hidden"
              @change="onSlot(DIM_SLOT[d.key]!, $event)"
            />
          </span>
        </div>
      </div>

      <div class="grid grid-cols-[110px_1fr] items-start gap-12px border-0 border-t border-solid border-line py-12px max-sm:grid-cols-1 max-sm:gap-6px">
        <b class="pt-6px text-13px font-600 text-ink">声音</b>
        <div>
          <div class="inline-flex gap-2px rounded-12px bg-surface3 p-2px" role="radiogroup" aria-label="声音">
            <button
              v-for="a in audioOptions"
              :key="a.k"
              type="button"
              role="radio"
              :aria-checked="rep.audio.value === a.k"
              :class="['h-28px rounded-10px border-0 px-10px text-12px cursor-pointer', rep.audio.value === a.k ? 'bg-surface font-600 text-violet-ink shadow-soft' : 'bg-transparent text-muted hover:text-ink', FOCUS]"
              @click="rep.audio.value = a.k"
            >
              {{ a.l }}
            </button>
          </div>
          <p v-if="rep.audio.value === 'revoice'" class="m-0 mt-6px text-12px leading-18px text-muted">
            音色和台词是在对话里设置的，这里不能修改；换声音后口型可能对不上。
          </p>
        </div>
      </div>
    </section>

    <section v-if="!plan" class="vr-panel" role="status">
      <template v-if="rep.planBusy.value"><p class="m-0 text-13px text-muted">正在更新报价…</p></template>
      <template v-else-if="rep.planDirty.value">
        <p class="m-0 text-13px text-muted">
          改好了就停一下，价格会自动算出来
          <button type="button" class="ml-6px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" @click="rep.submitPlan()">更新报价</button>
        </p>
      </template>
      <template v-else-if="rep.missing.value.length || rep.planGaps.value.length">
        <p v-for="m in rep.missing.value" :key="m" class="m-0 text-13px text-warning">{{ m }}</p>
      </template>
      <p v-else class="m-0 text-13px text-muted">选好要换的地方，方案和价格就会出现在这里</p>
    </section>

    <section v-if="segCount > 1" class="vr-panel">
      <h3 class="vr-h3">{{ plan?.timeline.title }}</h3>
      <p class="vr-sub">{{ plan?.timeline.explain }}</p>
      <div class="flex gap-4px" role="list">
        <div
          v-for="s in segs"
          :key="s.index"
          role="listitem"
          class="flex min-w-0 flex-col gap-2px rounded-10px border border-solid border-violet-line bg-violet-tint px-8px py-6px text-center"
          :style="{ flex: s.t1 - s.t0 }"
          :title="s.cutLabel ? `切在${s.cutLabel}` : undefined"
        >
          <b class="text-12px font-600 text-violet-ink">第 {{ s.index }} 段</b>
          <span class="text-11px text-muted">{{ Math.round(s.t1 - s.t0) }} 秒</span>
        </div>
      </div>
      <div class="mt-4px flex justify-between text-11px text-placeholder">
        <span>{{ mm(0) }}</span>
        <span v-for="s in segs.slice(0, -1)" :key="s.index">切点 {{ mm(s.t1) }}{{ s.cutLabel ? ` · ${s.cutLabel}` : '' }}</span>
        <span>{{ mm(segs.at(-1)?.t1 ?? 0) }}</span>
      </div>
      <p v-if="plan?.timeline.seamTip" class="m-0 mt-8px text-11px leading-16px text-placeholder">{{ plan.timeline.seamTip }}{{ q?.overlapText ? `，${q.overlapText}` : '' }}</p>
    </section>

    <section v-if="plan && segCount > 1 && plan.eta?.fast && plan.eta?.smooth" class="vr-panel" aria-label="画面连贯度">
      <p class="vr-sub !mt-0">多段视频默认逐段并行、更快；选「更连贯」会让后一段接着上一段的最后一帧，人物和场景衔接更自然</p>
      <ContinuityPicker :plan="plan" :disabled="rep.planBusy.value || rep.submitting.value" @select="rep.setContinuity" />
    </section>

    <section v-if="rep.models.value.length > 1" class="vr-panel" aria-label="选择模型">
      <h3 class="vr-h3">模型</h3>
      <p class="vr-sub">已为你选好推荐模型；换模型会按新模型重新报价，提示词也会按它的写法生成</p>
      <div class="grid grid-cols-1 gap-8px sm:grid-cols-2" role="radiogroup" aria-label="出片模型">
        <button
          v-for="m in rep.models.value"
          :key="m.modelGroup"
          type="button"
          role="radio"
          :aria-checked="rep.modelGroup.value === m.modelGroup"
          :disabled="!m.available || rep.planBusy.value || rep.submitting.value"
          :class="[
            'flex flex-col items-start gap-4px rounded-10px border border-solid px-12px py-10px text-left',
            rep.modelGroup.value === m.modelGroup ? 'border-violet bg-violet-tint' : 'border-line bg-transparent',
            m.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
            FOCUS,
          ]"
          @click="rep.setModel(m.modelGroup)"
        >
          <span class="flex w-full items-center gap-6px">
            <b class="text-13px font-600 text-ink">{{ m.name }}</b>
            <span v-if="m.recommended" class="rounded-4px bg-violet px-4px text-11px text-white">推荐</span>
            <span class="ml-auto text-12px tabular-nums text-ink-2">{{ m.priceText || '' }}</span>
          </span>
          <span class="text-11px leading-16px text-muted">{{ m.features.join(' · ') }}</span>
          <span v-if="m.estimatedPoints && m.available" class="text-11px tabular-nums text-placeholder">这条视频约 {{ fmtPts(m.estimatedPoints) }} 点</span>
          <span v-if="!m.available" class="text-11px text-warning">{{ m.unavailableText || '暂不可用' }}</span>
        </button>
      </div>
    </section>

    <section v-if="plan && q" class="vr-panel">
      <QuoteBlock :cost="q" :points="rep.needPoints.value" :staged="staged" :eta="eta" :policy-text="plan.policy.text">
        <template #status>
          <p v-if="rep.planBusy.value" class="m-0 mt-6px text-12px text-muted" role="status">正在更新报价…</p>
          <p v-else-if="rep.planDirty.value" class="m-0 mt-6px text-12px text-warning" role="status">
            刚才的改动还没算进价格
            <button type="button" class="ml-6px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" @click="rep.submitPlan()">更新报价</button>
          </p>
        </template>
        <template #mid>
          <p v-if="rep.balance.value != null" class="m-0 mt-4px text-12px tabular-nums text-muted">可用 {{ fmtPts(rep.balance.value) }} 点</p>
        </template>
        <template #foot>
          <p v-if="leftSec != null" class="m-0 mt-4px text-11px text-placeholder" :class="expired ? '!text-danger' : ''">
            {{ expired ? '报价已过期' : `报价 ${mm(leftSec)} 内有效` }}
            <button v-if="expired" type="button" class="ml-6px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" @click="rep.refreshQuote()">刷新报价</button>
          </p>
        </template>
      </QuoteBlock>
      <details v-if="plan.prompts?.length" class="mt-8px text-12px text-muted">
        <summary class="cursor-pointer">查看每段提示词（高级）</summary>
        <p class="m-0 mt-4px text-11px leading-16px text-placeholder">想改效果，请改上面的「按我写的改」，提示词会自动更新</p>
        <p v-for="(t, i) in plan.prompts" :key="i" class="m-0 mt-4px whitespace-pre-wrap text-11px leading-16px">{{ t }}</p>
      </details>
    </section>

    <!-- 保存为我的方案 -->
    <section v-if="plan" class="vr-panel !py-12px" aria-label="保存为我的方案">
      <div v-if="!rep.planSaved.value" class="flex flex-wrap items-center gap-10px">
        <span class="min-w-0 flex-1 text-12px leading-18px text-muted">下次换商品不用重新选，点一下就能再做一条</span>
        <button type="button" class="sx-btn" :disabled="rep.saveBusy.value" @click="rep.savePlan()">{{ rep.saveBusy.value ? '正在保存…' : '保存为我的方案' }}</button>
      </div>
      <form v-else class="flex flex-wrap items-center gap-8px" @submit.prevent="renameDirty && rep.savePlan(nameDraft)">
        <span class="text-12px text-success" role="status">已保存到我的方案</span>
        <input v-model="nameDraft" maxlength="40" aria-label="方案名" class="vr-input !h-32px min-w-0 flex-1 !text-12px" />
        <button type="submit" class="sx-btn" :disabled="!renameDirty || rep.saveBusy.value">{{ rep.saveBusy.value ? '正在保存…' : '改名' }}</button>
      </form>
      <p v-if="rep.saveError.value" class="m-0 mt-6px text-12px text-danger" role="alert">
        {{ rep.saveError.value }}
        <button v-if="rep.saveLimit.value" type="button" class="ml-6px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" @click="rep.tab.value = 'saved'">去我的方案</button>
      </p>
    </section>

    <p v-if="plan?.copyright" class="m-0 text-11px leading-16px text-placeholder">{{ plan.copyright }}</p>
    <label v-if="rep.slots.person" class="flex items-start gap-8px text-13px text-ink-2 cursor-pointer">
      <input v-model="rep.consent.value" type="checkbox" class="mt-3px" />
      图中是我本人，或已获得本人同意，可用于生成视频
    </label>

    <p v-if="rep.planError.value" class="m-0 text-13px text-danger" role="alert">
      {{ rep.planError.value }}
      <button type="button" class="ml-6px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" @click="rep.createPlan()">重新生成方案</button>
    </p>

    <!-- 吸底确认条（手机和桌面同一条）：合计 / 缺项 / 点数不足 + 主按钮 -->
    <div class="sticky bottom-0 z-5 -mx-4px flex flex-wrap items-center justify-end gap-x-12px gap-y-6px rounded-16px border border-solid border-soft-line bg-surface/95 px-14px py-10px shadow-pop backdrop-blur-8px max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:m-0 max-sm:rounded-b-0 max-sm:pb-[calc(10px+env(safe-area-inset-bottom))]">
      <div class="mr-auto min-w-0 text-12px leading-18px text-muted" role="status">
        <template v-if="plan && q">
          {{ staged ? `${q.firstText} · ${q.restText?.split('（')[0]}` : `${q.totalText}${eta ? ` · ${eta}` : ''}` }}
        </template>
        <span v-if="rep.missing.value.length" class="block text-warning">还差：{{ rep.missing.value[0] }}</span>
        <span v-else-if="rep.shortfall.value > 0" class="block text-danger">点数不足，还差 {{ fmtPts(rep.shortfall.value) }} 点</span>
        <span v-if="rep.submitError.value" class="block text-danger" role="alert">
          {{ rep.submitError.value }}
          <button v-if="expiredPlan" type="button" class="ml-6px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" @click="rep.createPlan()">重新生成方案</button>
        </span>
      </div>
      <button v-if="segCount > 1" type="button" class="sx-btn" @click="rep.setStage(staged ? 'all' : 'first')">
        {{ staged ? '一次全部做' : '先做第 1 段' }}
      </button>
      <button v-if="rep.planDirty.value && !rep.planBusy.value" type="button" class="sx-btn !h-40px" @click="rep.submitPlan()">更新报价</button>
      <button type="button" class="sx-btn !h-40px" @click="rep.restart()">重新开始</button>
      <button
        type="button"
        class="sx-btn-primary !h-40px !px-18px !text-14px"
        :disabled="pricePending || (!rep.canConfirm.value && rep.shortfall.value === 0)"
        @click="onConfirm"
      >
        {{ buttonText }}
      </button>
      <span v-if="pricePending" class="self-center text-12px text-muted" role="status">价格还没出来，稍等一下</span>
    </div>

    <NModal :show="confirmOpen" :auto-focus="false" trap-focus @update:show="(v: boolean) => (confirmOpen = v)">
      <div class="sx-squircle w-[min(440px,92vw)] rounded-20px border border-solid border-soft-line bg-surface p-18px shadow-pop" role="dialog" aria-labelledby="vr-spend-title">
        <h3 id="vr-spend-title" class="m-0 text-16px font-600 text-ink">本次将花费 {{ fmtPts(spendNow) }} 点，确认后开始生成</h3>
        <p class="m-0 mt-10px text-13px leading-20px text-ink-2">
          共 <b class="tabular-nums text-ink">{{ spendSegs }}</b> 段<template v-if="eta"> · {{ eta }}</template>
        </p>
        <div class="mt-14px flex justify-end gap-8px">
          <button type="button" class="sx-btn" @click="confirmOpen = false">再想想</button>
          <button type="button" class="sx-btn-primary" :disabled="rep.submitting.value || pricePending" @click="doConfirm">确认生成</button>
        </div>
      </div>
    </NModal>
    <AssetPickerModal v-model:show="assetImageOpen" :limit="1" media="image" @select="onAssetSlot" />
  </div>
</template>
