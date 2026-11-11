<script setup lang="ts">
/**
 * 全屏调色的大图区（ColorFixFullscreen 用）：校色后 / 原图 / 对比 三档 + 缩放平移 + 选区示意层。
 *
 * <ul>
 *   <li>缩放：滚轮（以指针为中心）、双击在「适应 ↔ 100%」间切换、底部 − / 百分比 / + / 适应 / 100%；
 *       触屏双指捏合；放大后按住拖动平移（图至少留 64px 在可视区内）。100% = 原图像素（不是预览小图的像素）。</li>
 *   <li>对比：两张图叠在同一个缩放框里，分割线按屏幕位置算——缩放 / 平移时分割线不动、跟着变的是两侧露出多少；
 *       拖分割线（或聚焦后 ← / →，Shift 10%、Home / End）移动，拖图其余位置照常平移。</li>
 *   <li>选区示意：`show-mask` 时把当前生效蒙版画成半透明藤紫层（utils/colorfix colorFixMaskOverlay，反选同步）。</li>
 * </ul>
 * 画面全部取自同一份 cf（displaySrc / previewStyle / liveFilter），不另起烘图。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { colorFixMaskOverlay, corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import type { ResultColorFix } from './useResultColorFix.ts'
import type { ColorFixViewMode } from './types.ts'

const {
  cf,
  mode,
  labels = ['原图', '校色后'],
  showMask = false,
} = defineProps<{
  cf: ResultColorFix
  mode: ColorFixViewMode
  /** 对比两侧的名字 */
  labels?: [string, string]
  /** 显示选区示意层 */
  showMask?: boolean
}>()

const vp = ref<HTMLElement | null>(null)
const view = ref({ w: 0, h: 0 })
const natural = ref({ w: 0, h: 0 })
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
/** 处于「适应」：窗口 / 图变了自动重新适应 */
const fitted = ref(true)
/** 对比分割线位置：可视区宽度的比例 0–1 */
const split = ref(0.5)

const PAD = 24
/** 底部给缩放条让位：适应档时图不压在缩放条下面 */
const PAD_BOTTOM = 72
const MAX_SCALE = 8

const fitScale = computed(() => {
  const { w, h } = natural.value
  if (!w || !h || !view.value.w || !view.value.h) return 1
  return Math.max(0.01, Math.min((view.value.w - PAD * 2) / w, (view.value.h - PAD - PAD_BOTTOM) / h))
})
const minScale = computed(() => Math.min(fitScale.value, 1) * 0.5)
const pct = computed(() => Math.round(scale.value * 100))

function clampPan() {
  const bw = natural.value.w * scale.value
  const bh = natural.value.h * scale.value
  const mx = Math.max(0, (bw + view.value.w) / 2 - 64)
  const my = Math.max(0, (bh + view.value.h) / 2 - 64)
  tx.value = Math.min(mx, Math.max(-mx, tx.value))
  ty.value = Math.min(my, Math.max(-my, ty.value))
}

function fit() {
  fitted.value = true
  scale.value = fitScale.value
  tx.value = 0
  // 上下留白不对称（底部让缩放条）：图心上移一半差值
  ty.value = -(PAD_BOTTOM - PAD) / 2
}

/** 缩放到 next，保持屏幕点 (cx, cy)（相对可视区左上）下的图像点不动；不给点 = 可视区中心 */
function zoomTo(next: number, cx?: number, cy?: number) {
  const s0 = scale.value
  const s1 = Math.min(MAX_SCALE, Math.max(minScale.value, next))
  if (!natural.value.w || s1 === s0) return
  const mx = (cx ?? view.value.w / 2) - view.value.w / 2
  const my = (cy ?? view.value.h / 2) - view.value.h / 2
  tx.value = mx - (mx - tx.value) * (s1 / s0)
  ty.value = my - (my - ty.value) * (s1 / s0)
  scale.value = s1
  fitted.value = false
  clampPan()
}
function zoomIn() {
  zoomTo(scale.value * 1.25)
}
function zoomOut() {
  zoomTo(scale.value / 1.25)
}
function actual(cx?: number, cy?: number) {
  zoomTo(1, cx, cy)
}

defineExpose({ zoomIn, zoomOut, fit, actual })

// ---------------- 尺寸 ----------------

let observer: ResizeObserver | null = null
function measure() {
  const el = vp.value
  if (!el) return
  view.value = { w: el.clientWidth, h: el.clientHeight }
  if (fitted.value) fit()
  else clampPan()
}

/** 原图像素尺寸：100% 以它为准（显示的可能是长边 1600 的预览图）；crossorigin 与展示口径一致，不污染缓存 */
let probeTicket = 0
watch(
  () => cf.src.value,
  (src) => {
    const my = ++probeTicket
    natural.value = { w: 0, h: 0 }
    if (!src) return
    const img = new Image()
    const cors = corsAttr(src)
    if (cors) img.crossOrigin = cors
    img.decoding = 'async'
    img.onload = () => {
      if (my !== probeTicket) return
      natural.value = { w: img.naturalWidth, h: img.naturalHeight }
      fit()
    }
    img.onerror = () => {
      if (my !== probeTicket) return
      if (cors) markCorsBlocked(src)
      const plain = new Image()
      plain.onload = () => {
        if (my !== probeTicket) return
        natural.value = { w: plain.naturalWidth, h: plain.naturalHeight }
        fit()
      }
      plain.src = src
    }
    img.src = src
  },
  { immediate: true },
)

