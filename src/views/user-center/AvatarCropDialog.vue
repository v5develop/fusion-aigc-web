<script setup lang="ts">
/**
 * 头像裁剪框：正方形取景，拖动平移、滚轮 / 滑块缩放（方向键平移、+/- 缩放），圆形预览。
 * 保存时导出 512×512 PNG 交给父组件上传；上传失败由父组件通过 error 回显，框保持打开。
 * 纯 canvas 实现，不引入裁剪库。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ file: File | null; busy: boolean; error: string }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ save: [blob: Blob]; cancel: [] }>()

const VIEW = 360 // 取景画布内部分辨率（CSS 里等比缩放）
const OUT = 512 // 导出边长
const MAX_ZOOM = 5

const canvasRef = ref<HTMLCanvasElement>()
const previewRef = ref<HTMLCanvasElement>()
const bitmap = ref<ImageBitmap | HTMLImageElement | null>(null)
const loadError = ref('')
const zoom = ref(1) // 相对「刚好铺满」的倍数
const cx = ref(0) // 取景框中心对应的图片坐标
const cy = ref(0)

let bitmapObj: ImageBitmap | HTMLImageElement | null = null
let objectUrl = ''

function sizeOf(b: ImageBitmap | HTMLImageElement) {
  return b instanceof HTMLImageElement ? { w: b.naturalWidth, h: b.naturalHeight } : { w: b.width, h: b.height }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // 选项不被支持或解码失败：退回 <img>（现代浏览器默认也按 EXIF 方向渲染）
    }
  }
  objectUrl = URL.createObjectURL(file)
  const img = new Image()
  img.src = objectUrl
  await img.decode()
  return img
}

function release() {
  if (bitmapObj && 'close' in bitmapObj) bitmapObj.close()
  bitmapObj = null
  bitmap.value = null
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

watch(
  () => [show.value, props.file] as const,
  async ([visible, file]) => {
    release()
    loadError.value = ''
    if (!visible || !file) return
    try {
      const b = await decode(file)
      if (!show.value || props.file !== file) {
        if ('close' in b) b.close()
        return
      }
      bitmapObj = b
      bitmap.value = b
      const { w, h } = sizeOf(b)
      if (w < 64 || h < 64) {
        loadError.value = '图片尺寸过小，请选择至少 64×64 像素的图片'
        return
      }
      zoom.value = 1
      cx.value = w / 2
      cy.value = h / 2
      await nextTick()
      redraw()
    } catch {
      loadError.value = '图片无法读取，请换一张试试'
    }
  },
  { immediate: true },
)

onBeforeUnmount(release)

/** 把图片按当前缩放与中心画进 size×size 的画布 */
function paint(ctx: CanvasRenderingContext2D, size: number) {
  const b = bitmap.value
  if (!b) return
  const { w, h } = sizeOf(b)
  const s = (size / Math.min(w, h)) * zoom.value
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(b, size / 2 - cx.value * s, size / 2 - cy.value * s, w * s, h * s)
}

/** 让图片始终盖满取景框 */
function clampCenter() {
  const b = bitmap.value
  if (!b) return
  const { w, h } = sizeOf(b)
  const half = Math.min(w, h) / zoom.value / 2 // 取景框在图片坐标里的半边长
  cx.value = Math.min(Math.max(cx.value, half), w - half)
  cy.value = Math.min(Math.max(cy.value, half), h - half)
}

function redraw() {
  const c = canvasRef.value
  const ctx = c?.getContext('2d')
  if (c && ctx && bitmap.value) {
    ctx.clearRect(0, 0, VIEW, VIEW)
    paint(ctx, VIEW)
    // 圆外压暗：evenodd 挖出内切圆
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.rect(0, 0, VIEW, VIEW)
    ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 1, 0, Math.PI * 2)
    ctx.fill('evenodd')
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 1, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const p = previewRef.value
  const pctx = p?.getContext('2d')
  if (p && pctx && bitmap.value) {
    pctx.clearRect(0, 0, p.width, p.height)
    paint(pctx, p.width)
  }
}

watch([zoom, cx, cy], () => {
  clampCenter()
  redraw()
})

// ---- 交互 ----
let dragging: { x: number; y: number } | null = null

