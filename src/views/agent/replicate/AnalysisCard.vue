<script setup lang="ts">
/** 对话卡片：视频分析（阶段 + 看懂了什么）。数据全来自事件帧里的 AnalysisView，分析免费，不涉及点数。 */
import { computed } from 'vue'
import type { ReplicateAnalysis } from '@/api/replicate.ts'
import AnalysisStages from '@/views/video-replicate/parts/AnalysisStages.vue'

const props = defineProps<{
  view: ReplicateAnalysis
  /** 智能体回复中，或卡片不在最新一条回复里：一键方案置灰 */
  disabled?: boolean
}>()
// 一键方案只是替用户发一条消息（label 原文），不调 REST
const emit = defineEmits<{ (e: 'send', text: string): void }>()
const suggestions = computed(() => (done.value ? (props.view.suggestions ?? []).filter((s) => s.label).slice(0, 3) : []))

const FALLBACK = [
  { key: 'read', label: '正在读取视频…', status: 'active' },
  { key: 'frames', label: '正在抽取画面…', status: 'pending' },
  { key: 'lines', label: '正在听台词…', status: 'pending' },
  { key: 'understand', label: '正在看懂画面…', status: 'pending' },
] as const
const stages = computed(() => (props.view.stages?.length ? props.view.stages : FALLBACK))
const done = computed(() => props.view.status === 'succeeded' && !!props.view.result)
const failed = computed(() => props.view.status === 'failed')

/** 「看懂了什么」：人物数、镜头数、时长、台词首句（有就列，没有就不列） */
const facts = computed(() => {
  const r = props.view.result
  if (!r) return []
  const out: { k: string; v: string }[] = []
  if (r.durationS) out.push({ k: '时长', v: `${Math.round(r.durationS)} 秒` })
  if (r.subjects?.length) out.push({ k: '人物', v: `${r.subjects.length} 个（${r.subjects.map((s) => s.name).slice(0, 3).join('、')}）` })
  if (r.sections?.length) out.push({ k: '镜头', v: `${r.sections.length} 个` })
  const line = r.onScreenText?.[0]?.text
  if (line) out.push({ k: '字幕首句', v: line })
  return out
})
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="视频分析">
    <h3 class="vr-h3">
      <template v-if="done">看懂了这条视频</template>
      <template v-else-if="failed">分析没成功</template>
      <template v-else>正在看这条视频</template>
    </h3>
    <p class="vr-sub">{{ failed ? view.error || '可以重新发一次视频再试' : view.freeText || '分析免费，不扣点数' }}</p>
    <p v-if="view.cached && view.cachedText" class="m-0 mb-8px text-12px text-success" role="status">{{ view.cachedText }}</p>
    <AnalysisStages v-if="!failed" :stages="stages" />
    <template v-if="done">
      <p v-if="view.result?.summary" class="m-0 mt-10px text-13px leading-20px text-ink-2">{{ view.result.summary }}</p>
      <dl v-if="facts.length" class="m-0 mt-8px grid grid-cols-[auto_1fr] gap-x-12px gap-y-4px text-12px">
        <template v-for="f in facts" :key="f.k">
          <dt class="text-muted">{{ f.k }}</dt>
          <dd class="m-0 min-w-0 break-words text-ink-2">{{ f.v }}</dd>
        </template>
      </dl>
      <div v-if="suggestions.length" class="mt-12px flex flex-col gap-6px" role="group" aria-label="一键方案">
        <button
          v-for="s in suggestions"
          :key="s.key"
          type="button"
          class="flex w-full flex-col items-start gap-2px rounded-12px border border-solid border-line bg-transparent px-12px py-8px text-left transition-colors enabled:cursor-pointer enabled:hover:bg-violet-tint disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="disabled"
          @click="emit('send', s.label)"
        >
          <span class="text-13px font-500 leading-20px text-ink">{{ s.label }}</span>
          <span v-if="s.desc" class="text-12px leading-18px text-muted">{{ s.desc }}</span>
        </button>
      </div>
    </template>
  </section>
</template>
