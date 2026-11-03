<script setup lang="ts">
/**
 * 节点右下角缩放把手（原型 useNodeResize）：无级等比缩放，写回快照既有的 data.width / data.height。
 * 指针位移投影到节点对角线上求缩放比；最小尺寸按节点种类（图片 180×150 / 文字 240×160 / 其余 280×240），
 * 上限 720×760。缩放过程中连续写入，撤销栈按既有的 400ms 静默合并成一步。
 */
import { onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useCanvasEditor } from './useCanvasEditor.ts'
import { NODE_RESIZE_GRIP } from './ui.ts'

type ResizableKind = 'text' | 'image' | 'model' | 'video' | 'tool'

const props = defineProps<{ id: string; kind: ResizableKind; title?: string }>()

const store = useCanvasEditor()
const { viewport } = useVueFlow()

const DEFAULT_WIDTH: Record<ResizableKind, number> = { text: 320, image: 240, model: 318, video: 338, tool: 340 }
const MIN_WIDTH: Record<ResizableKind, number> = { text: 240, image: 180, model: 280, video: 280, tool: 280 }
const MIN_HEIGHT: Record<ResizableKind, number> = { text: 160, image: 150, model: 240, video: 240, tool: 240 }
const MAX_WIDTH = 720
const MAX_HEIGHT = 760

let start: { x: number; y: number; w: number; h: number } | null = null

function onPointerDown(event: PointerEvent) {
  const node = store.findNode(props.id)
  if (!node) return
  event.preventDefault()
  event.stopPropagation()
  // 起始高度取实际渲染高度（媒体按原图比例撑开时 data.height 并不代表当前外观）
  const card = (event.currentTarget as HTMLElement).parentElement
  const w = node.data.width ?? DEFAULT_WIDTH[props.kind]
  const h = card?.offsetHeight || node.data.height || MIN_HEIGHT[props.kind]
  start = { x: event.clientX, y: event.clientY, w, h }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(event: PointerEvent) {
  if (!start) return
  const zoom = viewport.value.zoom || 1
  const dx = (event.clientX - start.x) / zoom
  const dy = (event.clientY - start.y) / zoom
  const raw = 1 + (dx * start.w + dy * start.h) / (start.w * start.w + start.h * start.h)
  const min = Math.max(MIN_WIDTH[props.kind] / start.w, MIN_HEIGHT[props.kind] / start.h)
  const max = Math.min(MAX_WIDTH / start.w, MAX_HEIGHT / start.h)
  const scale = Math.min(max, Math.max(min, raw))
  store.updateNodeData(props.id, { width: Math.round(start.w * scale), height: Math.round(start.h * scale) })
}

function onPointerUp() {
  start = null
  window.removeEventListener('pointermove', onPointerMove)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <span
    :class="NODE_RESIZE_GRIP"
    :title="`拖动调整${title ? `「${title}」` : '节点'}大小`"
    aria-hidden="true"
    @pointerdown="onPointerDown"
  />
</template>
