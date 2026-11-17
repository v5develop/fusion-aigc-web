<script setup lang="ts">
/** 第二步：正在看这条视频（阶段条 + 已识别内容渐进展示；分析免费）。文案取自 EXPERIENCE §4.3。 */
import { computed } from 'vue'
import AnalysisStages from './parts/AnalysisStages.vue'
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
      <AnalysisStages :stages="stages" />
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
