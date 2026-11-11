<script setup lang="ts">
/**
 * 智能消除的涂抹蒙版（对齐原型 MaskCanvas）。
 *
 * <p>公开接口（向后兼容）：props { src }；emits change(hasStroke)；expose exportMask() / clear()，
 * 另新增 undo()。笔迹始终以「原图像素坐标」保存，缩放/平移只改显示，不影响导出：
 * 导出仍是与原图同尺寸的黑底白笔 PNG（白 = 要擦除），不读原图像素，跨域图也不会污染画布。
 *
 * <p>交互：笔刷 8–80（显示像素，换算成原图像素）；缩放 适应/150%/200%；「移动」工具与鼠标中键可平移；
 * 放大后右下角缩略图可点按/拖动定位；Ctrl/⌘+Z 撤销。显示颜色为半透明红（画布整体 opacity，
 * 笔迹间叠加不会变深），与说明文案「涂红处会被抹掉」一致。无任何过渡动画，天然适配减少动效。
 *
 * <p>多指：只认第一根按下的指针（activePointer），其余指针的按下 / 移动 / 抬起一律忽略，不会两指画出两道。
 *
 * <p>触屏（pointer: coarse）：工具切换是「涂抹 / 移动」两段，触屏进来默认「移动」——画布 touch-action 交还浏览器
 * （pan-x pan-y），适应档时手指在图上上下滑就是滚页面，放大后是原生滚动画面（滚到边自然接力到页面）；
 * 点「涂抹」后画布 touch-action: none，手指按下即落笔。选它而不是长按起笔：touch-action 在按下那一刻就定了，
 * 长按期间浏览器照样会接管纵向滑动，起笔时机不可靠。鼠标 / 触控笔仍默认「涂抹」，「移动」用自绘平移。
 *
 * <p>卸载时若还有笔迹，补发 change(false)：页面的「已涂抹」状态不能停留在一张已不存在的画布上。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  src: string
  /** 适应档的最大显示高度（默认 520；全屏调色里的大弹窗传更大的值） */
  maxViewportH?: number
  /** 提供「擦除」工具（擦掉涂多的部分；局部调色用，智能消除页不开） */
  erasable?: boolean
}>()
const emit = defineEmits<{ change: [hasStroke: boolean] }>()

interface Stroke {
  size: number
  points: { x: number; y: number }[]
  /** 擦除笔迹：destination-out 抹掉之前涂的 */
  erase?: boolean
}

// 原型 MaskCanvas 同值：rgb(239, 68, 68)、半透明 .5
const MASK_COLOR = 'rgb(239, 68, 68)'
const MASK_OPACITY = 0.5
const MAX_VIEWPORT_H = 520

const rootRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const minimapRef = ref<HTMLElement | null>(null)
const natural = ref({ w: 0, h: 0 })
const brush = ref(40)
const strokes = ref<Stroke[]>([])
const zoom = ref(1)
const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
const tool = ref<'brush' | 'erase' | 'move'>(coarse ? 'move' : 'brush')
/** 当前接管的指针；null = 没有。多指时只认第一根 */
let activePointer: number | null = null
const panning = ref(false)
const availW = ref(0)
const viewBox = ref({ left: 0, top: 0, width: 100, height: 100 })
let drawing: Stroke | null = null
let panStart = { x: 0, y: 0, left: 0, top: 0 }
let miniDragging = false
let observer: ResizeObserver | null = null

const zoomOptions = [
  { label: '适应', value: 1 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
]

const hasStroke = computed(() => strokes.value.length > 0)
const hasImage = computed(() => natural.value.w > 0 && natural.value.h > 0)

/** 适应档尺寸：整张图放进「容器宽 × 最大高」 */
const fit = computed(() => {
  const { w, h } = natural.value
  if (!w || !h || availW.value <= 0) return { w: 0, h: 0 }
  const s = Math.min(availW.value / w, (props.maxViewportH || MAX_VIEWPORT_H) / h)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
})
const stageStyle = computed(() => ({
  width: `${Math.round(fit.value.w * zoom.value)}px`,
  height: `${Math.round(fit.value.h * zoom.value)}px`,
}))
const viewportStyle = computed(() => ({ width: `${fit.value.w}px`, height: `${fit.value.h}px` }))
/**
 * 笔尖预览：固定 32×32 的框（border-box，1px 描边 → 内容 30×30），圆点按真实显示直径画、封顶 26（四周留 2px 不贴边）。
 * 笔刷步长 2、内容区 30 为偶数 → 圆点直径恒为偶数，(30 − d) / 2 是整数，任何 DPR 下都不会落半像素而偏一边。
 * 以前封顶 40 大于内容区：网格轨道被撑到 40 从左上起排，圆点整体往右下偏。
 */
const TIP_BOX_INNER = 30
const tipSize = computed(() => {
  const d = Math.min(Math.round(brush.value), TIP_BOX_INNER - 4)
  return Math.max(2, d - (d % 2))
})

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  strokes.value = []
  measure()
  requestAnimationFrame(() => {
    redraw()
    updateViewBox()
  })
}

