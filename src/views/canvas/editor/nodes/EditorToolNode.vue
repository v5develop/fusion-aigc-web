<script setup lang="ts">
/**
 * 工具节点：crop / upscale / outpaint / i2p / mask / tryon。
 * 输入：image 口（tryon 为 garment / models 口）；输出：i2p 是 text（反推文本），
 * 其余是 image-out。2026-11-12 起（原型「表单上卡」）参数表单直接在卡片里（ToolParamFields / TryonSlots，写回原有 data 字段），
 * 不再有浮动控制台；执行钮在卡片底部（执行中变「取消」）。另有两处节点内编辑（2026-11-07 审计 33）：
 * - 反推（i2p）结果可直接改、「复制」、「插入画布」（右侧新建一个带这段文本的文字节点）；
 * - 裁剪（crop）在输入图上拖拽框选：空白处拖出新框、框内拖动平移、四角把手缩放，
 *   松手写回 data.crop（与控制台 X / Y / 宽 / 高 同一对象，两边自动同步）。
 */
import { computed, onBeforeUnmount, onMounted, onUpdated, reactive, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import RunErrorNotice from '../RunErrorNotice.vue'
import { normalizeHandle, toolLabel, toolSourceImage } from '../graph.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass, portLabelClass } from '../ports.ts'
import {
  CANVAS_OK,
  FOCUS_RING,
  NODE_CARD,
  NODE_CARD_SELECTED,
  NODE_HEAD_PLAIN,
  NODE_NOTICE,
  NODE_TITLE,
  type IQuickAddRequest,
} from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'
import { ColorFixPill } from '@/components/ColorFix'
import { openColorFix } from '../color-fix-action.ts'
import LibraryStatusHint from '../LibraryStatusHint.vue'
import ToolParamFields from '../ToolParamFields.vue'
import TryonSlots from './TryonSlots.vue'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; quickAdd: [request: IQuickAddRequest] }>()

const store = useCanvasEditor()

/** 反推结果下的文字按钮：28 高、12px */
const TEXT_BTN = `inline-flex shrink-0 items-center gap-4px h-28px px-10px border border-solid border-control rounded-4px bg-white text-ink-2 text-12px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink nodrag ${FOCUS_RING}`

const isRunning = computed(() => props.data.status === 'running' || props.data.status === 'queued')
const isI2p = computed(() => props.data.tool === 'i2p')
const isTryon = computed(() => props.data.tool === 'tryon')
/** catalog 里 ready=false 的工具：灰显并禁止执行（目录未加载时不拦） */
const notReady = computed(() => store.catalog.value?.tools?.find((t) => t.tool === props.data.tool)?.ready === false)
/** 原型 useNodeResize 默认 340 宽；试穿卡原型固定 380 宽 */
const width = computed(() => props.data.width ?? (isTryon.value ? 380 : 340))

/** 头部圆点按工具区分（只用主题令牌色，深浅色自动跟随） */
const DOT_CLASS: Record<string, string> = {
  crop: 'bg-violet',
  upscale: 'bg-success',
  outpaint: 'bg-warning',
  i2p: 'bg-muted',
  mask: 'bg-danger',
  tryon: 'bg-violet-solid',
}
const RUN_LABEL: Record<string, string> = {
  crop: '完成裁剪',
  upscale: '开始放大',
  outpaint: '开始扩图',
  i2p: '反推提示词',
  mask: '开始重绘',
}

const resultImage = computed(() => props.data.resultImage ?? props.data.image)

/** 产物还在转存素材库：校色只认地址，先不给用 */
const colorFixBlocked = computed(() => store.mediaBlockReason(props.id))
function onColorFix(e: MouseEvent) {
  e.stopPropagation()
  if (colorFixBlocked.value) {
    editorMessage.info(colorFixBlocked.value)
    return
  }
  openColorFix(props.id, resultImage.value)
}
const resultText = computed(() => props.data.resultText ?? '')

/** 试穿：连到模特口的线数（上限 9，validateConnection 同口径） */
const modelCount = computed(
  () =>
    store.edges.value.filter((edge) => edge.target === props.id && normalizeHandle(edge.targetHandle) === 'models')
      .length,
)

const runLabel = computed(() => (isTryon.value ? `开始生成（${modelCount.value} 张）` : (RUN_LABEL[props.data.tool ?? ''] ?? '执行')))

