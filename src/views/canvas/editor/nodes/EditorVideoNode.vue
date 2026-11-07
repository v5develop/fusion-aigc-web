<script setup lang="ts">
/**
 * 视频输入节点：上传参考视频（video 口输出，只收视频模型生成的视频，见契约 6.1）。
 * 上传中可「取消」（中止直传）；有视频时右上角悬停出「更换 / 下载」（放右上角，不压底部播放控件）。
 * 格式：网关预签名只放行 mp4 / mov（presign_upload_logic.go uploadExts，webm 会被拒），文件框与提示同口径。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass } from '../ports.ts'
import { FOCUS_RING, NODE_CARD, NODE_CARD_SELECTED, NODE_HEAD_PLAIN, NODE_TITLE, type IQuickAddRequest } from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'
import { useNodeUpload } from './useNodeUpload.ts'
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

/** 原型 useNodeResize 默认 338×350；媒体区 = 节点高 − 头 36 − 内边距 20 */
const width = computed(() => props.data.width ?? 338)
const mediaHeight = computed(() => Math.max(120, (props.data.height ?? 350) - 36 - 20))

/** 上传 / 资产库共用：快照里只存 http(s) 地址 */
function setMedia(url: string) {
  store.updateNodeData(props.id, { video: url, assetId: undefined, mediaId: undefined })
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

const { uploading, pick, uploadFile, cancelUpload, onFile } = useNodeUpload({
  nodeId: () => props.id,
  fileRef,
  failText: '视频上传失败',
  onUploaded: (url) => setMedia(url),
})

/** 视频下载文件名：节点标题 */
const downloadName = computed(() => props.data.title || '视频')

/** 右上角操作钮：视觉 28、间距 8、::after 外扩 4 → 命中 36 */
const VIDEO_BTN = `relative grid w-28px h-28px p-0 place-items-center border border-solid border-white/60 rounded-5px bg-white/88 text-ink no-underline cursor-pointer backdrop-blur-6px shadow-[0_1px_3px_rgba(31,35,41,0.18)] hover:bg-white hover:text-violet-ink after:content-empty after:absolute after:-inset-4px nodrag ${FOCUS_RING}`

// 拖入 / 粘贴到空的上传块：类型与文件框 accept 一致，走同一个上传函数
const dropRef = ref<HTMLElement | null>(null)
const ACCEPT_TYPES = ['video/mp4', 'video/quicktime']
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
      <div
        class="relative grid w-full place-items-center overflow-hidden"
        :style="{ height: `${mediaHeight}px` }"
      >
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
            <span>上传视频</span>
            <small class="text-muted text-11px">MP4 / MOV</small>
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

        <!-- 上传中（首次上传与「更换」共用）：可取消 -->
        <div
          v-if="uploading"
          class="absolute inset-0 z-3 flex flex-col items-center justify-center gap-8px rounded-6px bg-white/86 text-violet-ink text-12px"
          role="status"
        >
          <span
            class="w-14px h-14px border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-800"
            aria-hidden="true"
          />
          <span>上传中…</span>
          <button
            type="button"
            class="h-28px px-12px border border-solid border-control rounded-4px bg-white text-ink-2 text-12px cursor-pointer hover:border-control-hover hover:text-ink nodrag"
            :class="FOCUS_RING"
            @click.stop="cancelUpload"
          >
            取消
          </button>
        </div>
        <!-- 有视频：右上角「更换 / 下载」，悬停 / 选中显示，键盘聚焦与触屏常显（下载不只靠悬停） -->
        <div
          v-else-if="data.video"
          class="absolute top-8px right-8px z-2 flex gap-8px opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100 [.is-selected_&]:opacity-100 [@media(hover:none)]:opacity-100"
          role="toolbar"
          :aria-label="`${data.title || '视频'} 操作`"
        >
          <button type="button" :class="VIDEO_BTN" title="更换" aria-label="更换视频" @click.stop="pick">
            <EditorIcon name="replace" :size="14" />
          </button>
          <a
            :href="data.video"
            :download="downloadName"
            target="_blank"
            rel="noopener noreferrer"
            :class="VIDEO_BTN"
            title="下载"
            aria-label="下载视频"
            @click.stop
          >
            <EditorIcon name="download" :size="14" />
          </a>
        </div>
      </div>
      <input
        ref="fileRef"
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        class="nodrag"
        hidden
        @change="onFile"
      />
      <AssetPickerModal v-if="assetMounted" v-model:show="assetShow" media="video" :limit="1" @select="onAssets" />
    </div>
    <!-- 「+」与输出口同在 50%：「+」在卡片右外侧 40px，碰不到卡片内的播放控件 -->
    <NodeQuickAdd :kinds="['video-model']" @open="emit('quickAdd', $event)" />
    <Handle id="video" type="source" :position="Position.Right" :class="portClass('video')" />
    <NodeResize :id="id" kind="video" :title="data.title || '视频'" />
  </div>
</template>
