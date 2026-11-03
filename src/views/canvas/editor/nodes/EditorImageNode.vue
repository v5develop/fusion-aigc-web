<script setup lang="ts">
/**
 * 图片节点：input = 用户上传的输入图（image 口输出）；result = 模板承接结果图（image-in 口输入）。
 * 上传走网关预签名直传，快照里只存 http(s) 地址（契约 1.6 禁 dataURL）。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'
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
  store.updateNodeData(props.id, { image: url })
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
    editorMessage.error(error instanceof Error ? error.message : '图片上传失败')
  } finally {
    uploading.value = false
  }
}

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
      <div class="grid w-full place-items-center overflow-hidden" :style="{ height: `${mediaHeight}px` }">
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
            <span>{{ uploading ? '上传中…' : '上传图片' }}</span>
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
  </div>
</template>
