<script setup lang="ts">
/**
 * 智能消除的涂抹蒙版。
 *
 * <p>画布按原图像素尺寸建（CSS 缩放显示），笔迹以点列保存；导出时在同尺寸画布上
 * 黑底白笔重放，得到 PNG 蒙版（白 = 要擦除）。不读原图像素，跨域图片也不会污染画布。
 * 蒙版格式待联调确认，见 schemas.ts 的 note。
 */
import { computed, ref, watch } from 'vue'

const props = defineProps<{ src: string }>()
const emit = defineEmits<{ change: [hasStroke: boolean] }>()

interface Stroke {
  size: number
  points: { x: number; y: number }[]
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const natural = ref({ w: 0, h: 0 })
const brush = ref(40)
const strokes = ref<Stroke[]>([])
let drawing: Stroke | null = null

const hasStroke = computed(() => strokes.value.length > 0)

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  strokes.value = []
  requestAnimationFrame(redraw)
}

watch(
  () => props.src,
  () => {
    strokes.value = []
    natural.value = { w: 0, h: 0 }
  },
)

watch(hasStroke, (v) => emit('change', v))

/** 屏幕坐标 → 原图像素坐标；笔刷大小按显示尺寸给，换算成原图像素 */
function toImage(e: PointerEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const scale = natural.value.w / rect.width
  return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale }
}

function onPointerDown(e: PointerEvent) {
  if (!natural.value.w) return
  canvasRef.value?.setPointerCapture(e.pointerId)
  const p = toImage(e)
  drawing = { size: brush.value * p.scale, points: [{ x: p.x, y: p.y }] }
  strokes.value = [...strokes.value, drawing]
  redraw()
}

function onPointerMove(e: PointerEvent) {
  if (!drawing) return
  const p = toImage(e)
  drawing.points.push({ x: p.x, y: p.y })
  redraw()
}

function onPointerUp() {
  drawing = null
}

function paint(ctx: CanvasRenderingContext2D, color: string) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes.value) {
    ctx.lineWidth = s.size
    const [first, ...rest] = s.points
    if (!first) continue
    ctx.beginPath()
    ctx.arc(first.x, first.y, s.size / 2, 0, Math.PI * 2)
    ctx.fill()
    if (rest.length) {
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (const p of rest) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }
}

function redraw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  paint(ctx, 'rgba(135, 95, 154, 0.55)')
}

function undo() {
  strokes.value = strokes.value.slice(0, -1)
  redraw()
}

function clear() {
  strokes.value = []
  redraw()
}

/** 导出黑底白笔 PNG 蒙版（与原图同像素尺寸）；没有笔迹返回 null */
async function exportMask(): Promise<File | null> {
  if (!hasStroke.value || !natural.value.w) return null
  const out = document.createElement('canvas')
  out.width = natural.value.w
  out.height = natural.value.h
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.width, out.height)
  paint(ctx, '#fff')
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' }) : null
}

defineExpose({ exportMask, clear })
</script>

<template>
  <div class="flex flex-col gap-8px">
    <div class="relative w-full overflow-hidden rounded-8px border border-solid border-line bg-surface3">
      <img
        :src="src"
        alt="待涂抹的原图"
        class="block w-full h-auto select-none"
        draggable="false"
        @load="onImageLoad"
      />
      <canvas
        v-if="natural.w"
        ref="canvasRef"
        :width="natural.w"
        :height="natural.h"
        class="absolute inset-0 w-full h-full cursor-crosshair touch-none"
        role="img"
        aria-label="涂抹画布：按住拖动涂抹要消除的区域"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      />
    </div>
    <div class="flex items-center gap-10px text-12px text-ink-2">
      <label for="mask-brush" class="flex-none">画笔大小</label>
      <input
        id="mask-brush"
        v-model.number="brush"
        type="range"
        min="8"
        max="120"
        step="2"
        class="flex-1 accent-violet"
      />
      <button
        type="button"
        class="ll-pill focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        :disabled="!hasStroke"
        @click="undo"
      >
        撤销
      </button>
      <button
        type="button"
        class="ll-pill focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        :disabled="!hasStroke"
        @click="clear"
      >
        清空
      </button>
    </div>
  </div>
</template>
