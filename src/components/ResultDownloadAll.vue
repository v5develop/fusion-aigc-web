<script setup lang="ts">
/**
 * 预览区「N 张结果 · 下载全部」条（结果 ≥ 2 张时放在候选缩略图条上方；工具页与商拍工作室共用）。
 * 逐个下载、间隔 120ms，成功 / 失败各自提示；校色烘图由调用方在对应项上挂 bake。
 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { downloadAllSequential, type BatchDownloadItem } from '@/utils/batchDownload'

const props = defineProps<{
  items: BatchDownloadItem[]
  /** 计数文案里的量词，默认「张」 */
  unit?: string
}>()

const message = useMessage()
const busy = ref(false)

async function run() {
  if (busy.value || props.items.length < 2) return
  busy.value = true
  try {
    const { ok, failed } = await downloadAllSequential(props.items)
    if (!ok) message.error('批量下载失败')
    else if (failed) message.warning(`已开始下载 ${ok} 个结果，${failed} 个下载失败`)
    else message.success(`已开始下载 ${ok} 个结果`)
  } catch {
    message.error('批量下载失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="items.length >= 2" class="flex flex-none items-center justify-between gap-8px min-w-0">
    <span class="text-12px leading-18px text-muted tabular-nums">{{ items.length }} {{ unit ?? '张' }}结果</span>
    <button
      type="button"
      class="inline-flex h-28px flex-none cursor-pointer items-center gap-4px rounded-6px border border-solid border-line bg-white px-10px text-12px font-500 text-ink-2 hover:(border-violet-line text-violet-ink) disabled:(cursor-not-allowed opacity-60) motion-reduce:transition-none sx-focus"
      :disabled="busy"
      :aria-busy="busy"
      @click="run"
    >
      <svg
        class="h-14px w-14px"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      {{ busy ? '下载中…' : '下载全部' }}
    </button>
  </div>
</template>