watch(
  () => props.src,
  () => {
    strokes.value = []
    drawing = null
    activePointer = null
    panning.value = false
    zoom.value = 1
    natural.value = { w: 0, h: 0 }
  },
)

watch(hasStroke, (v) => emit('change', v))

watch(zoom, async () => {
  await nextTick()
  const vp = viewportRef.value
  if (vp) {
    // 放大后先看中间，避免停在左上角误以为图没了
    vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2)
    vp.scrollTop = Math.max(0, (vp.scrollHeight - vp.clientHeight) / 2)
  }
  updateViewBox()
})

watch(fit, async () => {
  await nextTick()
  updateViewBox()
})

function measure() {
  const el = rootRef.value
  if (el) availW.value = Math.max(0, el.getBoundingClientRect().width - 2)
}

function updateViewBox() {
  const vp = viewportRef.value
  if (!vp || !vp.scrollWidth || !vp.scrollHeight) return
  viewBox.value = {
    left: (vp.scrollLeft / vp.scrollWidth) * 100,
    top: (vp.scrollTop / vp.scrollHeight) * 100,
    width: (vp.clientWidth / vp.scrollWidth) * 100,
    height: (vp.clientHeight / vp.scrollHeight) * 100,
  }
}

/** 屏幕坐标 → 原图像素坐标（用画布当前显示矩形反算，所以与缩放/平移无关） */
function toImage(e: PointerEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const scale = rect.width ? natural.value.w / rect.width : 1
  return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale }
}

function capture(target: EventTarget | null, id: number) {
  try {
    ;(target as HTMLElement | null)?.setPointerCapture?.(id)
  } catch {
    /* 合成事件/已抬起的指针会抛错，忽略 */
  }
}

function onPointerDown(e: PointerEvent) {
  if (!hasImage.value) return
  if (activePointer !== null && activePointer !== e.pointerId) return
  // 触屏「移动」：交给浏览器原生滚动（canvas touch-action 已放开），这里什么都不做
  if (tool.value === 'move' && e.pointerType === 'touch') return
  if (tool.value === 'move' || e.button === 1) {
    const vp = viewportRef.value
    if (!vp) return
    e.preventDefault()
    panning.value = true
    activePointer = e.pointerId
    panStart = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop }
    capture(e.currentTarget, e.pointerId)
    return
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return
  activePointer = e.pointerId
  capture(e.currentTarget, e.pointerId)
  const p = toImage(e)
  drawing = { size: brush.value * p.scale, points: [{ x: p.x, y: p.y }], erase: tool.value === 'erase' || undefined }
  strokes.value = [...strokes.value, drawing]
  redraw()
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== activePointer) return
  if (panning.value) {
    const vp = viewportRef.value
    if (!vp) return
    vp.scrollLeft = panStart.left - (e.clientX - panStart.x)
    vp.scrollTop = panStart.top - (e.clientY - panStart.y)
    return
  }
  if (!drawing) return
  const p = toImage(e)
  const last = drawing.points[drawing.points.length - 1]
  drawing.points.push({ x: p.x, y: p.y })
  const ctx = canvasRef.value?.getContext('2d')
  if (ctx && last) {
    ctx.globalCompositeOperation = drawing.erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = MASK_COLOR
    ctx.lineWidth = drawing.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointer) return
  activePointer = null
  drawing = null
  panning.value = false
}

function onMinimap(e: PointerEvent) {
  const map = minimapRef.value
  const vp = viewportRef.value
  if (!map || !vp) return
  const rect = map.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  vp.scrollLeft = px * vp.scrollWidth - vp.clientWidth / 2
  vp.scrollTop = py * vp.scrollHeight - vp.clientHeight / 2
  updateViewBox()
}
function onMinimapDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  miniDragging = true
  capture(e.currentTarget, e.pointerId)
  onMinimap(e)
}
function onMinimapMove(e: PointerEvent) {
  if (miniDragging) onMinimap(e)
}
function onMinimapUp() {
  miniDragging = false
}

