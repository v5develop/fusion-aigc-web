<script setup lang="ts">
/**
 * 第四步：生成与交付。状态、文案、点数全部来自后端 JobView（段状态 / 钱 / 决策卡 / 成片），页面不自己推算「已退回」。
 * 覆盖：生成中 → 决策卡（继续 / 调整 / 不继续）→ 其余段 → 做好了 / 部分成功（占位预览 + 重做）/ 失败。
 * 文案取自 EXPERIENCE §4.7 / 4.8 / 4.9；后端没承诺的「AI 生成」角标、取消整条、历史列表不在页面里。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NModal } from 'naive-ui'
import { fmtPts } from './constants.ts'
import MoneyLine from './parts/MoneyLine.vue'
import ResultCompare from './parts/ResultCompare.vue'
import SegmentStatusBar from './parts/SegmentStatusBar.vue'
import JobFeedback from './parts/JobFeedback.vue'
import type { useReplicate } from './useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const rep = props.rep
const router = useRouter()
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const job = computed(() => rep.job.value!)
const segs = computed(() => job.value.segments)
const st = computed(() => job.value.status)
const live = computed(() => ['submitting', 'queued', 'running', 'continuing'].includes(st.value))
const waiting = computed(() => st.value === 'waiting')
const finished = computed(() => ['succeeded', 'partial', 'failed', 'canceled'].includes(st.value))
const failedSeg = computed(() => segs.value.find((s) => s.state === 'failed'))
const firstSeg = computed(() => segs.value[0])
const result = computed(() => job.value.result)
const resultUrl = computed(() => result.value?.videoUrl)
const firstUrl = computed(() => firstSeg.value?.videoUrl)
/** 预览版（有段没做好）不能下载 */
const preview = computed(() => result.value?.kind === 'preview')
const stitching = computed(() => live.value && segs.value.length > 0 && segs.value.every((s) => s.state === 'succeeded'))
const redoOptions = computed(() => (job.value.decision?.kind === 'redo' ? job.value.decision.options : []))
const decisionOf = (action: string) => job.value.decision?.options.find((o) => o.action === action)

const isPlaying = (u?: string) => !!u && !u.startsWith('data:')

/** 下载：地址临近 / 已过期先重拉 job 拿新地址再开；失败时仍用旧地址（后端到期会拒，页面显示 jobError） */
async function download(url: string) {
  await rep.ensureFreshUrls()
  const fresh = rep.job.value?.result?.videoUrl ?? url
  window.open(fresh, '_blank', 'noopener')
}

/** 「不继续了」前确认：不收费、只留第 1 段（文案取后端 decision 的 stop 选项与到期说明） */
const stopOpen = ref(false)
async function doStop() {
  stopOpen.value = false
  await rep.stopJob()
}

/** 「不做剩下的段」：二次确认里显示将退回的点数（后端 cancelRest 预览） */
const cancelRestOpen = ref(false)
async function doCancelRest() {
  cancelRestOpen.value = false
  await rep.cancelRest()
}

/** 「继续做剩下的」「重做这一段」：先确认本次花费的点数，确认后才调接口 */
const spendAsk = ref<{ kind: 'continue' | 'redo'; seg?: number; points: number; label: string } | null>(null)
function askContinue() {
  const points = rep.continuePoints.value
  if (points <= 0) return
  spendAsk.value = { kind: 'continue', points, label: decisionOf('continue')?.label || '继续做剩下的' }
}
function askRedo(k: number) {
  const points = rep.redoPointsOf(k)
  if (points <= 0) return
  spendAsk.value = { kind: 'redo', seg: k, points, label: `重做第 ${k} 段` }
}
async function doSpend() {
  const a = spendAsk.value
  spendAsk.value = null
  if (!a) return
  if (a.kind === 'continue') await rep.continueRest()
  else if (a.seg) await rep.redoSegment(a.seg)
}

</script>

