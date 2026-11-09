<script setup lang="ts">
/**
 * 图片节点：input = 用户上传的输入图（image 口输出）；result = 模板承接结果图（image-in 口输入）。
 * 上传走网关预签名直传，快照里只存 http(s) 地址（契约 1.6 禁 dataURL）；上传中可「取消」（中止直传）。
 * 有图时悬停出底部毛玻璃操作条（原型 .wf-image-node__actions）：裁剪 / 高清放大（新建下游工具节点并连线）/
 * 更换（重新上传，仅输入图）/ 查看大图（灯箱，可下载）。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass } from '../ports.ts'
import {
  CHECKER_BG,
  FOCUS_RING,
  NODE_CARD,
  NODE_CARD_SELECTED,
  NODE_HEAD,
  NODE_TITLE,
  type IQuickAddRequest,
} from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'
import NodeLightbox from './NodeLightbox.vue'
import { openColorFix } from '../colorFixAction.ts'
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

const isResult = computed(() => props.data.kind === 'result')
const width = computed(() => props.data.width ?? 240)

/**
 * 图片区高度（原型 CanvasImageNode：默认 240×200，body 内边距 12；图片加载后按原图比例撑开，
 * 媒体高度上限 520）。原型把比例写回快照，这里只做本地显示计算，不改快照。
 */
const naturalRatio = ref(0)
const mediaHeight = computed(() => {
  const inner = width.value - 24
  if (props.data.image && naturalRatio.value > 0) {
    return Math.round(Math.min(520, Math.max(100, inner / naturalRatio.value)))
  }
  return Math.max(100, (props.data.height ?? 200) - 36 - 24)
})

function onImageLoad(event: Event) {
  const img = event.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) naturalRatio.value = img.naturalWidth / img.naturalHeight
}

/** 上传 / 资产库共用：快照里只存 http(s) 地址 */
function setMedia(url: string) {
  store.updateNodeData(props.id, { image: url, assetId: undefined, mediaId: undefined })
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
  failText: '图片上传失败',
  onUploaded: (url) => setMedia(url),
})

/** 操作条按钮：视觉 28（原型 30，按审计收到 28），间距 8、::after 外扩 4 → 命中 36 不互相覆盖 */
const BAR_BTN = `relative grid w-28px h-28px p-0 place-items-center border-none rounded-5px bg-transparent text-[#2a303b] cursor-pointer hover:bg-[rgba(15,23,42,0.06)] hover:text-ink after:content-empty after:absolute after:-inset-4px nodrag ${FOCUS_RING}`

function makeTool(tool: 'crop' | 'upscale') {
  store.addConnectedToolNode(props.id, tool)
}

const lightboxShow = ref(false)
const lightboxItems = computed(() =>
  props.data.image ? [{ url: props.data.image, type: 'image' as const, name: props.data.title || '图片' }] : [],
)