// ---- 反推结果：可编辑 / 复制 / 插入画布 ----
/** 节点内修改直接写回 resultText（下游引用即时生效）；它是运行态成品，刷新后以服务端结果为准 */
const editableText = computed({
  get: () => props.data.resultText ?? '',
  set: (value: string) => store.updateNodeData(props.id, { resultText: value }),
})
async function copyText() {
  const text = editableText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    editorMessage.success('已复制')
  } catch {
    editorMessage.warning('复制失败，请手动选中文本复制')
  }
}
function insertText() {
  const created = store.addTextNodeNear(props.id, editableText.value)
  if (created) editorMessage.success('已插入文字节点，可连到生成节点的提示词口')
}

// ---- 裁剪：节点内拖拽框选 ----
const isCrop = computed(() => props.data.tool === 'crop')
const cropSource = computed(() => (isCrop.value ? toolSourceImage(store.nodes.value, store.edges.value, props.id) : ''))
/** 上游产物的现签地址过期：让上游节点换一次签名（与 toolSourceImage 同口径找上游） */
function onCropSourceError() {
  const edge = store.edges.value.find((item) => item.target === props.id && (item.targetHandle ?? 'image') === 'image')
  const sourceId = edge?.source ?? props.data.sourceNodeId
  if (sourceId) store.refreshNodeMedia(sourceId)
}
const cropBox = ref<HTMLElement | null>(null)
type CropHandle = 'nw' | 'ne' | 'sw' | 'se'
const CROP_MIN = 0.05
/** 拖动中的草稿（比例坐标）；松手才写回 data.crop，撤销栈只记一步 */
const draft = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const drag = reactive({
  mode: '' as '' | 'draw' | 'move' | 'resize',
  handle: '' as CropHandle | '',
  startX: 0,
  startY: 0,
  origin: { x: 0, y: 0, w: 0, h: 0 },
})
const cropShown = computed(() => draft.value ?? props.data.crop ?? { x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
const cropHandles: { key: CropHandle; label: string; cls: string }[] = [
  { key: 'nw', label: '左上角', cls: 'left-0 top-0 cursor-nwse-resize' },
  { key: 'ne', label: '右上角', cls: 'left-full top-0 cursor-nesw-resize' },
  { key: 'sw', label: '左下角', cls: 'left-0 top-full cursor-nesw-resize' },
  { key: 'se', label: '右下角', cls: 'left-full top-full cursor-nwse-resize' },
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
function cropPoint(event: PointerEvent) {
  const rect = cropBox.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
  return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) }
}
function onCropDown(event: PointerEvent) {
  if (event.button !== 0 || isRunning.value) return
  store.selectNode(props.id)
  const el = event.target as HTMLElement
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  const p = cropPoint(event)
  const current = { ...cropShown.value }
  drag.startX = p.x
  drag.startY = p.y
  drag.origin = { x: current.x, y: current.y, w: current.w, h: current.h }
  const handle = el.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as CropHandle | undefined
  if (handle) {
    drag.mode = 'resize'
    drag.handle = handle
  } else if (el.closest('[data-crop-rect]')) {
    drag.mode = 'move'
  } else {
    drag.mode = 'draw'
    draft.value = { x: p.x, y: p.y, w: 0, h: 0 }
  }
}
function onCropMove(event: PointerEvent) {
  if (!drag.mode) return
  const p = cropPoint(event)
  const o = drag.origin
  if (drag.mode === 'draw') {
    draft.value = {
      x: Math.min(drag.startX, p.x),
      y: Math.min(drag.startY, p.y),
      w: Math.abs(p.x - drag.startX),
      h: Math.abs(p.y - drag.startY),
    }
  } else if (drag.mode === 'move') {
    draft.value = {
      x: Math.min(1 - o.w, Math.max(0, o.x + p.x - drag.startX)),
      y: Math.min(1 - o.h, Math.max(0, o.y + p.y - drag.startY)),
      w: o.w,
      h: o.h,
    }
  } else {
    let left = o.x
    let top = o.y
    let right = o.x + o.w
    let bottom = o.y + o.h
    if (drag.handle.includes('w')) left = Math.min(p.x, right - CROP_MIN)
    if (drag.handle.includes('e')) right = Math.max(p.x, left + CROP_MIN)
    if (drag.handle.includes('n')) top = Math.min(p.y, bottom - CROP_MIN)
    if (drag.handle.includes('s')) bottom = Math.max(p.y, top + CROP_MIN)
    draft.value = {
      x: clamp01(left),
      y: clamp01(top),
      w: clamp01(right) - clamp01(left),
      h: clamp01(bottom) - clamp01(top),
    }
  }
}
function onCropUp() {
  const box = draft.value
  drag.mode = ''
  drag.handle = ''
  draft.value = null
  // 太小的框（单击）不算，保留原框
  if (!box || box.w < CROP_MIN || box.h < CROP_MIN) return
  const round = (v: number) => Math.round(v * 1000) / 1000
  store.updateNodeData(props.id, {
    crop: {
      shape: props.data.crop?.shape ?? 'rect',
      x: round(box.x),
      y: round(box.y),
      w: round(box.w),
      h: round(box.h),
    },
  })
}

// ---- 卡片高度：内容最小高度（给 NodeResize 夹紧用，规则同 EditorModelNode） ----
// 表单在卡上，内容高度由表单决定：拖过高度（heightFixed）后外框 min-height = max(data.height, 内容最小高度)，
// 结果区 / 占位区 flex 撑满剩余空间；未拖过则自动按内容撑高。
const MEDIA_MIN = 80
const headRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
const mediaRef = ref<HTMLElement | null>(null)
const contentMin = ref(0)
let contentObserver: ResizeObserver | null = null
function measureContentMin() {
  const head = headRef.value
  const body = bodyRef.value
  if (!head || !body) return
  const cs = getComputedStyle(body)
  const gap = parseFloat(cs.rowGap) || 0
  const kids = Array.from(body.children) as HTMLElement[]
  let others = 0
  for (const child of kids) {
    if (child === mediaRef.value) continue
    others += child.offsetHeight
  }
  const gaps = Math.max(0, kids.length - 1) * gap
  contentMin.value = Math.ceil(
    head.offsetHeight +
      (parseFloat(cs.paddingTop) || 0) +
      (parseFloat(cs.paddingBottom) || 0) +
      others +
      gaps +
      (mediaRef.value ? MEDIA_MIN : 0) +
      2,
  )
}
function observeContent() {
  contentObserver?.disconnect()
  measureContentMin()
  if (typeof ResizeObserver === 'undefined' || !bodyRef.value) return
  contentObserver = new ResizeObserver(measureContentMin)
  for (const child of Array.from(bodyRef.value.children)) {
    if (child !== mediaRef.value) contentObserver.observe(child)
  }
}
onMounted(observeContent)
onUpdated(observeContent)
onBeforeUnmount(() => contentObserver?.disconnect())
const fixedHeight = computed(() => Boolean(props.data.heightFixed && props.data.height))
</script>

<template>
  <div
    :class="[
      NODE_CARD,
      'flex flex-col',
      { 'is-selected': selected, 'opacity-55': notReady, [NODE_CARD_SELECTED]: selected },
    ]"
    :style="{ width: `${width}px`, minHeight: fixedHeight ? `${Math.max(data.height ?? 0, contentMin)}px` : undefined }"
  >
    <header ref="headRef" :class="NODE_HEAD_PLAIN">
      <span class="shrink-0 w-9px h-9px rounded-full" :class="DOT_CLASS[data.tool ?? ''] ?? 'bg-violet'" />
      <span class="flex-1" :class="NODE_TITLE">{{ data.title || toolLabel(data.tool) }}</span>
      <div class="flex shrink-0 items-center gap-2px">
        <NodeMenu
          :title="data.title || toolLabel(data.tool)"
          :image-actions-for="isI2p ? undefined : id"
          @remove="emit('remove')"
        />
      </div>
    </header>

    <!-- 原型 .wf-tool-node__body：内边距 0 12 12、gap 8；表单在卡上 -->
    <div ref="bodyRef" class="flex flex-1 min-h-0 flex-col gap-8px px-12px pb-12px">
      <TryonSlots v-if="isTryon" :node-id="id" :disabled="isRunning" />
      <ToolParamFields :node-id="id" :data="data">
        <template #preview>
          <!-- 裁剪：在输入图上拖拽框选（比例坐标写回 data.crop） -->
          <div v-if="isCrop && cropSource" class="flex flex-col gap-4px">
            <span class="text-muted text-11px">在图上拖拽框选裁剪区域，拖四角调整</span>
            <div class="flex justify-center px-6px py-6px rounded-6px bg-[#f4f6fa] [[data-theme=dark]_&]:bg-surface2">
              <div
                ref="cropBox"
                class="relative inline-block max-w-full select-none touch-none cursor-crosshair nodrag nowheel"
                @pointerdown.stop="onCropDown"
                @pointermove="onCropMove"
                @pointerup="onCropUp"
                @pointercancel="onCropUp"
              >
                <img
                  :src="cropSource"
                  alt="裁剪输入图"
                  draggable="false"
                  class="block max-w-full max-h-220px pointer-events-none"
                  @error="onCropSourceError"
                />
                <!-- 框外压暗：单独一层裁在图片范围内（交互层不裁，四角把手的命中区才不会被切掉） -->
                <div class="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                  <div
                    class="absolute shadow-[0_0_0_9999px_rgba(31,35,41,0.38)]"
                    :class="data.crop?.shape === 'circle' ? 'rounded-full' : ''"
                    :style="{
                      left: `${cropShown.x * 100}%`,
                      top: `${cropShown.y * 100}%`,
                      width: `${cropShown.w * 100}%`,
                      height: `${cropShown.h * 100}%`,
                    }"
                  />
                </div>
                <div
                  data-crop-rect
                  class="absolute border-2 border-solid border-violet bg-violet/12 cursor-move"
                  :class="data.crop?.shape === 'circle' ? 'rounded-full' : ''"
                  :style="{
                    left: `${cropShown.x * 100}%`,
                    top: `${cropShown.y * 100}%`,
                    width: `${cropShown.w * 100}%`,
                    height: `${cropShown.h * 100}%`,
                  }"
                >
                  <span
                    v-for="corner in cropHandles"
                    :key="corner.key"
                    :data-crop-handle="corner.key"
                    class="absolute w-10px h-10px border-2 border-solid border-#fff rounded-2px bg-violet -translate-x-50% -translate-y-50% after:content-empty after:absolute after:-inset-11px"
                    :class="corner.cls"
                    :aria-label="`拖动${corner.label}调整裁剪框`"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </ToolParamFields>

      <!-- 反推结果：可编辑文本 + 复制 / 插入画布 -->
      <template v-if="isI2p && (resultText || data.status === 'done')">
        <textarea
          v-model="editableText"
          class="block w-full min-h-96px max-h-200px px-9px py-7px border border-solid border-line rounded-6px bg-surface2 text-ink-2 text-12px leading-[1.55] resize-y outline-none focus:border-violet nodrag nowheel"
          :maxlength="3000"
          aria-label="反推结果（可编辑）"
        />
        <div class="flex items-center gap-8px" data-node-params>
          <span class="flex-1 min-w-0 text-muted text-11px">改动仅本次有效；插入画布可长期保存</span>
          <button type="button" :class="TEXT_BTN" @click.stop="copyText">
            <EditorIcon name="copy" :size="13" />复制
          </button>
          <button type="button" :class="TEXT_BTN" @click.stop="insertText">
            <EditorIcon name="plus" :size="13" />插入画布
          </button>
        </div>
      </template>
      <template v-else>
        <div
          v-if="resultImage"
          ref="mediaRef"
          class="canvas-media relative grid w-full place-items-center overflow-hidden min-h-110px border border-solid border-line rounded-6px bg-[#f4f6fa] [[data-theme=dark]_&]:bg-surface2"
          :class="fixedHeight ? 'flex-1' : ''"
        >
          <img
            :src="resultImage"
            :alt="data.title"
            draggable="false"
            class="block w-full object-contain"
            :class="fixedHeight ? 'h-full' : 'max-h-240px'"
            @error="store.refreshNodeMedia(id)"
          />
          <ColorFixPill
            v-if="data.tool !== 'i2p'"
            label="校色"
            :aria-label="`校色：${data.title || '工具结果'}`"
            :aria-disabled="colorFixBlocked ? 'true' : undefined"
            :title="colorFixBlocked || undefined"
            class="absolute top-8px right-8px z-3 nodrag opacity-0 [.canvas-media:hover_&]:opacity-100 [.is-selected_&]:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            :class="colorFixBlocked ? '!cursor-not-allowed !text-muted' : ''"
            @click="onColorFix"
          />
        </div>
        <div
          v-else-if="!(isCrop && cropSource) && !isTryon"
          ref="mediaRef"
          class="flex flex-col items-center gap-6px justify-center min-h-60px border border-dashed border-line-strong rounded-6px text-placeholder text-12px"
          :class="fixedHeight ? 'flex-1' : ''"
        >
          <EditorIcon name="tool" :size="20" />
          <span>{{ isRunning ? '处理中…' : '连一条图片输入后执行' }}</span>
        </div>
        <LibraryStatusHint
          v-if="resultImage && !isRunning"
          :status="data.libraryStatus"
          :retry="() => store.retryLibrary(id)"
        />
      </template>

      <div v-if="isRunning" class="h-3px overflow-hidden rounded-999px bg-violet-soft-2">
        <i
          class="block h-full rounded-999px bg-gradient-to-b from-violet-top to-violet-bottom transition-[width] duration-400"
          :style="{ width: `${data.progress ?? 0}%` }"
        />
      </div>
      <div
        v-if="isRunning"
        :class="NODE_NOTICE"
        class="!mt-0 border border-solid border-line-soft bg-surface2 text-muted"
      >
        {{ data.status === 'queued' ? '排队中…' : `处理中 ${data.progress ?? 0}%` }}
      </div>
      <RunErrorNotice v-else-if="data.status === 'error'" class="!mt-0" :node-id="id" :data="data" />
      <div v-else-if="data.status === 'done'" :class="[NODE_NOTICE, CANVAS_OK]" class="!mt-0 border border-solid">
        已完成
      </div>

      <!-- 执行钮（原型 .wf-tool-node__run）：整行；执行中变「取消」；未开放的工具禁用并说明 -->
      <button
        type="button"
        data-node-params
        class="shrink-0 flex w-full h-32px items-center justify-center gap-6px border border-solid rounded-6px text-13px font-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed nodrag"
        :class="[
          FOCUS_RING,
          isRunning
            ? 'border-control bg-white text-ink-2 hover:border-control-hover hover:text-ink'
            : 'border-transparent bg-violet-solid text-white hover:opacity-90',
        ]"
        :disabled="notReady && !isRunning"
        :title="notReady && !isRunning ? '该功能暂未开放' : undefined"
        :aria-label="isRunning ? `取消执行 ${data.title}` : `${runLabel}：${data.title}`"
        @pointerdown.stop="store.selectNode(id)"
        @click.stop="isRunning ? store.cancelRun(id) : store.runNode(id)"
      >
        <EditorIcon :name="isRunning ? 'stop' : 'play'" :size="13" />
        {{ isRunning ? '取消' : runLabel }}
      </button>
    </div>

    <template v-if="isTryon">
      <!-- 原型 CanvasTryonNode：服装口 30%、模特口 66% -->
      <span :class="portLabelClass('garment')" :style="{ top: '30%' }">服装</span>
      <Handle
        id="garment"
        type="target"
        :position="Position.Left"
        :class="portClass('garment')"
        :style="{ top: '30%' }"
        aria-label="服装输入"
      />
      <span :class="portLabelClass('models')" :style="{ top: '66%' }">模特 · {{ modelCount }}/9</span>
      <Handle
        id="models"
        type="target"
        :position="Position.Left"
        :class="portClass('models')"
        :style="{ top: '66%' }"
        aria-label="模特输入"
      />
    </template>
    <template v-else>
      <span :class="portLabelClass('image')" :style="{ top: '50%' }">图片</span>
      <Handle id="image" type="target" :position="Position.Left" :class="portClass('image')" :style="{ top: '50%' }" />
    </template>

    <Handle
      :id="isI2p ? 'text' : 'image-out'"
      type="source"
      :position="Position.Right"
      :class="portClass(isI2p ? 'text' : 'out')"
    />
    <NodeQuickAdd
      :kinds="isI2p ? ['image-model', 'video-model'] : ['image-model', 'video-model', 'tool']"
      @open="emit('quickAdd', $event)"
    />
    <NodeResize :id="id" kind="tool" :min-content-height="contentMin" :title="data.title || toolLabel(data.tool)" />
  </div>
</template>
