<script setup lang="ts">
/**
 * 全屏调色的大图区（ColorFixFullscreen 用）：校色后 / 原图 / 对比 三档 + 缩放平移 + 选区示意层。
 *
 * <ul>
 *   <li>缩放：滚轮（以指针为中心）、双击在「适应 ↔ 100%」间切换、底部 − / 百分比 / + / 适应 / 100%；
 *       触屏双指捏合；放大后按住拖动平移（图至少留 64px 在可视区内）。100% = 原图像素（不是预览小图的像素）。</li>
 *   <li>对比：两张图叠在同一个缩放框里，分割线按屏幕位置算——缩放 / 平移时分割线不动、跟着变的是两侧露出多少；
 *       拖分割线（或聚焦后 ← / →，Shift 10%、Home / End）移动，拖图其余位置照常平移。</li>
 *   <li>选区示意：`show-mask` 时按 `mask-view` 画当前生效蒙版（反选同步）——叠加（半透明藤紫）/ 黑白蒙版 / 仅选区
 *       （选区外棋盘格）/ 轮廓（行军蚁虚线，矢量，缩放后线宽不变）。</li>
 *   <li>100% 清晰度（2026-11-11）：烘好的预览图长边 1600，放大到超过它的分辨率时，停手 280ms 后只渲可视区域的原分辨率小块
 *       （cf.renderDetail → utils/colorfix colorFixRenderCrop，缓存最近 6 块）叠在预览图上；只靠 CSS filter 的整图校色直接给
 *       原图挂 filter。适应 / 小倍率时照旧只用预览图（快路径）。</li>
 * </ul>
 * 画面全部取自同一份 cf（displaySrc / previewStyle / liveFilter），不另起烘图。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { colorFixMaskAlpha, corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import type { ResultColorFix } from './useResultColorFix.ts'
import type { ColorFixViewMode } from './types.ts'
import { renderMaskView, type MaskViewMode } from './selection-ops.ts'
import { contoursToPath, maskContours } from './selection-geometry.ts'

const {
  cf,
  mode,
  labels = ['原图', '校色后'],
  showMask = false,
  maskView = 'overlay',
} = defineProps<{
  cf: ResultColorFix
  mode: ColorFixViewMode
  /** 对比两侧的名字 */
  labels?: [string, string]
  /** 显示选区示意层 */
  showMask?: boolean
  /** 选区示意的查看方式 */
  maskView?: MaskViewMode
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
/** 轮廓：网格坐标的 path + 网格尺寸 */
const outline = ref<{ d: string; w: number; h: number } | null>(null)
let maskTicket = 0
let alphaCache: { key: string; a: { data: Uint8Array; width: number; height: number } } | null = null
watch(
  () => [showMask, cf.effectiveMask.value, cf.region.value.invert, maskView] as const,
  async ([on, mask, invert, view]) => {
    const my = ++maskTicket
    if (!on || !mask) {
      maskImage.value = ''
      outline.value = null
      return
    }
    try {
      // 轮廓按 1024 网格算（够细、快），其余按 1600
      const side = view === 'outline' ? 1024 : 1600
      const key = `${mask}|${invert ? 1 : 0}|${side}`
      const a = alphaCache?.key === key ? alphaCache.a : await colorFixMaskAlpha(mask, { invert, maxSide: side })
      if (my !== maskTicket) return
      alphaCache = { key, a }
      if (view === 'outline') {
        maskImage.value = ''
        outline.value = { d: contoursToPath(maskContours(a.data, a.width, a.height, 128, 0.4)), w: a.width, h: a.height }
        return
      }
      outline.value = null
      const c = document.createElement('canvas')
      c.width = a.width
      c.height = a.height
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('画布不可用')
      const img = ctx.createImageData(a.width, a.height)
      renderMaskView(a.data, a.width, a.height, view, { alpha: 0.5, checker: 12, out: img.data })
      ctx.putImageData(img, 0, 0)
      maskImage.value = c.toDataURL('image/png')
      c.width = c.height = 0
    } catch {
      if (my === maskTicket) {
        maskImage.value = ''
        outline.value = null
      }
    }
  },
  { immediate: true },
)
/** 轮廓线宽 / 虚线按「网格单位 → 屏幕像素」换算（缩放框是 CSS 缩放，不能靠 non-scaling-stroke） */
const outlineUnit = computed(() => {
  const o = outline.value
  if (!o || !natural.value.w) return 1
  return 1 / Math.max(1e-6, (scale.value * natural.value.w) / o.w)
})