function paint(ctx: CanvasRenderingContext2D, color: string) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes.value) {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
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
  ctx.globalCompositeOperation = 'source-over'
}

function redraw() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  paint(ctx, MASK_COLOR)
}

function undo() {
  drawing = null
  strokes.value = strokes.value.slice(0, -1)
  redraw()
}

function clear() {
  drawing = null
  strokes.value = []
  redraw()
}

function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
  if (!hasStroke.value || !rootRef.value?.offsetParent) return
  const t = e.target as HTMLElement | null
  // 文本输入里的 Ctrl+Z 归输入框自己
  if (
    t &&
    (t.isContentEditable ||
      t.tagName === 'TEXTAREA' ||
      (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))
  )
    return
  e.preventDefault()
  undo()
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    observer = new ResizeObserver(measure)
    observer.observe(rootRef.value)
  }
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onKeydown)
  if (hasStroke.value) emit('change', false)
})

/** 导出黑底白笔 PNG 蒙版（与原图同像素尺寸）；没有笔迹返回 null */
async function exportMask(): Promise<File | null> {
  if (!hasStroke.value || !natural.value.w) return null
  // 只有擦除笔迹 = 什么都没涂，别导出一张全黑蒙版
  if (!strokes.value.some((s) => !s.erase)) return null
  const out = document.createElement('canvas')
  out.width = natural.value.w
  out.height = natural.value.h
  const ctx = out.getContext('2d')
  if (!ctx) return null
  // 先在透明底上画白笔（擦除笔迹 destination-out 抹成透明），再垫到黑底下面
  paint(ctx, '#fff')
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'source-over'
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' }) : null
}

defineExpose({ exportMask, clear, undo })
</script>