// ---------------- 滚轮 / 拖动 / 捏合 ----------------

function localPoint(e: { clientX: number; clientY: number }) {
  const r = vp.value?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

function onWheel(e: WheelEvent) {
  if (!natural.value.w) return
  e.preventDefault()
  const p = localPoint(e)
  // 触控板捏合（ctrlKey）步子小，放大系数加大一些
  const k = e.ctrlKey ? 0.01 : 0.0015
  zoomTo(scale.value * Math.exp(-e.deltaY * k), p.x, p.y)
}

const pointers = new Map<number, { x: number; y: number }>()
let panFrom: { x: number; y: number; tx: number; ty: number } | null = null
let pinchFrom: { dist: number; scale: number } | null = null
const panning = ref(false)
let splitDragging = false

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  if ((e.target as HTMLElement).closest('[data-no-pan]')) return
  vp.value?.setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, localPoint(e))
  if (pointers.size === 1) {
    const p = localPoint(e)
    panFrom = { x: p.x, y: p.y, tx: tx.value, ty: ty.value }
    panning.value = true
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
    pinchFrom = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: scale.value }
    panFrom = null
  }
}

function onPointerMove(e: PointerEvent) {
  if (splitDragging) return onSplitMove(e)
  if (!pointers.has(e.pointerId)) return
  const p = localPoint(e)
  pointers.set(e.pointerId, p)
  if (pointers.size >= 2 && pinchFrom) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
    zoomTo(pinchFrom.scale * (dist / pinchFrom.dist), (a.x + b.x) / 2, (a.y + b.y) / 2)
    return
  }
  if (!panFrom) return
  tx.value = panFrom.tx + (p.x - panFrom.x)
  ty.value = panFrom.ty + (p.y - panFrom.y)
  fitted.value = false
  clampPan()
}

function onPointerUp(e: PointerEvent) {
  if (splitDragging) {
    splitDragging = false
    return
  }
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchFrom = null
  if (pointers.size === 1) {
    const p = [...pointers.values()][0]!
    panFrom = { x: p.x, y: p.y, tx: tx.value, ty: ty.value }
  } else if (!pointers.size) {
    panFrom = null
    panning.value = false
  }
}

function onDblClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('[data-no-pan]')) return
  const p = localPoint(e)
  if (Math.abs(scale.value - 1) < 0.01) fit()
  else actual(p.x, p.y)
}

// ---------------- 对比分割线 ----------------

function onSplitDown(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  e.stopPropagation()
  splitDragging = true
  vp.value?.setPointerCapture?.(e.pointerId)
  onSplitMove(e)
}
function onSplitMove(e: PointerEvent) {
  if (!view.value.w) return
  split.value = Math.min(1, Math.max(0, localPoint(e).x / view.value.w))
}
function onSplitKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 0.1 : 0.05
  if (e.key === 'ArrowLeft') split.value = Math.max(0, split.value - step)
  else if (e.key === 'ArrowRight') split.value = Math.min(1, split.value + step)
  else if (e.key === 'Home') split.value = 0
  else if (e.key === 'End') split.value = 1
  else return
  e.preventDefault()
  e.stopPropagation()
}

/** 分割线落在缩放框里的百分比（0–100）：左侧露原图 */
const splitInBox = computed(() => {
  const bw = natural.value.w * scale.value
  if (!bw) return 50
  const left = view.value.w / 2 + tx.value - bw / 2
  return Math.min(100, Math.max(0, ((split.value * view.value.w - left) / bw) * 100))
})

// ---------------- 选区示意层 ----------------

const maskImage = ref('')
let maskTicket = 0
watch(
  () => [showMask, cf.effectiveMask.value, cf.region.value.invert] as const,
  async ([on, mask, invert]) => {
    const my = ++maskTicket
    if (!on || !mask) {
      maskImage.value = ''
      return
    }
    try {
      const canvas = await colorFixMaskOverlay(mask, { invert, maxSide: 1600 })
      if (my !== maskTicket) return
      maskImage.value = canvas.toDataURL('image/png')
      canvas.width = canvas.height = 0
    } catch {
      if (my === maskTicket) maskImage.value = ''
    }
  },
  { immediate: true },
)

onMounted(() => {
  measure()
  if (vp.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(vp.value)
  }
  vp.value?.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  vp.value?.removeEventListener('wheel', onWheel)
})