// ---------------- 100% 清晰度：放大后局部高清 ----------------

const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)
/** 屏幕上每个原图像素占多少物理像素超过了预览图能给的：需要高清 */
const zoomedBeyond = computed(() => {
  const long = Math.max(natural.value.w, natural.value.h)
  if (!long || long <= cf.previewSide) return false
  return scale.value * dpr * long > cf.previewSide * 1.05
})
/** 整图 CSS filter 能表达的校色：放大后直接给原图挂 filter（原分辨率） */
const filterDetail = computed(() => zoomedBeyond.value && !!cf.wholeFilter.value)
const detail = ref<{ url: string; key: string; x: number; y: number; w: number; h: number } | null>(null)
const detailBusy = ref(false)
let detailTimer: ReturnType<typeof setTimeout> | null = null
let detailTicket = 0
function scheduleDetail() {
  if (detailTimer) clearTimeout(detailTimer)
  detailTimer = null
  if (!zoomedBeyond.value || filterDetail.value || mode === 'original' || !cf.detailKey.value) return
  detailTimer = setTimeout(runDetail, 280)
}
async function runDetail() {
  detailTimer = null
  // 参数还在变（烘图中）：等烘完（ready 变化会再排一次）
  if (!cf.ready.value || !zoomedBeyond.value) return
  const { w: nw, h: nh } = natural.value
  const s = scale.value
  const left = view.value.w / 2 + tx.value - (nw * s) / 2
  const top = view.value.h / 2 + ty.value - (nh * s) / 2
  // 可视区域（原图像素）四周各多取 12%，小幅平移不用重渲
  let x0 = -left / s
  let y0 = -top / s
  let x1 = (view.value.w - left) / s
  let y1 = (view.value.h - top) / s
  const mx = (x1 - x0) * 0.12
  const my = (y1 - y0) * 0.12
  x0 = Math.max(0, Math.floor(x0 - mx))
  y0 = Math.max(0, Math.floor(y0 - my))
  x1 = Math.min(nw, Math.ceil(x1 + mx))
  y1 = Math.min(nh, Math.ceil(y1 + my))
  if (x1 - x0 < 2 || y1 - y0 < 2) return
  const key = cf.detailKey.value
  const d = detail.value
  // 当前那块已覆盖可视区且参数没变：不重渲
  if (d && d.key === key && d.x <= Math.max(0, x0 + mx) && d.y <= Math.max(0, y0 + my) && d.x + d.w >= Math.min(nw, x1 - mx) && d.y + d.h >= Math.min(nh, y1 - my))
    return
  // 输出分辨率：不超过原图、不超过屏幕需要；单块像素上限 600 万
  let out = Math.min(1, s * dpr)
  const px = (x1 - x0) * (y1 - y0) * out * out
  if (px > 6e6) out *= Math.sqrt(6e6 / px)
  const my2 = ++detailTicket
  detailBusy.value = true
  try {
    const r = await cf.renderDetail({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, out)
    if (my2 !== detailTicket || !r || key !== cf.detailKey.value) return
    // 按渲染实际覆盖的区域摆（输出像素取整后的），与预览图逐像素对齐
    detail.value = { url: r.url, key, x: r.x, y: r.y, w: r.w, h: r.h }
  } catch {
    /* 局部高清失败：继续用预览图 */
  } finally {
    if (my2 === detailTicket) detailBusy.value = false
  }
}
watch(
  () => [scale.value, tx.value, ty.value, view.value.w, view.value.h, cf.detailKey.value, cf.ready.value, mode, zoomedBeyond.value] as const,
  scheduleDetail,
)
/** 参数变了：旧的高清块对不上，立刻不显示 */
const detailShown = computed(() =>
  detail.value && zoomedBeyond.value && !filterDetail.value && detail.value.key === cf.detailKey.value && cf.ready.value
    ? detail.value
    : null,
)
const tileStyle = computed(() => {
  const d = detailShown.value
  const { w, h } = natural.value
  if (!d || !w) return undefined
  return { left: `${(d.x / w) * 100}%`, top: `${(d.y / h) * 100}%`, width: `${(d.w / w) * 100}%`, height: `${(d.h / h) * 100}%` }
})

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
  if (detailTimer) clearTimeout(detailTimer)
  detailTicket += 1
})