<template>
  <div ref="rootRef" class="flex flex-col gap-8px">
    <div class="flex flex-wrap items-center gap-8px text-13px text-ink-2">
      <div class="flex min-w-200px flex-1 basis-full items-center gap-10px">
        <label for="mask-brush" class="flex-none">笔刷</label>
        <input
          id="mask-brush"
          v-model.number="brush"
          type="range"
          min="8"
          max="80"
          step="2"
          class="h-32px min-w-0 flex-1 accent-violet"
        />
        <span
          class="mask-tip flex h-32px w-32px flex-none items-center justify-center overflow-hidden rounded-6px border border-solid border-line bg-white"
          aria-hidden="true"
          title="笔尖预览"
        >
          <span
            class="block flex-none rounded-full"
            :style="{
              width: `${tipSize}px`,
              height: `${tipSize}px`,
              background: tool === 'erase' ? 'transparent' : MASK_COLOR,
              opacity: tool === 'erase' ? 1 : MASK_OPACITY,
              boxShadow: tool === 'erase' ? 'inset 0 0 0 1.5px var(--xq-ink-2)' : undefined,
            }"
          />
        </span>
        <output class="w-28px flex-none text-right text-12px tabular-nums text-ink-3" for="mask-brush">{{
          brush
        }}</output>
      </div>
      <div
        class="inline-flex overflow-hidden rounded-8px border border-solid border-line"
        role="group"
        aria-label="缩放"
      >
        <button
          v-for="o in zoomOptions"
          :key="o.value"
          type="button"
          class="min-h-32px min-w-44px cursor-pointer border-0 px-10px text-13px focus-visible:(outline-2 outline-solid outline-violet -outline-offset-2)"
          :class="zoom === o.value ? 'bg-violet-soft text-violet-ink font-600' : 'bg-white text-ink-2'"
          :aria-pressed="zoom === o.value"
          @click="zoom = o.value"
        >
          {{ o.label }}
        </button>
      </div>
      <div
        class="inline-flex overflow-hidden rounded-8px border border-solid border-line"
        role="group"
        aria-label="工具"
      >
        <button
          type="button"
          class="inline-flex min-h-32px min-w-44px cursor-pointer items-center gap-4px border-0 px-10px text-13px focus-visible:(outline-2 outline-solid outline-violet -outline-offset-2)"
          :class="tool === 'brush' ? 'bg-violet-soft text-violet-ink font-600' : 'bg-white text-ink-2'"
          :aria-pressed="tool === 'brush'"
          title="在图上涂抹要消除的区域"
          @click="tool = 'brush'"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8 16l.2-3z" />
            <path d="M7 17c-2 0-3 1.5-3 3.5V21h.5C6.5 21 8 20 8 18" />
          </svg>
          涂抹
        </button>
        <button
          v-if="erasable"
          type="button"
          class="inline-flex min-h-32px min-w-44px cursor-pointer items-center gap-4px border-0 px-10px text-13px focus-visible:(outline-2 outline-solid outline-violet -outline-offset-2)"
          :class="tool === 'erase' ? 'bg-violet-soft text-violet-ink font-600' : 'bg-white text-ink-2'"
          :aria-pressed="tool === 'erase'"
          title="擦掉涂多的部分"
          @click="tool = 'erase'"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M7 21h10M5.5 13.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 18H8.5l-3-3a1 1 0 0 1 0-1.5z" />
            <path d="M9.5 9.5l6 6" />
          </svg>
          擦除
        </button>
        <button
          type="button"
          class="inline-flex min-h-32px min-w-44px cursor-pointer items-center gap-4px border-0 px-10px text-13px focus-visible:(outline-2 outline-solid outline-violet -outline-offset-2)"
          :class="tool === 'move' ? 'bg-violet-soft text-violet-ink font-600' : 'bg-white text-ink-2'"
          :aria-pressed="tool === 'move'"
          :title="coarse ? '滑动页面 / 拖动画面' : '拖动画面（也可按住鼠标中键拖动）'"
          @click="tool = 'move'"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
          </svg>
          移动
        </button>
      </div>
      <button
        type="button"
        class="ll-pill !min-h-32px !text-13px inline-flex items-center gap-4px focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        :disabled="!hasStroke"
        title="撤销（Ctrl/⌘+Z）"
        @click="undo"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 010 12h-3" />
        </svg>
        撤销
      </button>
      <button
        type="button"
        class="ll-pill !min-h-32px !text-13px inline-flex items-center gap-4px focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        :disabled="!hasStroke"
        @click="clear"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
        清空
      </button>
    </div>

    <p v-if="coarse" class="m-0 text-12px leading-18px text-muted">
      {{
        tool !== 'move'
          ? `${tool === 'erase' ? '擦除' : '涂抹'}中：手指在图上涂；要滑动页面先切「移动」`
          : '先点「涂抹」再在图上涂；「移动」状态下可直接滑动页面'
      }}
    </p>
    <div class="relative mx-auto max-w-full">
      <div
        ref="viewportRef"
        class="mask-viewport overflow-auto rounded-8px border border-solid border-line bg-surface3"
        :style="hasImage ? viewportStyle : undefined"
        @scroll.passive="updateViewBox"
      >
        <div class="relative m-auto" :style="hasImage ? stageStyle : undefined">
          <img
            :src="src"
            alt="待涂抹的原图"
            class="block select-none"
            :class="hasImage ? 'absolute inset-0 h-full w-full' : 'w-full h-auto'"
            draggable="false"
            @load="onImageLoad"
          />
          <canvas
            v-if="hasImage"
            ref="canvasRef"
            :width="natural.w"
            :height="natural.h"
            class="absolute inset-0 h-full w-full"
            :style="{
              opacity: MASK_OPACITY,
              cursor: tool === 'move' ? (panning ? 'grabbing' : 'grab') : 'crosshair',
              touchAction: tool === 'move' ? 'pan-x pan-y' : 'none',
            }"
            role="img"
            aria-label="涂抹画布：按住拖动涂抹要消除的区域"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @lostpointercapture="onPointerUp"
            @contextmenu.prevent
          />
        </div>
      </div>
      <div
        v-if="zoom > 1 && hasImage"
        ref="minimapRef"
        class="absolute bottom-8px right-8px w-88px cursor-crosshair touch-none overflow-hidden rounded-6px border border-solid border-line bg-white shadow-md"
        title="拖动缩略图快速定位"
        @pointerdown="onMinimapDown"
        @pointermove="onMinimapMove"
        @pointerup="onMinimapUp"
        @pointercancel="onMinimapUp"
      >
        <img :src="src" class="block h-auto w-full select-none" alt="整图缩略" draggable="false" />
        <span
          class="pointer-events-none absolute border border-solid border-violet-line bg-violet-soft"
          :style="{
            left: `${viewBox.left}%`,
            top: `${viewBox.top}%`,
            width: `${viewBox.width}%`,
            height: `${viewBox.height}%`,
          }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask-viewport {
  scrollbar-width: none;
}
.mask-viewport::-webkit-scrollbar {
  display: none;
}
</style>
