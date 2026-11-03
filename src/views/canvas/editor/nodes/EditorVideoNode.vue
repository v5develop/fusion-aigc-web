<script setup lang="ts">
/** 视频输入节点：上传参考视频（video 口输出，只收视频模型生成的视频，见契约 6.1） */
import { computed, defineAsyncComponent, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass } from '../ports.ts'
import { FOCUS_RING, NODE_CARD, NODE_CARD_SELECTED, NODE_HEAD_PLAIN, NODE_TITLE, type IQuickAddRequest } from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'

// 资产库选择弹窗按需加载：画布上节点多，点了才挂
const AssetPickerModal = defineAsyncComponent(() => import('@/views/studio/components/AssetPickerModal/index.vue'))

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; quickAdd: [request: IQuickAddRequest] }>()

const store = useCanvasEditor()
const fileRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

/** 原型 useNodeResize 默认 338×350；媒体区 = 节点高 − 头 36 − 内边距 20 */
const width = computed(() => props.data.width ?? 338)
const mediaHeight = computed(() => Math.max(120, (props.data.height ?? 350) - 36 - 20))

function pick() {
  fileRef.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await uploadFile(file)
}

/** 上传 / 资产库共用：快照里只存 http(s) 地址 */
function setMedia(url: string) {
  store.updateNodeData(props.id, { video: url })
}

// 从资产库添加：选回已在存储里的地址，直接落节点
const assetShow = ref(false)
const assetMounted = ref(false)
function openAssets() {
  if (uploading.value) return
  assetMounted.value = true
  assetShow.value = true
}
function onAssets(picked: string[]) {
  const url = picked.find((u) => /^https?:\/\//i.test(u))
  if (url) setMedia(url)
}

/** 选文件 / 拖入 / 粘贴共用 */
async function uploadFile(file: File) {
  if (uploading.value) return
  uploading.value = true
  try {
    setMedia(await canvasUploadMedia(file))
  } catch (error) {
    editorMessage.error(error instanceof Error ? error.message : '视频上传失败')
  } finally {
    uploading.value = false
  }
}

// 拖入 / 粘贴到空的上传块：类型与文件框 accept 一致，走同一个上传函数
const dropRef = ref<HTMLElement | null>(null)
const ACCEPT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'video',
  filter: (f) => ACCEPT_TYPES.includes(f.type),
  disabled: uploading,
  onFiles: ([file]) => {
    if (file) uploadFile(file)
  },
})
</script>

<template>
  <div
    :class="[NODE_CARD, { 'is-selected': selected, [NODE_CARD_SELECTED]: selected }]"
    :style="{ width: `${width}px` }"
  >
    <header :class="NODE_HEAD_PLAIN">
      <span class="flex-1" :class="NODE_TITLE">{{ data.title || '视频' }}</span>
      <NodeMenu :title="data.title || '视频'" @remove="emit('remove')" />
    </header>
    <div class="p-10px rounded-b-8px bg-[#f4f6fa]">
      <div class="grid w-full place-items-center overflow-hidden" :style="{ height: `${mediaHeight}px` }">
        <video
          v-if="data.video"
          :src="data.video"
          controls
          preload="metadata"
          class="block w-full h-full rounded-6px bg-black object-contain nodrag nowheel"
        />
        <div v-else class="relative w-full h-full">
          <button
            ref="dropRef"
            type="button"
            class="flex flex-col w-full h-full items-center justify-center gap-6px p-0 border border-dashed border-[#d9d9d9] rounded-6px bg-white text-12px cursor-pointer transition-colors duration-120 hover:border-violet-line hover:text-violet nodrag"
            :class="[FOCUS_RING, dragging && 'sx-drop', uploading ? 'text-violet font-600' : 'text-[#7f7f7f]']"
            :disabled="uploading"
            title="上传视频"
            @click.stop="pick"
          >
            <EditorIcon name="video" :size="24" />
            <span>{{ uploading ? '上传中…' : '上传视频' }}</span>
            <small class="text-[#9d9d9d] text-10px">MP4 / WebM / MOV</small>
          </button>
          <!-- 从资产库添加：上传块的兄弟节点（按钮里不能再套按钮），右上角内缩 12 -->
          <button
            type="button"
            class="absolute right-12px top-12px z-1 px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) nodrag"
            :class="FOCUS_RING"
            aria-label="从资产库添加视频"
            :disabled="uploading"
            @click.stop="openAssets"
          >
            从资产库添加
          </button>
        </div>
      </div>
      <input
        ref="fileRef"
        type="file"
        accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
        class="nodrag"
        hidden
        @change="onFile"
      />
      <AssetPickerModal v-if="assetMounted" v-model:show="assetShow" media="video" :limit="1" @select="onAssets" />
    </div>
    <NodeQuickAdd :kinds="['video-model']" top="calc(50% + 28px)" @open="emit('quickAdd', $event)" />
    <Handle id="video" type="source" :position="Position.Right" :class="portClass('video')" />
    <NodeResize :id="id" kind="video" :title="data.title || '视频'" />
  </div>
</template>