const boxStyle = computed(() => ({
  width: `${natural.value.w}px`,
  height: `${natural.value.h}px`,
  transform: `translate(-50%, -50%) translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}))

const resultSrc = computed(() => (filterDetail.value ? cf.src.value : cf.displaySrc.value || cf.src.value))
const resultStyle = computed(() => (filterDetail.value ? { filter: cf.wholeFilter.value } : cf.previewStyle.value))

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
          :style="resultStyle"
          :crossorigin="corsAttr(resultSrc)"
          :alt="labels[1]"
          draggable="false"
          class="cfz-img"
          @error="markCorsBlocked(resultSrc)"
        />
        <img v-if="detailShown" :src="detailShown.url" alt="" aria-hidden="true" draggable="false" class="cfz-tile" :style="tileStyle" />
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
      <svg
        v-if="outline"
        class="cfz-img overflow-visible"
        :viewBox="`0 0 ${outline.w} ${outline.h}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path :d="outline.d" fill="none" stroke="#fff" :stroke-width="2.5 * outlineUnit" />
        <path
          class="cfz-ants"
          :d="outline.d"
          fill="none"
          stroke="#1f2329"
          :stroke-width="1.25 * outlineUnit"
          :stroke-dasharray="`${5 * outlineUnit} ${4 * outlineUnit}`"
          :style="{ '--ants': `${-9 * outlineUnit}` }"
        />
      </svg>
    </div>
    <div v-else class="absolute inset-0 grid place-items-center text-13px text-white/70">图片加载中…</div>
    <span
      v-if="zoomedBeyond && detailBusy && !filterDetail"
      class="absolute right-12px bottom-72px z-5 inline-flex items-center h-24px px-10px rounded-full bg-[rgba(15,20,25,0.55)] text-12px text-white pointer-events-none"
      role="status"
    >
      正在加载高清细节…
    </span>

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
          class="absolute left-1/2 top-0 bottom-0 w-2px -ml-1px bg-#fff [filter:drop-shadow(0_0_6px_rgba(135,95,154,0.6))]"
          aria-hidden="true"
        />
        <span
          class="absolute left-1/2 top-1/2 grid w-36px h-36px -translate-x-1/2 -translate-y-1/2 box-border place-items-center rounded-full border border-solid border-line-strong bg-[linear-gradient(var(--xq-surface),#f4f5f6)] text-violet-ink shadow-[0_4px_10px_rgba(31,35,41,0.2)] outline-none focus-visible:(outline-2 outline-solid outline-white outline-offset-2)"
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
  background: repeating-conic-gradient(var(--xq-checker-b) 0% 25%, var(--xq-checker-a) 0% 50%) 50% / 16px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.cfz-tile {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}
.cfz-ants {
  animation: cfz-ants 0.9s linear infinite;
}
@keyframes cfz-ants {
  to {
    stroke-dashoffset: var(--ants);
  }
}
@media (prefers-reduced-motion: reduce) {
  .cfz-ants {
    animation: none;
  }
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
