<script setup lang="ts">
/**
 * 柱列滑条（5185 原型 WakeSlider 设置浮层档：20 根柱、柱高 14、无端点刻度）——时长这类逐档数值用。
 *
 * <p>没有拇指：一排 3 宽细柱（间距 4，轨道宽 = 柱数 × 7 − 4），值以内的柱藤紫、其余浅灰 #e4e4ea，柱色 160ms 过渡；
 * 值写在右侧 14/20·600 藤紫深字（带单位，如「8 秒」）。拖动 / 点按定位，松手吸附到 step；
 * 键盘 ←/↓ 减、→/↑ 加（Shift ×5），Home / End 到两端；role=slider + aria-valuemin/max/now/valuetext。
 * 区间只有一个值时不画柱，只写「N 秒 固定」。原型的「拖得快柱子弹高」尾迹动效没搬（纯装饰），减少动效时也无需处理。
 */
import { computed, ref } from 'vue'

const {
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  label = '时长',
  disabled = false,
  bars = 20,
  height = 14,
} = defineProps<{
  min?: number
  max?: number
  step?: number
  /** 单位（值后面空一格写，如「秒」） */
  unit?: string
  /** 读屏名 */
  label?: string
  disabled?: boolean
  /** 柱数（8–64） */
  bars?: number
  /** 柱高 */
  height?: number
}>()

const value = defineModel<number>({ required: true })

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lo = computed(() => Math.min(min, max))
const hi = computed(() => Math.max(min, max))
const range = computed(() => hi.value - lo.value)
const isStatic = computed(() => range.value === 0)
const n = computed(() => Math.round(clamp(bars, 8, 64)))
const stepSize = computed(() => Math.max(0.001, Math.abs(step) || 1))
const current = computed(() => clamp(Number.isFinite(value.value) ? value.value : lo.value, lo.value, hi.value))
const valueText = computed(() => `${current.value}${unit ? ` ${unit}` : ''}`)
/** 亮到第几根（值在最小处时一根都不亮） */
const lit = computed(() =>
  current.value <= lo.value ? -1 : Math.round(((current.value - lo.value) / (range.value || 1)) * (n.value - 1)),
)
const trackWidth = computed(() => n.value * 7 - 4)

const track = ref<HTMLElement | null>(null)
const dragging = ref(false)

function snap(v: number) {
  const s = Math.round((clamp(v, lo.value, hi.value) - lo.value) / stepSize.value) * stepSize.value + lo.value
  return Math.round(clamp(s, lo.value, hi.value) * 1000) / 1000
}
function setFromX(clientX: number) {
  const rect = track.value?.getBoundingClientRect()
  if (!rect?.width) return
  const next = snap(lo.value + clamp((clientX - rect.left) / rect.width, 0, 1) * range.value)
  if (next !== value.value) value.value = next
}
function onPointerDown(e: PointerEvent) {
  if (disabled || e.button !== 0) return
  try {
    track.value?.setPointerCapture(e.pointerId)
  } catch {
    /* 合成事件没有指针可捕获 */
  }
  dragging.value = true
  setFromX(e.clientX)
  track.value?.focus({ preventScroll: true })
}
function onPointerMove(e: PointerEvent) {
  if (dragging.value) setFromX(e.clientX)
}
function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  try {
    track.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* 没捕获过 */
  }
}
function onKeydown(e: KeyboardEvent) {
  if (disabled || isStatic.value) return
  const mult = e.shiftKey ? 5 : 1
  let next: number | null = null
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = current.value + stepSize.value * mult
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current.value - stepSize.value * mult
  else if (e.key === 'Home') next = lo.value
  else if (e.key === 'End') next = hi.value
  if (next === null) return
  e.preventDefault()
  value.value = snap(next)
}
</script>

<template>
  <div class="flex items-center min-w-0 gap-12px" :class="disabled ? 'opacity-48' : ''">
    <template v-if="isStatic">
      <span class="text-14px font-600 leading-20px tabular-nums text-violet-ink">{{ valueText }}</span>
      <span class="text-10px text-placeholder">固定</span>
    </template>
    <template v-else>
      <div
        ref="track"
        class="flex flex-none items-center gap-4px rounded-6px select-none touch-none [-webkit-tap-highlight-color:transparent] outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-6px)"
        :class="disabled ? 'cursor-default' : 'cursor-ew-resize'"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        :aria-label="label"
        :aria-valuemin="lo"
        :aria-valuemax="hi"
        :aria-valuenow="current"
        :aria-valuetext="valueText"
        :aria-disabled="disabled || undefined"
        :style="{ width: `${trackWidth}px`, height: `${Math.round(height * 2.6)}px` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onKeydown"
      >
        <span
          v-for="i in n"
          :key="i"
          class="block flex-none w-3px rounded-3px [transition:background-color_160ms_ease] motion-reduce:transition-none"
          :class="i - 1 <= lit ? 'bg-violet' : 'bg-#e4e4ea'"
          :style="{ height: `${height}px` }"
          aria-hidden="true"
        />
      </div>
      <span class="min-w-[3.4ch] whitespace-nowrap text-14px font-600 leading-20px tabular-nums text-violet-ink">{{
        valueText
      }}</span>
    </template>
  </div>
</template>