<template>
  <div class="flex flex-col gap-16px">
    <!-- 生成中 / 等你确认 / 终态 共用的状态头 -->
    <section class="vr-panel">
      <h3 class="vr-h3">
        <template v-if="stitching">正在把几段接成一条…</template>
        <template v-else-if="st === 'succeeded' && !result?.kind">做好了！</template>
        <template v-else>{{ job.statusLabel }}</template>
      </h3>
      <p class="vr-sub" role="status">
        <template v-if="live">{{ job.overview }}<template v-if="job.concurrencyText"> · {{ job.concurrencyText }}</template><template v-if="job.money.held"> · 已预留 {{ fmtPts(job.money.held) }} 点，成功才扣除</template></template>
        <template v-else-if="waiting">{{ job.overview }} · 左边是原片，右边是你的成片</template>
        <template v-else>{{ job.message || job.overview }}</template>
      </p>

      <SegmentStatusBar :segments="segs" />

      <ul class="m-0 mt-12px flex list-none flex-col gap-8px p-0">
        <li v-for="s in segs" :key="s.index" :class="['flex items-center gap-10px rounded-12px border border-solid px-12px py-10px', s.state === 'failed' ? 'border-danger-line bg-danger-soft' : 'border-line bg-surface']">
          <span :class="['grid h-24px w-24px flex-none place-items-center rounded-full text-12px font-600', s.state === 'succeeded' ? 'bg-success text-white' : 'bg-surface3 text-ink-2']">{{ s.state === 'succeeded' ? '✓' : s.index }}</span>
          <div class="min-w-0 flex-1">
            <b class="text-13px font-600 text-ink">第 {{ s.index }} 段 · {{ s.stateLabel }}</b>
            <small v-if="s.text || s.moneyText" class="block text-11px leading-16px text-muted">
              {{ [s.text, s.moneyText].filter(Boolean).join(' · ') }}
            </small>
            <div v-if="s.state === 'running' || s.state === 'retrying'" class="mt-6px h-4px overflow-hidden rounded-2px bg-surface3" role="progressbar" :aria-label="`第 ${s.index} 段生成中`">
              <i class="vr-indeterminate block h-full w-1/3 rounded-2px bg-violet" />
            </div>
          </div>
          <span v-if="s.points > 0" class="inline-flex h-20px flex-none items-center rounded-10px bg-violet-soft px-8px text-11px text-violet-ink">{{ fmtPts(s.points) }} 点</span>
          <span v-if="s.redoable && !rep.redoReady(s.index)" class="flex-none text-11px text-muted">{{ rep.PRICE_PENDING_TEXT }}</span>
          <button v-if="s.redoable" type="button" class="sx-btn-primary flex-none" :disabled="rep.jobBusy.value || !rep.redoReady(s.index)" @click="askRedo(s.index)">
            {{ s.redoLabel || '重做这一段' }}
          </button>
        </li>
      </ul>

      <div v-if="stitching" class="mt-12px h-4px overflow-hidden rounded-2px bg-surface3" role="progressbar" aria-label="拼接中"><i class="vr-indeterminate block h-full w-1/3 rounded-2px bg-violet" /></div>

      <p v-if="live" class="m-0 mt-12px text-12px leading-18px text-muted">
        可以先去做别的，这条任务会继续，完成后会在任务中心和站内通知里提醒你。
        <button type="button" class="ml-4px border-0 bg-transparent text-violet-ink cursor-pointer hover:underline" :class="FOCUS" @click="router.push({ name: 'task-center' })">去任务中心</button>
      </p>
      <p v-if="rep.jobError.value" class="m-0 mt-8px text-12px text-warning" role="status">{{ rep.jobError.value }}</p>
      <div v-if="rep.canCancelRest.value" class="mt-10px flex items-center gap-8px">
        <button type="button" class="sx-btn !h-32px" :disabled="rep.jobBusy.value" @click="cancelRestOpen = true">不做剩下的段</button>
        <span class="text-11px text-placeholder">还没开始的段不做了，点数退回；正在生成的段会做完</span>
      </div>
    </section>

    <!-- 决策卡：第 1 段做好了（标题、按钮文案、点数、剩余时间都来自后端 decision） -->
    <template v-if="waiting && job.decision">
      <section class="vr-panel">
        <ResultCompare
          :source-url="rep.source.url"
          source-label="原片 · 第 1 段"
          :result-url="firstUrl"
          result-label="你的成片 · 第 1 段"
          result-alt="你的成片第 1 段"
          result-empty="第 1 段已生成"
          @result-play="rep.ensureFreshUrls()"
          @result-error="rep.ensureFreshUrls(true)"
        />
      </section>
      <section class="vr-panel" role="group" aria-label="是否继续">
        <b class="mb-8px block text-14px font-600 text-ink">{{ job.decision.title }}</b>
        <div class="flex flex-wrap gap-8px">
          <button v-if="decisionOf('continue')" type="button" class="sx-btn-primary !h-40px" :disabled="rep.jobBusy.value || !rep.continueReady.value" @click="askContinue()">
            {{ decisionOf('continue')!.label }}
          </button>
          <span v-if="decisionOf('continue') && !rep.continueReady.value" class="self-center text-12px text-muted">{{ rep.PRICE_PENDING_TEXT }}</span>
          <button v-if="decisionOf('adjust')" type="button" class="sx-btn !h-40px" :disabled="rep.jobBusy.value" @click="rep.backToPlan()">{{ decisionOf('adjust')!.label }}</button>
          <button v-if="decisionOf('stop')" type="button" class="sx-btn !h-40px" :disabled="rep.jobBusy.value" @click="stopOpen = true">{{ decisionOf('stop')!.label }}</button>
        </div>
        <label v-if="job.decision.autoContinueLabel" class="mt-10px flex items-center gap-8px text-13px text-ink-2 cursor-pointer">
          <input type="checkbox" @change="rep.setAutoContinue(($event.target as HTMLInputElement).checked)" />
          {{ job.decision.autoContinueLabel }}
        </label>
        <p v-if="job.decision.remainingText" class="m-0 mt-6px text-11px leading-16px text-placeholder">{{ job.decision.remainingText }}</p>
      </section>
    </template>

    <!-- 终态：成片 -->
    <section v-if="finished && (result || firstSeg)" class="vr-panel">
      <div class="grid grid-cols-[260px_1fr] gap-16px max-md:grid-cols-1">
        <div class="relative mx-auto aspect-[9/16] w-full max-w-260px overflow-hidden rounded-16px bg-surface3">
          <video v-if="isPlaying(resultUrl) && !preview" :src="resultUrl" controls playsinline class="h-full w-full object-cover" @play="rep.ensureFreshUrls()" @error="rep.ensureFreshUrls(true)" />
          <img v-else-if="resultUrl" :src="resultUrl" alt="成片预览" class="h-full w-full object-cover" />
          <div v-else class="grid h-full w-full place-items-center px-12px text-center text-12px text-muted">
            {{ result?.status === 'ready' ? '成片已生成，播放地址暂时没拿到，请稍后刷新或到任务中心查看' : '成片还在合成' }}
          </div>
          <span v-if="resultUrl || result?.coverUrl" class="absolute right-8px top-8px rounded-4px bg-black/55 px-6px py-2px text-10px text-white">AI 生成</span>
          <div v-if="preview" class="absolute inset-0 grid place-items-end bg-black/35 p-12px text-white">
            <div>
              <b class="block text-13px">{{ failedSeg ? `第 ${failedSeg.index} 段没生成成功，可重做` : '预览版' }}</b>
              <span class="text-11px opacity-85">预览版 · 仅供预览，暂不能下载</span>
            </div>
          </div>
        </div>
        <div class="flex min-w-0 flex-col gap-10px">
          <div v-if="st === 'partial' || st === 'failed' || preview" class="rounded-12px bg-danger-soft px-12px py-10px" role="alert">
            <b class="block text-13px font-600 text-ink">{{ job.statusLabel }}{{ job.money.refunded && !failedSeg?.moneyText ? `，已退回 ${fmtPts(job.money.refunded)} 点` : '' }}</b>
            <span class="text-12px text-ink-2">{{ result?.text || job.error || '重做这一段，做好后会自动拼成完整视频。' }}</span>
          </div>
          <div v-else-if="job.message" class="rounded-12px bg-surface2 px-12px py-10px">
            <b class="block text-13px font-600 text-ink">{{ job.message }}</b>
          </div>
          <div v-else-if="st === 'succeeded'" class="rounded-12px bg-success-soft px-12px py-10px">
            <b class="block text-13px font-600 text-ink">{{ result?.text || job.overview }}</b>
          </div>
          <div v-if="result && result.status !== 'ready'" class="rounded-12px bg-surface2 px-12px py-10px" role="status">
            <b class="block text-13px font-600 text-ink">
              {{ result.status === 'retry' ? '正在把几段接成一条…' : result.text || '这几段没能拼成一条，但每一段都做好了，可以分别下载' }}
            </b>
          </div>
          <MoneyLine :money="job.money" />
          <div class="flex flex-wrap gap-8px">
            <button v-for="o in redoOptions" :key="o.segIndex" type="button" class="sx-btn-primary" :disabled="rep.jobBusy.value || !rep.redoReady(o.segIndex ?? 0)" @click="o.segIndex && askRedo(o.segIndex)">
              {{ o.label }}
            </button>
            <span v-if="redoOptions.some((o) => !rep.redoReady(o.segIndex ?? 0))" class="self-center text-12px text-muted">{{ rep.PRICE_PENDING_TEXT }}</span>
            <button v-if="resultUrl && !preview" type="button" class="sx-btn-primary" @click="download(resultUrl!)">下载</button>
            <button v-if="st !== 'partial'" type="button" class="sx-btn" @click="rep.backToPlan()">换商品再做</button>
            <button type="button" class="sx-btn" @click="rep.restart()">做新的</button>
          </div>
          <p v-if="st === 'succeeded'" class="m-0 text-11px leading-16px text-placeholder">我们不会替你发布任何内容，成品只在你的资产里。时长、大小限制以平台当前规则为准。</p>
          <JobFeedback v-if="st === 'succeeded'" :job-id="job.jobId" :segments="segs" />
        </div>
      </div>
    </section>
    <section v-else-if="finished" class="vr-panel">
      <p class="m-0 text-13px text-ink-2">{{ job.error || job.money.text || '这次没有生成成功。' }}</p>
      <div class="mt-10px flex gap-8px"><button type="button" class="sx-btn-primary" @click="rep.backToPlan()">重新生成方案</button><button type="button" class="sx-btn" @click="rep.restart()">做新的</button></div>
    </section>

    <NModal :show="stopOpen" :auto-focus="false" trap-focus @update:show="(v: boolean) => (stopOpen = v)">
      <div class="sx-squircle w-[min(440px,92vw)] rounded-20px border border-solid border-soft-line bg-surface p-18px shadow-pop" role="dialog" aria-labelledby="vr-stop-title">
        <h3 id="vr-stop-title" class="m-0 text-16px font-600 text-ink">不继续了？</h3>
        <p class="m-0 mt-10px text-13px leading-20px text-ink-2">第 1 段留给你，可以下载，没有再收费。</p>
        <div class="mt-14px flex justify-end gap-8px">
          <button type="button" class="sx-btn" @click="stopOpen = false">再想想</button>
          <button type="button" class="sx-btn-danger" @click="doStop">不继续了</button>
        </div>
      </div>
    </NModal>
    <NModal :show="!!spendAsk" :auto-focus="false" trap-focus @update:show="(v: boolean) => { if (!v) spendAsk = null }">
      <div class="sx-squircle w-[min(440px,92vw)] rounded-20px border border-solid border-soft-line bg-surface p-18px shadow-pop" role="dialog" aria-labelledby="vr-spend-ask-title">
        <h3 id="vr-spend-ask-title" class="m-0 text-16px font-600 text-ink">本次将花费 {{ fmtPts(spendAsk?.points ?? 0) }} 点</h3>
        <p class="m-0 mt-10px text-13px leading-20px text-ink-2">{{ spendAsk?.label }}，确认后开始生成，成功才扣除。</p>
        <div class="mt-14px flex justify-end gap-8px">
          <button type="button" class="sx-btn" @click="spendAsk = null">再想想</button>
          <button type="button" class="sx-btn-primary" :disabled="rep.jobBusy.value" @click="doSpend">确认生成</button>
        </div>
      </div>
    </NModal>
    <NModal :show="cancelRestOpen" :auto-focus="false" trap-focus @update:show="(v: boolean) => (cancelRestOpen = v)">
      <div class="sx-squircle w-[min(440px,92vw)] rounded-20px border border-solid border-soft-line bg-surface p-18px shadow-pop" role="dialog" aria-labelledby="vr-cancel-rest-title">
        <h3 id="vr-cancel-rest-title" class="m-0 text-16px font-600 text-ink">不做剩下的段？</h3>
        <p class="m-0 mt-10px text-13px leading-20px text-ink-2">
          {{ job.cancelRest?.text || `还没开始的 ${job.cancelRest?.segments ?? 0} 段不做了` }}。
        </p>
        <p class="m-0 mt-6px text-13px leading-20px text-ink-2">
          将退回约 <b class="tabular-nums text-ink">{{ fmtPts(rep.cancelRestPoints.value) }}</b> 点，以实际为准；已做好的段照常保存到素材库。
        </p>
        <div class="mt-14px flex justify-end gap-8px">
          <button type="button" class="sx-btn" @click="cancelRestOpen = false">再想想</button>
          <button type="button" class="sx-btn-danger" :disabled="rep.jobBusy.value" @click="doCancelRest">不做了</button>
        </div>
      </div>
    </NModal>
  </div>
</template>
