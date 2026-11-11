<script setup lang="ts">
/**
 * 图片前后对比（原型 ImageCompare，C-27）：输入图在分割线左侧、结果图铺底；按下画面任意位置即把分割线移过去，
 * 拖动跟手，键盘 ← → 每次 5%（Shift 10%）、Home / End 到两端。
 *
 * <p>组件铺满父容器（父级 relative 且有高度），并按结果图真实比例算出居中的最大框，避免窄高舞台上下大片留白。
 * 数值：标签高 22、r999、底 rgba(15,20,25,.5)、11/20 白字；分割线 2px 白 + drop-shadow(0 0 6px rgba(135,95,154,.55))；
 * 拖柄 30 圆、白→#f4f5f6 渐变 + line-strong 描边 + 短影，箭头 violet-ink（原型 v3 对比柄）。只做直线分割，不做原型的弹簧弯曲。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'

const {
  before,
  after,
  labels = ['输入图', '生成结果'],
  ariaLabel = '图片前后对比',
  afterFilter,
  cors = false,
} = defineProps<{
  before: string
  after: string
  labels?: [string, string]
  ariaLabel?: string
  /** 挂在结果图上的 CSS filter（校色对比：同一张图，右侧挂校色滤镜预览） */
  afterFilter?: string
  /**
   * 两张图带 crossorigin="anonymous" 加载（校色场景）：让浏览器缓存里是带 CORS 头的那份，随后烘图读像素不会命中
   * 不带 CORS 头的缓存；服务端没配 CORS 时自动退回普通加载（utils/colorfix corsAttr）
   */
  cors?: boolean
}>()

const root = ref<HTMLElement | null>(null)
const afterImg = ref<HTMLImageElement | null>(null)
/** 分割线位置（0–100，左侧显示输入图） */
const pos = ref(50)
const held = ref(false)
const box = ref<{ width: string; height: string }>({ width: '100%', height: '100%' })

let observer: ResizeObserver | null = null

function measure() {
  const parent = root.value?.parentElement
  if (!parent) return
  const rect = parent.getBoundingClientRect()
  const img = afterImg.value
  const ratio = img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0
  if (!ratio || !rect.width || !rect.height) {
    box.value = { width: '100%', height: '100%' }
    return
  }
  let w = rect.width
  let h = w / ratio
  if (h > rect.height) {
    h = rect.height
    w = h * ratio
  }
  box.value = { width: `${w.toFixed(2)}px`, height: `${h.toFixed(2)}px` }
}

onMounted(() => {
  const parent = root.value?.parentElement
  if (!parent) return
  observer = new ResizeObserver(measure)
  observer.observe(parent)
})
onBeforeUnmount(() => observer?.disconnect())

const clamp = (v: number) => Math.min(100, Math.max(0, v))

function moveTo(clientX: number) {
  const rect = root.value?.getBoundingClientRect()
  if (!rect?.width) return
  pos.value = clamp(((clientX - rect.left) / rect.width) * 100)
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  held.value = true
  root.value?.setPointerCapture(e.pointerId)
  moveTo(e.clientX)
}
function onPointerMove(e: PointerEvent) {
  if (held.value) moveTo(e.clientX)
}
function onPointerUp(e: PointerEvent) {
  held.value = false
  if (root.value?.hasPointerCapture(e.pointerId)) root.value.releasePointerCapture(e.pointerId)
}

function onKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 5
  if (e.key === 'ArrowLeft') pos.value = clamp(pos.value - step)
  else if (e.key === 'ArrowRight') pos.value = clamp(pos.value + step)
  else if (e.key === 'Home') pos.value = 0
  else if (e.key === 'End') pos.value = 100
  else return
  e.preventDefault()
}

const tagCls =
  'absolute top-10px z-3 inline-flex items-center h-22px box-border px-9px rounded-full border border-solid border-white/16 ' +
  'bg-[rgba(15,20,25,0.5)] backdrop-blur-8px text-11px font-500 leading-20px text-white whitespace-nowrap pointer-events-none ' +
  '[transition:opacity_140ms_ease] motion-reduce:transition-none'
</script>

<template>
  <div
    ref="root"
    class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden [border-radius:inherit] bg-surface3 select-none touch-none outline-none focus-visible:shadow-[0_0_0_2px_var(--xq-violet),0_0_0_5px_rgba(135,95,154,0.2)]"
    :class="held ? 'cursor-grabbing' : 'cursor-ew-resize'"
    :style="box"
    role="slider"
    tabindex="0"
    :aria-label="ariaLabel"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(pos)"
    :aria-valuetext="`${labels[0]}占 ${Math.round(pos)}%`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
  >
    <img
      ref="afterImg"
      :src="after"
      :crossorigin="cors ? corsAttr(after) : undefined"
      :alt="labels[1]"
      class="absolute inset-0 block w-full h-full object-contain pointer-events-none"
      :style="afterFilter ? { filter: afterFilter } : undefined"
      draggable="false"
      @load="measure"
      @error="cors && markCorsBlocked(after)"
    />
    <div class="absolute inset-0" :style="{ clipPath: `inset(0 ${100 - pos}% 0 0)` }">
      <img
        :src="before"
        :crossorigin="cors ? corsAttr(before) : undefined"
        :alt="labels[0]"
        class="absolute inset-0 block w-full h-full object-contain pointer-events-none"
        draggable="false"
        @error="cors && markCorsBlocked(before)"
      />
    </div>
    <span :class="[tagCls, 'left-10px']" :style="{ opacity: Math.min(1, Math.max(0, (pos / 100 - 0.14) * 4)) }">{{
      labels[0]
    }}</span>
    <span :class="[tagCls, 'right-10px']" :style="{ opacity: Math.min(1, Math.max(0, (0.86 - pos / 100) * 4)) }">{{
      labels[1]
    }}</span>
    <span
      class="absolute top-0 bottom-0 z-4 w-2px -ml-1px bg-#fff pointer-events-none [filter:drop-shadow(0_0_6px_rgba(135,95,154,0.55))]"
      :style="{ left: `${pos}%` }"
      aria-hidden="true"
    />
    <span
      class="absolute top-1/2 z-5 grid w-30px h-30px box-border place-items-center rounded-full border border-solid border-line-strong bg-[linear-gradient(var(--xq-surface),var(--xq-surface3))] text-violet-ink pointer-events-none shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(31,35,41,0.1),0_4px_10px_rgba(31,35,41,0.16)] [transition:transform_220ms_ease] motion-reduce:transition-none"
      :class="held ? '-translate-x-1/2 -translate-y-1/2 scale-92' : '-translate-x-1/2 -translate-y-1/2'"
      :style="{ left: `${pos}%` }"
      aria-hidden="true"
    >
      <svg
        width="14"
        height="9"
        viewBox="0 0 16 10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M5 1 1 5l4 4M11 1l4 4-4 4" />
      </svg>
    </span>
  </div>
</template>
