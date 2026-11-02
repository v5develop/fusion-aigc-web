<script setup lang="ts">
/**
 * 图片节点：input = 用户上传的输入图（image 口输出）；result = 模板承接结果图（image-in 口输入）。
 * 上传走网关预签名直传，快照里只存 http(s) 地址（契约 1.6 禁 dataURL）。
 */
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

const isResult = computed(() => props.data.kind === 'result')
const width = computed(() => props.data.width ?? 240)

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
    store.updateNodeData(props.id, { image: url })
  } catch (error) {
    editorMessage.error(error instanceof Error ? error.message : '图片上传失败')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="ll-card group relative text-12px text-ink" :class="{ 'is-selected': selected, '!border-violet !shadow-[0_0_0_2px_rgba(135,95,154,0.18),0_10px_18px_-10px_rgba(31,35,41,0.22)]': selected }" :style="{ width: `${width}px` }">
    <header class="flex h-34px items-center gap-8px pl-12px pr-10px border-b border-line-soft rounded-t-10px">
      <span class="shrink-0 w-8px h-8px rounded-full bg-[#38bdf8]" />
      <span class="overflow-hidden flex-1 text-13px font-600 text-ellipsis whitespace-nowrap">{{ data.title || '图片' }}</span>
      <span class="shrink-0 px-6px py-1px rounded-4px bg-violet-soft text-violet-ink text-10px leading-16px">{{ isResult ? '结果图' : '参考图' }}</span>
      <button v-if="!isResult" type="button" class="absolute -top-9px -right-9px z-3 grid w-20px h-20px p-0 place-items-center border border-line rounded-full bg-white text-muted text-12px leading-none cursor-pointer opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:border-danger-line hover:bg-danger-soft hover:text-danger" title="删除节点" @click.stop="emit('remove')">×</button>
    </header>
    <div class="px-10px pt-8px pb-10px">
      <div class="grid w-full place-items-center overflow-hidden rounded-8px border border-line-soft [background:repeating-conic-gradient(#f3f4f5_0%,#f3f4f5_25%,transparent_0%,transparent_50%)_0_0/14px_14px,#f7f8f9]" :style="{ height: `${Math.max(120, width * 0.85)}px` }">
        <img v-if="data.image" :src="data.image" :alt="data.title" draggable="false" class="block w-full max-h-240px object-contain" />
        <button
          v-else-if="!isResult"
          type="button"
          class="flex flex-col items-center gap-6px w-full px-0 py-22px border-none bg-transparent text-placeholder text-11px hover:text-violet-ink cursor-pointer nodrag"
          :disabled="uploading"
          @click.stop="pick"
        >
          <EditorIcon name="image" :size="22" />
          <span>{{ uploading ? '上传中…' : '上传图片' }}</span>
        </button>
        <span v-else class="flex flex-col items-center gap-6px w-full px-0 py-22px border-none bg-transparent text-placeholder text-11px hover:text-violet-ink cursor-default">
          <EditorIcon name="image" :size="22" />
          <span>连一条图片输入</span>
        </span>
      </div>
      <input ref="fileRef" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" class="nodrag" hidden @change="onFile" />
    </div>
    <Handle
      v-if="isResult"
      id="image-in"
      type="target"
      :position="Position.Left"
      class="ed-port ed-port--image"
    />
    <Handle id="image" type="source" :position="Position.Right" class="ed-port ed-port--image" />
  </div>
</template>

<style scoped lang="less">
// Handle 是 Vue Flow 组件，自带 .vue-flow__handle 样式，端口样式留在 Less 以保证优先级
@import '../node-base.less';
</style>
