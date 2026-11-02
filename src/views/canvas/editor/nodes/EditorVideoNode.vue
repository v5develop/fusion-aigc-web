<script setup lang="ts">
/** 视频输入节点：上传参考视频（video 口输出，只收视频模型生成的视频，见契约 6.1） */
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const store = useCanvasEditor()
const fileRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const width = computed(() => props.data.width ?? 260)

function pick() {
  fileRef.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value) return
  uploading.value = true
  try {
    const url = await canvasUploadMedia(file)
    store.updateNodeData(props.id, { video: url })
  } catch (error) {
    editorMessage.error(error instanceof Error ? error.message : '视频上传失败')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="ll-card group relative text-12px text-ink" :class="{ 'is-selected': selected, '!border-violet !shadow-[0_0_0_2px_rgba(135,95,154,0.18),0_10px_18px_-10px_rgba(31,35,41,0.22)]': selected }" :style="{ width: `${width}px` }">
    <header class="flex h-34px items-center gap-8px pl-12px pr-10px border-b border-line-soft rounded-t-10px">
      <span class="shrink-0 w-8px h-8px rounded-full bg-[#f97373]" />
      <span class="overflow-hidden flex-1 text-13px font-600 text-ellipsis whitespace-nowrap">{{ data.title || '视频' }}</span>
      <span class="shrink-0 px-6px py-1px rounded-4px bg-violet-soft text-violet-ink text-10px leading-16px">参考视频</span>
      <button type="button" class="absolute -top-9px -right-9px z-3 grid w-20px h-20px p-0 place-items-center border border-line rounded-full bg-white text-muted text-12px leading-none cursor-pointer opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:border-danger-line hover:bg-danger-soft hover:text-danger" title="删除节点" @click.stop="emit('remove')">×</button>
    </header>
    <div class="px-10px pt-8px pb-10px">
      <div class="grid w-full place-items-center overflow-hidden rounded-8px border border-line-soft [background:repeating-conic-gradient(#f3f4f5_0%,#f3f4f5_25%,transparent_0%,transparent_50%)_0_0/14px_14px,#f7f8f9]" :style="{ height: `${Math.max(120, width * 0.75)}px` }">
        <video v-if="data.video" :src="data.video" controls preload="metadata" class="block w-full max-h-240px object-contain nodrag nowheel" />
        <button v-else type="button" class="flex flex-col items-center gap-6px w-full px-0 py-22px border-none bg-transparent text-placeholder text-11px hover:text-violet-ink cursor-pointer nodrag" :disabled="uploading" @click.stop="pick">
          <EditorIcon name="video" :size="22" />
          <span>{{ uploading ? '上传中…' : '上传视频' }}</span>
        </button>
      </div>
      <input ref="fileRef" type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" class="nodrag" hidden @change="onFile" />
    </div>
    <Handle id="video" type="source" :position="Position.Right" class="ed-port ed-port--video" />
  </div>
</template>

<style scoped lang="less">
// Handle 是 Vue Flow 组件，自带 .vue-flow__handle 样式，端口样式留在 Less 以保证优先级
@import '../node-base.less';
</style>
