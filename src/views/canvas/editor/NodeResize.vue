<script setup lang="ts">
/**
 * 节点缩放（右边 = 宽、下边 = 高、右下角 = 宽高同时）。
 * - 三个热区：右边缘 8px（ew）、下边缘 8px（ns）、右下角 14px（nwse，悬停 / 选中显示 L 形抓手）。
 * - 指针位移 / 画布缩放得到画布坐标增量；pointer capture 绑在热区上，快速拖出也不丢事件；
 *   热区带 nodrag / nopan，不触发节点拖动与画布平移；端口 z-index 高于热区，不抢连线。
 * - 角落手势：默认自由（Figma / Miro 惯例），按住 Shift 锁定起始宽高比；
 *   媒体节点（keepRatio = 已有图 / 视频）相反——默认保持媒体比例（只改宽，高度仍随原图自动撑开），按住 Shift 自由。
 * - 写回既有 data.width / data.height；拖过高度（边或自由角）才置 heightFixed，旧快照缺该字段 = 自动高度。
 * - 撤销栈沿用 updateNodeData 的 400ms 静默合并，一次拖拽 = 一步。
 */
import { onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useCanvasEditor } from './useCanvasEditor.ts'
import { NODE_RESIZE_EDGE_X, NODE_RESIZE_EDGE_Y, NODE_RESIZE_GRIP } from './ui.ts'

type ResizableKind = 'text' | 'image' | 'model' | 'video' | 'tool' | 'module'
type Axis = 'x' | 'y' | 'xy'

const props = defineProps<{ id: string; kind: ResizableKind; title?: string; keepRatio?: boolean }>()

const store = useCanvasEditor()
const { viewport } = useVueFlow()

const DEFAULT_WIDTH: Record<ResizableKind, number> = { text: 320, image: 240, model: 318, video: 338, tool: 340, module: 760 }
const MIN_WIDTH: Record<ResizableKind, number> = { text: 240, image: 180, model: 280, video: 280, tool: 280, module: 240 }
const MIN_HEIGHT: Record<ResizableKind, number> = { text: 160, image: 150, model: 240, video: 240, tool: 240, module: 160 }
const MAX_WIDTH: Record<ResizableKind, number> = { text: 960, image: 960, model: 960, video: 960, tool: 960, module: 4000 }
const MAX_HEIGHT: Record<ResizableKind, number> = { text: 1000, image: 1000, model: 1000, video: 1000, tool: 1000, module: 3000 }

let start: { x: number; y: number; w: number; h: number; axis: Axis } | null = null
let active: HTMLElement | null = null

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function onPointerDown(event: PointerEvent, axis: Axis) {
  if (event.button !== 0) return
  const node = store.findNode(props.id)
  if (!node) return
  event.preventDefault()
  event.stopPropagation()
  const el = event.currentTarget as HTMLElement
  // 起始尺寸取实际渲染尺寸（媒体按原图比例撑开时 data.height 并不代表当前外观）
  const card = el.parentElement
  const w = card?.offsetWidth || node.data.width || DEFAULT_WIDTH[props.kind]
  const h = card?.offsetHeight || node.data.height || MIN_HEIGHT[props.kind]
  start = { x: event.clientX, y: event.clientY, w, h, axis }
  active = el
  el.setPointerCapture(event.pointerId)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerEnd)
  el.addEventListener('pointercancel', onPointerEnd)
}

function onPointerMove(event: PointerEvent) {
  if (!start) return
  const zoom = viewport.value.zoom || 1
  const dx = (event.clientX - start.x) / zoom
  const dy = (event.clientY - start.y) / zoom
  const kind = props.kind
  let w = start.w + dx
  let h = start.h + dy
  let fixHeight = start.axis !== 'x'

  if (start.axis === 'xy') {
    // 媒体节点默认锁媒体比例，其余默认自由；Shift 取反
    const lock = props.keepRatio ? !event.shiftKey : event.shiftKey
    if (lock && props.keepRatio) {
      // 保持媒体比例：只改宽，高度由原图比例自动撑开
      fixHeight = false
    } else if (lock) {
      const scale = Math.max(w / start.w, h / start.h)
      w = start.w * scale
      h = start.h * scale
    }
  }
  if (start.axis === 'y') w = start.w
  if (start.axis === 'x') h = start.h

  // 锁比例时夹紧到两轴范围内，保证两边同比
  if (start.axis === 'xy' && fixHeight && (event.shiftKey && !props.keepRatio)) {
    const lo = Math.max(MIN_WIDTH[kind] / start.w, MIN_HEIGHT[kind] / start.h)
    const hi = Math.min(MAX_WIDTH[kind] / start.w, MAX_HEIGHT[kind] / start.h)
    const scale = clamp(w / start.w, lo, Math.max(lo, hi))
    w = start.w * scale
    h = start.h * scale
  }
  const patch: Record<string, unknown> = { width: Math.round(clamp(w, MIN_WIDTH[kind], MAX_WIDTH[kind])) }
  if (fixHeight) {
    patch.height = Math.round(clamp(h, MIN_HEIGHT[kind], MAX_HEIGHT[kind]))
    patch.heightFixed = true
  } else if (start.axis === 'xy') {
    // 锁比例回到自动高度
    patch.heightFixed = false
  }
  store.updateNodeData(props.id, patch)
}

function onPointerEnd(event: PointerEvent) {
  const el = active
  if (el) {
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerEnd)
    el.removeEventListener('pointercancel', onPointerEnd)
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  }
  start = null
  active = null
}

onBeforeUnmount(() => {
  if (!active) return
  active.removeEventListener('pointermove', onPointerMove)
  active.removeEventListener('pointerup', onPointerEnd)
  active.removeEventListener('pointercancel', onPointerEnd)
})
</script>

<template>
  <span :class="NODE_RESIZE_EDGE_X" aria-hidden="true" title="拖动调整宽度" @pointerdown="onPointerDown($event, 'x')" />
  <span :class="NODE_RESIZE_EDGE_Y" aria-hidden="true" title="拖动调整高度" @pointerdown="onPointerDown($event, 'y')" />
  <span
    :class="NODE_RESIZE_GRIP"
    :title="`拖动调整${title ? `「${title}」` : '节点'}大小（${keepRatio ? '默认保持比例，Shift 自由' : 'Shift 锁定比例'}）`"
    aria-hidden="true"
    @pointerdown="onPointerDown($event, 'xy')"
  />
</template>
