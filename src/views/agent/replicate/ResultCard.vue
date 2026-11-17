<script setup lang="ts">
/**
 * 对话卡片：成片（原片与成片并排 + 保存状态）。纯展示：地址由 JobCard 经 useJobCard 取得并传入，
 * 播放出错 / 下载前往外抛 renew 事件续签。原片地址取自对话里用户上传的那条视频（没有就只显示成片）。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { ReplicateJob } from '@/api/replicate.ts'
import ResultCompare from '@/views/video-replicate/parts/ResultCompare.vue'

const props = defineProps<{
  job: ReplicateJob
  /** 对话里用户上传的原片地址（可空） */
  sourceUrl?: string
}>()
const emit = defineEmits<{ (e: 'renew', force: boolean): void }>()

const result = computed(() => props.job.result)
const preview = computed(() => result.value?.kind === 'preview')
const firstSeg = computed(() => props.job.segments[0])
/** 等你确认时没有整条成片：并排放原片与第 1 段 */
const firstOnly = computed(() => props.job.status === 'waiting' && !result.value?.videoUrl)
const url = computed(() => {
  if (firstOnly.value) return firstSeg.value?.videoUrl
  // 预览版（含失败段占位）只给预览图，不播
  if (preview.value) return result.value?.coverUrl || result.value?.videoUrl
  return result.value?.videoUrl
})
const label = computed(() => (firstOnly.value ? '你的成片 · 第 1 段' : preview.value ? '预览版' : '你的成片'))
const sourceLabel = computed(() => (firstOnly.value ? '原片 · 第 1 段' : '原片'))

/** 保存状态：全部以后端为准——有 result.text 用它，否则按成片状态给一句 */
const saveText = computed(() => {
  const r = result.value
  if (!r) return ''
  if (r.text) return r.text
  if (r.status === 'ready') return preview.value ? '预览版，仅供预览，暂不能下载' : '成片已生成，会保存在你的资产里'
  if (r.status === 'retry') return '正在把几段接成一条…'
  return '成片暂时拿不到，可以稍后再看'
})
const canDownload = computed(() => !!result.value?.videoUrl && !preview.value && result.value?.status === 'ready')
function download() {
  emit('renew', false)
  const u = props.job.result?.videoUrl
  if (u) window.open(u, '_blank', 'noopener')
}
</script>

<template>
  <div class="flex flex-col gap-8px">
    <ResultCompare
      :source-url="sourceUrl"
      :source-label="sourceLabel"
      source-empty="没有原片可对照"
      :result-url="url"
      :result-label="label"
      :result-as-image="preview"
      :result-empty="result?.status === 'ready' ? '播放地址暂时没拿到，稍后会自动刷新' : '成片还在合成'"
      @result-play="emit('renew', false)"
      @result-error="emit('renew', true)"
    />
    <p v-if="saveText" class="m-0 text-12px leading-18px text-muted" role="status">{{ saveText }}</p>
    <div class="flex flex-wrap gap-8px">
      <button v-if="canDownload" type="button" class="sx-btn !h-32px" @click="download">下载</button>
      <RouterLink :to="{ name: 'video-replicate', query: { job: String(job.jobId) } }" class="sx-btn !h-32px no-underline">在完整页查看</RouterLink>
    </div>
  </div>
</template>