function imageUnitsPerPx(el: HTMLElement) {
  const b = bitmap.value
  if (!b) return 0
  const { w, h } = sizeOf(b)
  return Math.min(w, h) / zoom.value / el.getBoundingClientRect().width
}

function onPointerDown(e: PointerEvent) {
  if (!bitmap.value) return
  dragging = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  const k = imageUnitsPerPx(e.currentTarget as HTMLElement)
  cx.value -= (e.clientX - dragging.x) * k
  cy.value -= (e.clientY - dragging.y) * k
  dragging = { x: e.clientX, y: e.clientY }
}
function onPointerUp() {
  dragging = null
}
function onWheel(e: WheelEvent) {
  setZoom(zoom.value * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
}
function setZoom(v: number) {
  zoom.value = Math.min(MAX_ZOOM, Math.max(1, v))
}
function onKey(e: KeyboardEvent) {
  const step = 12 * imageUnitsPerPx(e.currentTarget as HTMLElement)
  const map: Record<string, () => void> = {
    ArrowLeft: () => (cx.value -= step),
    ArrowRight: () => (cx.value += step),
    ArrowUp: () => (cy.value -= step),
    ArrowDown: () => (cy.value += step),
    '+': () => setZoom(zoom.value * 1.1),
    '=': () => setZoom(zoom.value * 1.1),
    '-': () => setZoom(zoom.value / 1.1),
  }
  const fn = map[e.key]
  if (fn) {
    e.preventDefault()
    fn()
  }
}

const ready = computed(() => !!bitmap.value && !loadError.value)

function onSave() {
  if (!ready.value || props.busy) return
  const out = document.createElement('canvas')
  out.width = OUT
  out.height = OUT
  const ctx = out.getContext('2d')
  if (!ctx) return
  paint(ctx, OUT)
  out.toBlob((blob) => blob && emit('save', blob), 'image/png')
}

function onCancel() {
  if (props.busy) return
  emit('cancel')
}
</script>

<template>
  <n-modal
    :show="show"
    transform-origin="center"
    :mask-closable="false"
    :close-on-esc="!busy"
    @update:show="(v: boolean) => !v && onCancel()"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label="裁剪头像"
      class="w-[min(420px,calc(100vw-32px))] box-border p-20px rounded-dialog bg-surface text-ink border border-solid border-line shadow-pop flex flex-col gap-14px"
    >
      <h3 class="m-0 text-16px font-600">裁剪头像</h3>

      <div class="flex flex-col items-center gap-12px">
        <canvas
          ref="canvasRef"
          :width="VIEW"
          :height="VIEW"
          tabindex="0"
          role="img"
          aria-label="头像取景框：拖动调整位置，滚轮或滑块缩放，方向键微调"
          class="w-full max-w-360px aspect-square rounded-lg bg-surface3 touch-none select-none sx-focus"
          :class="ready ? 'cursor-grab active:cursor-grabbing' : ''"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
          @keydown="onKey"
        />

        <div class="w-full max-w-360px flex items-center gap-12px">
          <label for="uc-avatar-zoom" class="text-12px text-ink-2 shrink-0">缩放</label>
          <input
            id="uc-avatar-zoom"
            type="range"
            min="1"
            :max="MAX_ZOOM"
            step="0.01"
            :value="zoom"
            :disabled="!ready || busy"
            class="flex-1 min-w-0 accent-violet"
            @input="setZoom(Number(($event.target as HTMLInputElement).value))"
          />
          <canvas
            ref="previewRef"
            width="96"
            height="96"
            aria-hidden="true"
            class="w-48px h-48px shrink-0 rounded-full border border-solid border-line bg-surface3"
          />
        </div>
      </div>

      <p v-if="loadError || error" role="alert" class="m-0 text-12px text-danger">{{ loadError || error }}</p>
      <p v-else class="m-0 sx-hint">拖动图片调整位置，滚轮缩放；右侧为圆形预览。</p>

      <div class="flex justify-end gap-8px">
        <button type="button" class="sx-btn min-w-72px" :disabled="busy" @click="onCancel">取消</button>
        <button type="button" class="sx-btn-primary min-w-72px" :disabled="!ready || busy" @click="onSave">
          {{ busy ? '上传中…' : '保存' }}
        </button>
      </div>
    </div>
  </n-modal>
</template>