// 拖入 / 粘贴到空的上传块：类型与文件框 accept 一致，走同一个上传函数
const dropRef = ref<HTMLElement | null>(null)
const ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'image',
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
    <header :class="NODE_HEAD">
      <span class="flex-1" :class="NODE_TITLE">{{ data.title || '图片' }}</span>
      <span
        v-if="isResult"
        class="shrink-0 px-6px py-1px border border-solid border-violet-line rounded-3px bg-violet-soft text-violet-ink text-11px font-600 leading-16px"
        >结果图</span
      >
      <NodeMenu
        :title="data.title || '图片'"
        :removable="!isResult || Boolean(data.actionOrigin)"
        :image-actions-for="id"
        @remove="emit('remove')"
      />
    </header>
    <div class="p-12px rounded-b-8px bg-surface3">
      <div
        class="relative grid w-full place-items-center overflow-hidden"
        :style="{ height: `${mediaHeight}px` }"
      >
        <img
          v-if="data.image"
          :src="data.image"
          :alt="data.title"
          draggable="false"
          class="block w-full h-full object-contain"
          @load="onImageLoad"
        />
        <div v-else-if="!isResult" class="relative w-full h-full">
          <button
            ref="dropRef"
            type="button"
            class="flex flex-col w-full h-full items-center justify-center gap-8px p-0 border border-dashed border-[#d8dce6] rounded-6px bg-[#fafbfc] text-11px cursor-pointer transition-colors duration-120 hover:border-[#c9b4d6] hover:bg-[#faf7fc] hover:text-violet nodrag"
            :class="[FOCUS_RING, dragging && 'sx-drop', uploading ? 'text-violet-ink' : 'text-placeholder']"
            :disabled="uploading"
            title="上传图片"
            @click.stop="pick"
          >
            <EditorIcon name="image" :size="22" />
            <span>上传图片</span>
            <small class="text-placeholder text-11px">JPG / PNG / WebP</small>
          </button>
          <!-- 从资产库添加：上传块的兄弟节点（按钮里不能再套按钮），右上角内缩 12 -->
          <button
            type="button"
            class="absolute right-12px top-12px z-1 px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) nodrag"
            :class="FOCUS_RING"
            aria-label="从资产库添加图片"
            :disabled="uploading"
            @click.stop="openAssets"
          >
            从资产库添加
          </button>
        </div>
        <span
          v-else
          class="flex flex-col w-full h-full items-center justify-center gap-8px rounded-6px text-placeholder text-11px"
          :class="CHECKER_BG"
        >
          <EditorIcon name="image" :size="22" />
          <span>连一条图片输入</span>
        </span>

        <!-- 上传中（首次上传与「更换」共用）：盖在图片区上，可取消 -->
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

        <!--
          悬浮操作条（原型 .wf-image-node__actions）：底部居中、离底 20、玻璃 rgba(255,255,255,.34) + blur 18、r9；
          悬停 / 选中节点时显示，键盘聚焦与触屏常显。
        -->
        <div
          v-else-if="data.image"
          class="absolute left-50% bottom-20px z-2 flex gap-8px p-4px rounded-9px bg-white/34 backdrop-blur-18px backdrop-saturate-170 shadow-[0_0_0_0.5px_rgba(15,23,42,0.10),0_6px_16px_rgba(15,23,42,0.10)] -translate-x-50% opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100 [.is-selected_&]:opacity-100 [@media(hover:none)]:opacity-100"
          role="toolbar"
          :aria-label="`${data.title || '图片'} 操作`"
        >
          <button type="button" :class="BAR_BTN" title="裁剪" aria-label="裁剪：新建裁剪工具节点" @click.stop="makeTool('crop')">
            <EditorIcon name="crop" :size="14" />
          </button>
          <button
            type="button"
            :class="BAR_BTN"
            title="高清放大"
            aria-label="高清放大：新建高清放大工具节点"
            @click.stop="makeTool('upscale')"
          >
            <EditorIcon name="sparkles" :size="14" />
          </button>
          <button v-if="!isResult" type="button" :class="BAR_BTN" title="更换" aria-label="更换图片" @click.stop="pick">
            <EditorIcon name="replace" :size="14" />
          </button>
          <button
            type="button"
            :class="BAR_BTN"
            title="校色"
            aria-label="校色：调整偏色并生成新节点"
            @click.stop="openColorFix(id, data.image)"
          >
            <EditorIcon name="sliders" :size="14" />
          </button>
          <button
            type="button"
            :class="BAR_BTN"
            title="查看大图"
            aria-label="查看大图"
            @click.stop="lightboxShow = true"
          >
            <EditorIcon name="expand" :size="14" />
          </button>
        </div>
      </div>
      <input
        ref="fileRef"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        class="nodrag"
        hidden
        @change="onFile"
      />
      <AssetPickerModal v-if="assetMounted" v-model:show="assetShow" :limit="1" @select="onAssets" />
    </div>
    <NodeQuickAdd :kinds="['image-model', 'video-model', 'tool']" @open="emit('quickAdd', $event)" />
    <Handle v-if="isResult" id="image-in" type="target" :position="Position.Left" :class="portClass('image')" />
    <Handle id="image" type="source" :position="Position.Right" :class="portClass('image')" />
    <NodeResize :id="id" kind="image" :title="data.title || '图片'" />
    <NodeLightbox v-model:show="lightboxShow" :items="lightboxItems" />
  </div>
</template>