const boxStyle = computed(() => ({
  width: `${natural.value.w}px`,
  height: `${natural.value.h}px`,
  transform: `translate(-50%, -50%) translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}))

const resultSrc = computed(() => cf.displaySrc.value || cf.src.value)

const tagCls =
  'absolute top-12px z-3 inline-flex items-center h-24px box-border px-10px rounded-full bg-[rgba(15,20,25,0.55)] text-12px leading-24px text-white pointer-events-none'
const zoomBtn =
  'h-32px box-border px-10px rounded-8px border-none bg-transparent text-12px text-ink-2 cursor-pointer whitespace-nowrap hover:(bg-surface3 text-ink) sx-focus'
</script>

<template>
  <div
    ref="vp"
    class="cfz relative overflow-hidden select-none touch-none"
    :class="panning ? 'cursor-grabbing' : 'cursor-grab'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="onDblClick"
  >
    <div v-if="natural.w" class="cfz-box absolute left-1/2 top-1/2 origin-center" :style="boxStyle">
      <img
        v-if="mode === 'original'"
        :src="cf.src.value"
        :crossorigin="corsAttr(cf.src.value)"
        :alt="labels[0]"
        draggable="false"
        class="cfz-img"
        @error="markCorsBlocked(cf.src.value)"
      />
      <template v-else>
        <img
          :src="resultSrc"
          :style="cf.previewStyle.value"
          :crossorigin="corsAttr(resultSrc)"
          :alt="labels[1]"
          draggable="false"
          class="cfz-img"
          @error="markCorsBlocked(resultSrc)"
        />
        <div
          v-if="mode === 'compare'"
          class="absolute inset-0"
          :style="{ clipPath: `inset(0 ${100 - splitInBox}% 0 0)` }"
        >
          <img
            :src="cf.src.value"
            :crossorigin="corsAttr(cf.src.value)"
            :alt="labels[0]"
            draggable="false"
            class="cfz-img"
            @error="markCorsBlocked(cf.src.value)"
          />
        </div>
      </template>
      <img v-if="maskImage" :src="maskImage" alt="" aria-hidden="true" draggable="false" class="cfz-img" />
    </div>
    <div v-else class="absolute inset-0 grid place-items-center text-13px text-white/70">图片加载中…</div>

    <!-- 对比分割线：屏幕坐标，缩放平移时不动 -->
    <template v-if="mode === 'compare' && natural.w">
      <span :class="[tagCls, 'left-12px']">{{ labels[0] }}</span>
      <span :class="[tagCls, 'right-12px']">{{ labels[1] }}</span>
      <div
        data-no-pan
        class="absolute top-0 bottom-0 z-4 w-24px -ml-12px cursor-ew-resize"
        :style="{ left: `${split * 100}%` }"
        @pointerdown="onSplitDown"
      >
        <span
          class="absolute left-1/2 top-0 bottom-0 w-2px -ml-1px bg-white [filter:drop-shadow(0_0_6px_rgba(135,95,154,0.6))]"
          aria-hidden="true"
        />
        <span
          class="absolute left-1/2 top-1/2 grid w-36px h-36px -translate-x-1/2 -translate-y-1/2 box-border place-items-center rounded-full border border-solid border-line-strong bg-[linear-gradient(#ffffff,#f4f5f6)] text-violet-ink shadow-[0_4px_10px_rgba(31,35,41,0.2)] outline-none focus-visible:(outline-2 outline-solid outline-white outline-offset-2)"
          role="slider"
          tabindex="0"
          :aria-label="`${labels[0]}与${labels[1]}分割线`"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(split * 100)"
          :aria-valuetext="`${labels[0]}占 ${Math.round(split * 100)}%`"
          @keydown="onSplitKey"
        >
          <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 1 1 5l4 4M11 1l4 4-4 4" />
          </svg>
        </span>
      </div>
    </template>

    <!-- 缩放条 -->
    <div
      data-no-pan
      class="absolute left-1/2 bottom-16px z-5 -translate-x-1/2 flex items-center gap-4px p-4px rounded-12px bg-white/94 shadow-[0_6px_18px_rgba(0,0,0,0.25)] cursor-default"
      role="group"
      aria-label="缩放"
      @dblclick.stop
    >
      <IconButton label="缩小（-）" variant="quiet" :disabled="scale <= minScale + 1e-6" @click="zoomOut">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12" /></svg>
      </IconButton>
      <span class="min-w-48px text-center text-12px tabular-nums text-ink" aria-live="polite">{{ pct }}%</span>
      <IconButton label="放大（+）" variant="quiet" :disabled="scale >= MAX_SCALE - 1e-6" @click="zoomIn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12M12 6v12" /></svg>
      </IconButton>
      <span class="w-1px h-18px bg-line mx-2px" aria-hidden="true" />
      <button type="button" :class="[zoomBtn, fitted && 'text-violet-ink font-600']" :aria-pressed="fitted" title="适应窗口（0）" @click="fit">
        适应
      </button>
      <button type="button" :class="[zoomBtn, !fitted && pct === 100 && 'text-violet-ink font-600']" :aria-pressed="!fitted && pct === 100" title="原图像素 100%（1）" @click="actual()">
        100%
      </button>
    </div>
  </div>
</template>

<style scoped lang="less">
.cfz {
  /* 深色看图台：颜色判断不受页面白底影响 */
  background-color: #1d1f23;
  background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 16px 16px;
}
.cfz-box {
  will-change: transform;
  /* 透明图：棋盘格衬底 */
  background: repeating-conic-gradient(#e9eaec 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.cfz-img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}
</style>
