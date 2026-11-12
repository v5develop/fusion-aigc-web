<script setup lang="ts">
/**
 * 试穿卡的服装 / 模特槽（原型 CanvasTryonNode：服装 1 格 + 模特格子 ≤ 9，各带「+ 添加」菜单：从资产选 / 从画布选 / 上传）。
 * 槽位的数据就是连线：连到 garment / models 口的上游图片节点都算，缩略图取上游当前图；
 * 从资产 / 上传添加 = 在工具左侧新建一个图片输入节点并连到对应口（与手动拖线同一条路径，快照与契约 6.1 不变）；
 * 「×」只断开这条线，不删上游节点。服装口只收 1 条：再添加会替换原来那条。
 */
import { computed, ref } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { canvasUploadMedia } from '@/api/canvas-home.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import EditorIcon from '../EditorIcon.vue'
import { normalizeHandle } from '../graph.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'
import { uploadSizeError } from './useNodeUpload.ts'
import { FOCUS_RING } from '../ui.ts'
import type { CanvasEditorNode } from '../types.ts'

const props = defineProps<{ nodeId: string; disabled?: boolean }>()

const store = useCanvasEditor()

const MODEL_MAX = 9
type Slot = 'garment' | 'models'

/** 节点当前可展示的图（输入图 / 生成与工具的产物） */
function imageOf(node: CanvasEditorNode | undefined): string {
  const data = node?.data as { resultImage?: string; image?: string } | undefined
  return data?.resultImage ?? data?.image ?? ''
}

function linksOf(slot: Slot) {
  return store.edges.value
    .filter((edge) => edge.target === props.nodeId && normalizeHandle(edge.targetHandle) === slot)
    .map((edge) => {
      const source = store.findNode(edge.source)
      return { edgeId: edge.id, source, image: imageOf(source), name: source?.data.title || edge.source }
    })
    .filter((item) => item.source)
}
const garmentLinks = computed(() => linksOf('garment'))
const modelLinks = computed(() => linksOf('models'))
const garment = computed(() => garmentLinks.value[0])

/** 画布上可选的图片来源：有图、不是自身、不是已连在该槽的 */
function pickable(slot: Slot) {
  const linked = new Set((slot === 'garment' ? garmentLinks.value : modelLinks.value).map((item) => item.source!.id))
  return store.nodes.value.filter(
    (item) =>
      item.id !== props.nodeId &&
      (item.type === 'image' || item.type === 'model' || item.type === 'tool') &&
      !(item.type === 'tool' && item.data.tool === 'i2p') &&
      !item.data.inputOnly &&
      !linked.has(item.id) &&
      Boolean(imageOf(item)),
  )
}

function dropdownOptions(slot: Slot): DropdownOption[] {
  const canvas = pickable(slot)
  return [
    { label: '从资产选', key: 'asset' },
    {
      label: '从画布选',
      key: 'canvas',
      children: canvas.length
        ? canvas.map((item) => ({ label: item.data.title || item.id, key: `node:${item.id}` }))
        : [{ label: '画布上还没有图片', key: 'none', disabled: true }],
    },
    { label: '上传', key: 'upload' },
  ]
}

function sourceHandleOf(node: CanvasEditorNode): string {
  return node.type === 'image' ? 'image' : 'image-out'
}

/** 把来源节点接到本槽；服装口由 connect 负责「新线替换旧线」，校验不过时旧服装保留 */
function link(slot: Slot, sourceId: string): boolean {
  const source = store.findNode(sourceId)
  if (!source) return false
  return store.connect({
    source: sourceId,
    target: props.nodeId,
    sourceHandle: sourceHandleOf(source),
    targetHandle: slot,
  })
}

/** 工具左侧第一个不压住既有节点的纵向位置（从 startY 起每 200px 试一格） */
function freeSpot(x: number, startY: number): { x: number; y: number } {
  let y = startY
  const taken = (cy: number) =>
    store.nodes.value.some((n) => Math.abs(n.position.x - x) < 260 && Math.abs(n.position.y - cy) < 190)
  for (let i = 0; i < 40 && taken(y); i += 1) y += 200
  return { x, y }
}

/** 资产 / 上传得到的地址：在工具左侧新建图片输入节点并连线；连线失败则回滚新节点 */
function addImageFor(slot: Slot, urls: string[]) {
  const tool = store.findNode(props.nodeId)
  if (!tool || !urls.length) return
  const label = slot === 'garment' ? '服装' : '模特'
  const startY = tool.position.y + (slot === 'garment' ? 0 : modelLinks.value.length * 200)
  for (const url of urls) {
    const created = store.addNode('image', undefined, freeSpot(tool.position.x - 300, startY))
    if (!created) continue
    store.updateNodeData(created.id, { image: url, title: label })
    if (!link(slot, created.id)) store.removeNode(created.id)
  }
  store.selectNode(props.nodeId)
}

function removeLink(edgeId: string) {
  if (props.disabled) return
  store.removeEdgeById(edgeId)
}

// ---- 添加菜单 ----
const assetShow = ref(false)
const assetSlot = ref<Slot>('garment')
const fileRef = ref<HTMLInputElement | null>(null)
const uploadSlot = ref<Slot>('garment')
const uploading = ref(false)

