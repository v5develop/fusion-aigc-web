<script setup lang="ts">
/** 第二步：正在看这条视频（阶段条 + 已识别内容渐进展示；分析免费）。文案取自 EXPERIENCE §4.3。 */
import { computed } from 'vue'
import type { useReplicate } from './useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const rep = props.rep

/** 四个阶段与状态全部来自后端 stages[]（done / active / pending / skipped）；还没回包时先显示读取中 */
const FALLBACK = [
  { key: 'read', label: '正在读取视频…', status: 'active' },
  { key: 'frames', label: '正在抽取画面…', status: 'pending' },
  { key: 'lines', label: '正在听台词…', status: 'pending' },
  { key: 'understand', label: '正在看懂画面…', status: 'pending' },
] as const
const stages = computed(() => (rep.analysis.value?.stages?.length ? rep.analysis.value.stages : FALLBACK))
</script>

<template>
  <section class="vr-panel">
    <template v-if="!rep.analysisError.value">
      <h3 class="vr-h3">正在看这条视频</h3>
      <p class="vr-sub">{{ rep.analysis.value?.freeText || '分析免费，不扣点数；只分析一次，之后改方案不用再等' }}</p>
      <p v-if="rep.analysis.value?.cached && rep.analysis.value.cachedText" class="m-0 mb-8px text-12px text-success" role="status">{{ rep.analysis.value.cachedText }}</p>
      <ol class="m-0 flex list-none flex-col gap-8px p-0" aria-live="polite">
        <li
          v-for="t in stages"
          :key="t.key"
          :class="['flex items-center gap-8px text-13px', t.status === 'done' || t.status === 'skipped' ? 'text-ink-2' : t.status === 'active' ? 'font-600 text-ink' : 'text-placeholder']"
        >
          <span
            :class="[
              'grid h-16px w-16px flex-none place-items-center rounded-full border border-solid',
              t.status === 'done' ? 'border-success bg-success text-white' : t.status === 'active' ? 'border-violet' : 'border-line',
            ]"
            aria-hidden="true"
          >
            <svg v-if="t.status === 'done'" class="h-10px w-10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            <i v-else-if="t.status === 'active'" class="vr-pulse block h-6px w-6px rounded-full bg-violet" />
          </span>
          {{ t.label }}<small v-if="t.status === 'skipped'" class="ml-6px text-11px text-placeholder">原片没有声音，已跳过</small>
        </li>
      </ol>
      <div class="mt-14px flex items-center gap-12px">
        <span class="text-12px text-muted">已用 {{ rep.analysisElapsed.value }} 秒</span>
        <span class="flex-1" />
        <button type="button" class="sx-btn" @click="rep.cancelAnalysis()">取消</button>
      </div>
      <p v-if="rep.analysisElapsed.value > 40" class="m-0 mt-10px text-12px text-muted">
        这条视频有点复杂，还需要一会儿。可以先做别的，分析好了会显示在这一页
      </p>
    </template>
    <template v-else>
      <h3 class="vr-h3">{{ rep.analysisRetryable.value ? '分析没成功' : '这个视频无法解析' }}</h3>
      <p class="vr-sub">{{ rep.analysisError.value }}</p>
      <div class="flex gap-8px">
        <button v-if="rep.analysisRetryable.value" type="button" class="sx-btn-primary" @click="rep.startAnalysis()">重新分析</button>
        <button type="button" class="sx-btn" @click="rep.cancelAnalysis()">换一条视频</button>
      </div>
    </template>
  </section>
</template>
