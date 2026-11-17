<script setup lang="ts">
/** 对话卡片：方案（改什么 / 保留什么 / 风险 / 费用摘要）。费用与耗时只取后端报价，不推算；扣点在同意卡里，这里没有任何确认按钮。 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { ReplicatePlan } from '@/api/replicate.ts'
import QuoteBlock from '@/views/video-replicate/parts/QuoteBlock.vue'
import ContinuityPicker from '@/views/video-replicate/parts/ContinuityPicker.vue'

const props = defineProps<{ view: ReplicatePlan; /** 智能体正在回复：连贯度切换置灰 */ busy?: boolean }>()
/** 连贯度切换只替用户发一条消息，由智能体改方案 */
const emit = defineEmits<{ (e: 'send', text: string): void }>()

/** 改动说明按换行 / 中英文分号拆成多行（后端逐套文案每套一句） */
const noteLines = (note: string) => note.split(/[\n;；]+/).map((l) => l.trim()).filter(Boolean)

/** 换声音（audio=revoice）：配音设置那一行与口型风险要显眼 */
const revoice = computed(() => props.view.annotations?.audio === 'revoice')
const isVoiceChange = (key: string) => revoice.value && /audio|voice/i.test(key)

const segCount = computed(() => props.view.timeline?.segments?.length ?? 0)
const staged = computed(() => props.view.cost?.defaultStage === 'first' && segCount.value > 1)
const points = computed(() => (staged.value ? props.view.stageQuotes?.first : props.view.stageQuotes?.total) ?? props.view.cost?.total ?? 0)
const eta = computed(() => {
  const e = props.view.eta
  return (staged.value ? e?.first : e?.total)?.text ?? e?.total?.text ?? ''
})
const STATUS_TEXT: Record<string, string> = {
  STALE: '已有更新的方案',
  EXPIRED: '方案已过期，需要重新报价',
  CONFIRMED: '已确认生成',
}
const statusText = computed(() => STATUS_TEXT[props.view.status] ?? '')

/**
 * 「在完整页编辑」深链：方案已出片就带 ?job=（完整页现在只认它）；否则带 ?plan=<planNo>，
 * 完整页读到它之前会落在首页，这是已知缺口，见交付说明。
 */
const link = computed(() =>
  props.view.jobId
    ? { name: 'video-replicate', query: { job: String(props.view.jobId) } }
    : { name: 'video-replicate', query: { plan: props.view.planNo } },
)
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="换片方案">
    <div class="flex items-start gap-8px">
      <h3 class="vr-h3 !m-0 min-w-0 flex-1">{{ view.title || '换片方案' }}</h3>
      <span v-if="statusText" class="flex-none rounded-9px bg-surface3 px-8px py-1px text-11px text-muted">{{ statusText }}</span>
    </div>
    <p v-if="view.overview" class="vr-sub !mt-4px">{{ view.overview }}</p>

    <ul v-if="view.changes?.length" class="m-0 flex list-none flex-col gap-6px p-0" aria-label="会改的地方">
      <li
        v-for="c in view.changes"
        :key="c.key"
        :class="['flex gap-8px text-12px leading-18px', isVoiceChange(c.key) && 'rounded-10px border border-solid border-violet bg-violet-tint px-8px py-6px']"
      >
        <b class="w-52px flex-none font-600 text-ink">{{ c.label }}</b>
        <span class="min-w-0 flex-1 break-words text-ink-2">
          <span class="mr-4px inline-flex h-18px items-center rounded-9px bg-violet-soft px-6px text-10px font-600 text-violet-ink">{{ c.modeLabel }}</span>
          <!-- 逐人 / 多套逐套文案（「左侧白衣女生 → 图1；男生 保持不变」「第 1 套 → 图 2；第 3 套 → 图 3」）：按换行 / 分号拆开，每套一行 -->
          <template v-if="c.subjectText || c.occurrenceText || c.note">
            <template v-if="noteLines(c.subjectText || c.occurrenceText || c.note || '').length > 1">
              <span v-for="(line, i) in noteLines(c.subjectText || c.occurrenceText || c.note || '')" :key="i" class="block">{{ line }}</span>
            </template>
            <template v-else>{{ c.subjectText || c.occurrenceText || c.note }}</template>
          </template>
          <small v-if="c.current" class="block text-11px text-placeholder">现在是：{{ c.current }}</small>
        </span>
      </li>
    </ul>
    <p v-if="view.kept?.length" class="m-0 mt-8px text-12px leading-18px text-muted">
      保持原样：{{ view.kept.map((k) => k.label).join('、') }}
    </p>
    <ul
      v-if="view.risks?.length"
      :class="[
        'm-0 mt-8px flex list-none flex-col gap-4px p-0',
        revoice && 'rounded-10px border border-solid border-warning-line bg-warning-soft px-10px py-8px',
      ]"
      aria-label="需要留意"
    >
      <li v-for="r in view.risks" :key="r" :class="['break-words text-12px leading-18px text-warning', revoice && 'font-600']">{{ r }}</li>
    </ul>

    <ContinuityPicker
      class="mt-10px"
      :plan="view"
      :disabled="busy || !!statusText"
      @select="(v) => emit('send', v === 'smooth' ? '改成更连贯' : '改成更快')"
    />

    <div v-if="view.cost" class="mt-10px rounded-12px bg-surface2 px-12px py-10px">
      <QuoteBlock :cost="view.cost" :points="points" :staged="staged" :eta="eta" :policy-text="view.policy?.text" compact />
    </div>

    <div class="mt-10px flex flex-wrap items-center gap-8px">
      <RouterLink :to="link" class="sx-btn !h-32px no-underline">在完整页编辑</RouterLink>
      <span class="text-11px text-placeholder">方案编号 {{ view.planNo }}</span>
    </div>
  </section>
</template>
