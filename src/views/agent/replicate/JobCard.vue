<script setup lang="ts">
/**
 * 对话卡片：任务（分段进度 / 点数 / 决策 / 成片）。
 * 所有「继续 / 重做 / 就这样」都只是替用户发一条消息（emit send），由智能体调工具并走同意卡；这里绝不调复刻写接口。
 */
import { computed } from 'vue'
import type { ReplicateJob } from '@/api/replicate.ts'
import type { ReplicateCardFrame } from '@/api/replicate-card.ts'
import MoneyLine from '@/views/video-replicate/parts/MoneyLine.vue'
import SegmentStatusBar from '@/views/video-replicate/parts/SegmentStatusBar.vue'
import { fmtPts } from '@/views/video-replicate/constants.ts'
import ResultCard from './ResultCard.vue'
import { isTerminalJob, useJobCard } from './useJobCard.ts'

const props = defineProps<{
  frame: ReplicateCardFrame
  /** 智能体正在回复：按钮置灰，避免连发 */
  busy?: boolean
  sourceUrl?: string
}>()
const emit = defineEmits<{ (e: 'send', text: string): void; (e: 'draft', text: string): void }>()

const { job, error, renew } = useJobCard(
  () => props.frame.id,
  () => props.frame.view as ReplicateJob | undefined,
)

const segs = computed(() => job.value?.segments ?? [])
const live = computed(() => !!job.value && !isTerminalJob(job.value) && job.value.status !== 'waiting')
const waiting = computed(() => job.value?.status === 'waiting' && !!job.value.decision)
const failedSegs = computed(() => segs.value.filter((s) => s.state === 'failed'))
const finished = computed(() => isTerminalJob(job.value))
const hasResult = computed(() => !!job.value?.result || (waiting.value && !!segs.value[0]?.videoUrl))
const redoOpt = (idx: number) => job.value?.decision?.options.find((o) => o.action === 'redo' && o.segIndex === idx)
/** 已成功且后端允许精修的段（付费精修必须带修改说明：只预填输入框，由用户补充后自己发送） */
const refinableSegs = computed(() => segs.value.filter((s) => s.state === 'succeeded' && s.refinable))
const kept = computed(() => segs.value.filter((s) => s.state === 'succeeded').length)

function redoText(idx: number) {
  const pts = redoOpt(idx)?.points ?? segs.value.find((s) => s.index === idx)?.points
  const price = pts ? `${fmtPts(pts)} 点，` : ''
  return `重做第 ${idx} 段（${price}已做好的 ${kept.value} 段保留）`
}
const DECISION_MESSAGE: Record<string, string> = {
  continue: '继续做剩下的',
  adjust: '我想调整一下方案',
  stop: '不继续了，只要第 1 段',
}
</script>

<template>
  <section v-if="job" class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="换片任务">
    <h3 class="vr-h3">
      {{ job.statusLabel }}
      <span v-if="job.continuity === 'smooth'" class="ml-6px inline-flex h-18px items-center rounded-9px bg-violet-soft px-6px align-middle text-10px font-600 text-violet-ink">更连贯</span>
    </h3>
    <p class="vr-sub" role="status">
      {{ finished ? job.message || job.overview : job.overview }}<template v-if="live && job.concurrencyText"> · {{ job.concurrencyText }}</template>
    </p>
    <SegmentStatusBar :segments="segs" />

    <ul v-if="failedSegs.length" class="m-0 mt-8px flex list-none flex-col gap-6px p-0">
      <li v-for="s in failedSegs" :key="s.index" class="rounded-10px bg-danger-soft px-10px py-8px text-12px leading-18px">
        <b class="text-ink">第 {{ s.index }} 段没做成</b>
        <span v-if="s.text || s.moneyText" class="block text-ink-2">{{ [s.text, s.moneyText].filter(Boolean).join(' · ') }}</span>
      </li>
    </ul>
    <ul v-if="refinableSegs.length" class="m-0 mt-8px flex list-none flex-wrap gap-6px p-0">
      <li v-for="s in refinableSegs" :key="s.index">
        <button
          type="button"
          class="sx-btn !h-28px !px-12px !text-12px"
          :disabled="busy"
          :title="s.refineLabel"
          @click="emit('draft', `精修第 ${s.index} 段：`)"
        >
          精修这一段<template v-if="refinableSegs.length > 1">（第 {{ s.index }} 段）</template>
        </button>
      </li>
    </ul>
    <div v-if="live" class="mt-8px h-4px overflow-hidden rounded-2px bg-surface3" role="progressbar" aria-label="生成中"><i class="vr-indeterminate block h-full w-1/3 rounded-2px bg-violet" /></div>

    <MoneyLine class="mt-8px" :money="job.money" breakdown />

    <!-- 第 1 段做好了：决策摘要 + 三个动作（都是发消息） -->
    <div v-if="waiting && job.decision" class="mt-10px">
      <b class="block text-13px font-600 text-ink">{{ job.decision.title }}</b>
      <div class="mt-8px flex flex-wrap gap-8px">
        <button
          v-for="o in job.decision.options.filter((x) => x.action !== 'redo')"
          :key="o.action"
          type="button"
          :class="o.action === 'continue' ? 'sx-btn-primary' : 'sx-btn'"
          class="!h-34px"
          :disabled="busy"
          @click="emit('send', DECISION_MESSAGE[o.action] ?? o.label)"
        >
          {{ o.label }}
        </button>
      </div>
      <p v-if="job.decision.remainingText" class="m-0 mt-6px text-11px leading-16px text-placeholder">{{ job.decision.remainingText }}</p>
    </div>

    <!-- 失败段：固定三选一（重做第 N 段 / 用占位预览版 / 就这样），不提供「整条重做」 -->
    <div v-if="failedSegs.length && finished" class="mt-10px">
      <div class="flex flex-wrap gap-8px">
        <button
          v-for="s in failedSegs.filter((x) => x.redoable)"
          :key="s.index"
          type="button"
          class="sx-btn-primary !h-34px"
          :disabled="busy"
          @click="emit('send', `重做第 ${s.index} 段`)"
        >
          {{ redoText(s.index) }}
        </button>
        <button type="button" class="sx-btn !h-34px" :disabled="busy" @click="emit('send', '用占位预览版')">用占位预览版</button>
        <button type="button" class="sx-btn !h-34px" :disabled="busy" @click="emit('send', '就这样')">就这样</button>
      </div>
      <p class="m-0 mt-6px text-11px leading-16px text-placeholder">重做只会重新做失败的这一段，已做好的段会保留</p>
    </div>

    <div v-if="hasResult" class="mt-12px">
      <ResultCard :job="job" :source-url="sourceUrl" :busy="busy" @renew="renew" @send="(t: string) => emit('send', t)" />
    </div>
    <p v-if="error" class="m-0 mt-8px text-12px text-warning" role="status">{{ error }}</p>
  </section>
</template>
