<script setup lang="ts">
/** 视频输入节点：上传参考视频（video 口输出，只收视频模型生成的视频，见契约 6.1） */
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass } from '../ports.ts'
import { FOCUS_RING, NODE_CARD, NODE_CARD_SELECTED, NODE_HEAD, NODE_TITLE, type QuickAddKind } from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; quickAdd: [kind: QuickAddKind] }>()

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
  <div
    :class="[NODE_CARD, { 'is-selected': selected, [NODE_CARD_SELECTED]: selected }]"
    :style="{ width: `${width}px` }"
  >
    <header :class="NODE_HEAD">
      <span class="shrink-0 w-8px h-8px rounded-full bg-danger" />
      <span class="flex-1" :class="NODE_TITLE">{{ data.title || '视频' }}</span>
      <NodeMenu :title="data.title || '视频'" @remove="emit('remove')" />
    </header>
    <div class="p-12px rounded-b-8px bg-surface3">
      <div
        class="grid w-full place-items-center overflow-hidden rounded-4px"
        :style="{ height: `${Math.max(120, (width - 24) * 0.75)}px` }"
      >
        <video
          v-if="data.video"
          :src="data.video"
          controls
          preload="metadata"
          class="block w-full h-full rounded-4px bg-black object-contain nodrag nowheel"
        />
        <button
          v-else
          type="button"
          class="flex flex-col w-full h-full items-center justify-center gap-8px p-0 border border-dashed border-line-strong rounded-6px bg-surface2 text-placeholder text-11px cursor-pointer hover:text-violet-ink nodrag"
          :class="FOCUS_RING"
          :disabled="uploading"
          title="上传视频"
          @click.stop="pick"
        >
          <EditorIcon name="video" :size="22" />
          <span>{{ uploading ? '上传中…' : '上传视频' }}</span>
        </button>
      </div>
      <input
        ref="fileRef"
        type="file"
        accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
        class="nodrag"
        hidden
        @change="onFile"
      />
    </div>
    <NodeQuickAdd :kinds="['video-model']" @pick="emit('quickAdd', $event)" />
    <Handle id="video" type="source" :position="Position.Right" :class="portClass('video')" />
  </div>
</template>