function onSelect(slot: Slot, key: string | number) {
  const text = String(key)
  if (text === 'asset') {
    assetSlot.value = slot
    assetShow.value = true
  } else if (text === 'upload') {
    uploadSlot.value = slot
    fileRef.value?.click()
  } else if (text.startsWith('node:')) {
    link(slot, text.slice(5))
    store.selectNode(props.nodeId)
  }
}

const assetLimit = computed(() => (assetSlot.value === 'garment' ? 1 : Math.max(1, MODEL_MAX - modelLinks.value.length)))
function onAssets(picked: string[]) {
  const urls = picked.filter((u) => /^https?:\/\//i.test(u))
  addImageFor(assetSlot.value, assetSlot.value === 'garment' ? urls.slice(0, 1) : urls.slice(0, assetLimit.value))
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || uploading.value) return
  const slot = uploadSlot.value
  const room = slot === 'garment' ? 1 : MODEL_MAX - modelLinks.value.length
  uploading.value = true
  const urls: string[] = []
  try {
    for (const file of files.slice(0, Math.max(0, room))) {
      if (!file.type.startsWith('image/')) {
        editorMessage.warning('请选择图片文件')
        continue
      }
      const tooBig = uploadSizeError(file)
      if (tooBig) {
        editorMessage.warning(tooBig)
        continue
      }
      urls.push(await canvasUploadMedia(file))
    }
  } catch (error) {
    editorMessage.error(error instanceof Error ? error.message : '上传失败')
  } finally {
    uploading.value = false
  }
  addImageFor(slot, urls)
}

const TILE = `relative grid shrink-0 place-items-center overflow-hidden border border-solid border-line rounded-6px bg-surface2`
const ADD_TILE = `grid shrink-0 w-44px h-44px p-0 place-items-center border border-dashed border-line-strong rounded-6px bg-transparent text-muted text-18px cursor-pointer hover:border-violet-line hover:text-violet-ink disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`
const REMOVE_BTN = `absolute top-2px right-2px z-1 grid w-16px h-16px p-0 place-items-center border-none rounded-full bg-[rgba(31,35,41,0.62)] text-#fff text-11px leading-none cursor-pointer after:content-empty after:absolute after:-inset-8px disabled:cursor-not-allowed ${FOCUS_RING}`
</script>

<template>
  <div
    class="flex items-stretch gap-10px nodrag nopan nowheel"
    role="group"
    aria-label="服装与模特"
    data-node-params
    @pointerdown.stop="store.selectNode(nodeId)"
    @dblclick.stop
  >
    <!-- 服装槽 -->
    <div class="flex flex-col items-center gap-4px shrink-0 w-72px">
      <div :class="TILE" class="w-72px h-72px">
        <img
          v-if="garment?.image"
          :src="garment.image"
          :alt="garment.name"
          draggable="false"
          class="block w-full h-full object-cover"
        />
        <EditorIcon v-else name="tool" :size="20" class="text-placeholder" />
        <button
          v-if="garment"
          type="button"
          :class="REMOVE_BTN"
          :disabled="disabled"
          :aria-label="`移除服装 ${garment.name}`"
          @click="removeLink(garment.edgeId)"
        >
          ×
        </button>
      </div>
      <n-dropdown
        trigger="click"
        :options="dropdownOptions('garment')"
        :disabled="disabled || uploading"
        @select="(key: string | number) => onSelect('garment', key)"
      >
        <button
          type="button"
          class="h-28px px-6px border-none bg-transparent text-violet-ink text-12px cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :class="FOCUS_RING"
          :disabled="disabled || uploading"
        >
          {{ garment ? '更换服装' : '+ 添加服装' }}
        </button>
      </n-dropdown>
    </div>

    <span class="shrink-0 w-1px my-4px bg-line-soft" aria-hidden="true" />

    <!-- 模特槽（≤ 9） -->
    <div class="flex flex-1 min-w-0 flex-col gap-4px">
      <div class="flex flex-wrap gap-6px">
        <div v-for="item in modelLinks" :key="item.edgeId" :class="TILE" class="w-44px h-44px" :title="item.name">
          <img
            v-if="item.image"
            :src="item.image"
            :alt="item.name"
            draggable="false"
            class="block w-full h-full object-cover"
          />
          <EditorIcon v-else name="tool" :size="16" class="text-placeholder" />
          <button
            type="button"
            :class="REMOVE_BTN"
            :disabled="disabled"
            :aria-label="`移除模特 ${item.name}`"
            @click="removeLink(item.edgeId)"
          >
            ×
          </button>
        </div>
        <n-dropdown
          v-if="modelLinks.length < MODEL_MAX"
          trigger="click"
          :options="dropdownOptions('models')"
          :disabled="disabled || uploading"
          @select="(key: string | number) => onSelect('models', key)"
        >
          <button type="button" :class="ADD_TILE" :disabled="disabled || uploading" aria-label="添加模特">+</button>
        </n-dropdown>
      </div>
      <span class="text-muted text-11px">
        {{ uploading ? '上传中…' : `模特 ${modelLinks.length}/${MODEL_MAX}` }}
      </span>
    </div>

    <input ref="fileRef" type="file" accept="image/*" multiple hidden @change="onFile" />
    <AssetPickerModal v-model:show="assetShow" media="image" :limit="assetLimit" @select="onAssets" />
  </div>
</template>
