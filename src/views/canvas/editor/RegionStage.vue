<script setup lang="ts">
/**
 * 图片上的区域选取 + 标记（原型 styles/scoped/CanvasIdentifyMarkers.css：
 * .identify-box 2px 藤紫描边 r4 + 12% 浅底、待定态虚线；.identify-box__badge 16px 序号徽标贴在框左上外侧；
 * .identify-box__label 白底 r8 11px 标签，最宽 160 省略）。
 * 点选 = 单击；框选 = 拖拽。键盘：方向键移动十字准星（Shift 大步），回车 / 空格确认，框选需确认两次（起点、终点）。
 */
import { computed, ref } from 'vue'
import type { IActionRegion, RatioPoint } from './imageActions.ts'
import { REGION_BADGE } from './actionUi.ts'

const props = defineProps<{
  url: string
  regions: IActionRegion[]
  mode: 'point' | 'box'
  /** 高亮的区域（显示描述） */
  activeKey?: string
  disabled?: boolean
  /** 序号起点：编辑面板多图时序号跨图连续 */
  numberOf?: (region: IActionRegion) => number
}>()

const emit = defineEmits<{ draw: [shape: 'point' | 'box', points: RatioPoint[]]; hover: [key: string] }>()

const overlayRef = ref<HTMLElement | null>(null)
const draft = ref<{ from: RatioPoint; to: RatioPoint } | null>(null)
const focused = ref(false)
const cursor = ref<RatioPoint>([0.5, 0.5])
const anchor = ref<RatioPoint | null>(null)
let downAt: RatioPoint | null = null

const clamp = (value: number) => Math.min(1, Math.max(0, value))

function toRatio(event: PointerEvent): RatioPoint {
  const rect = overlayRef.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return [0.5, 0.5]
  return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)]
}

function normalizedBox(a: RatioPoint, b: RatioPoint): RatioPoint[] {
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  ]
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled || event.button !== 0) return
  overlayRef.value?.setPointerCapture(event.pointerId)
  downAt = toRatio(event)
  if (props.mode === 'box') draft.value = { from: downAt, to: downAt }
}

function onPointerMove(event: PointerEvent) {
  if (!downAt || props.mode !== 'box' || !draft.value) return
  draft.value = { from: draft.value.from, to: toRatio(event) }
}

function onPointerUp(event: PointerEvent) {
  if (!downAt) return
  const start = downAt
  const end = toRatio(event)
  downAt = null
  draft.value = null
  if (props.mode === 'point') {
    emit('draw', 'point', [end])
    return
  }
  const box = normalizedBox(start, end)
  const [tl, br] = box as [RatioPoint, RatioPoint]
  // 太小的框按误触处理
  if (br[0] - tl[0] < 0.02 || br[1] - tl[1] < 0.02) return
  emit('draw', 'box', box)
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  const step = event.shiftKey ? 0.1 : 0.02
  const [x, y] = cursor.value
  const moves: Record<string, RatioPoint> = {
    ArrowLeft: [x - step, y],
    ArrowRight: [x + step, y],
    ArrowUp: [x, y - step],
    ArrowDown: [x, y + step],
  }
  const next = moves[event.key]
  if (next) {
    event.preventDefault()
    cursor.value = [clamp(next[0]), clamp(next[1])]
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (props.mode === 'point') {
      emit('draw', 'point', [cursor.value])
      return
    }
    if (!anchor.value) {
      anchor.value = cursor.value
      return
    }
    const box = normalizedBox(anchor.value, cursor.value)
    anchor.value = null
    const [tl, br] = box as [RatioPoint, RatioPoint]
    if (br[0] - tl[0] >= 0.02 && br[1] - tl[1] >= 0.02) emit('draw', 'box', box)
    return
  }
  if (event.key === 'Escape' && anchor.value) {
    event.stopPropagation()
    anchor.value = null
  }
}

const pct = (value: number) => `${(value * 100).toFixed(2)}%`

/** 键盘框选中的预览框（起点已定，终点跟随准星） */
const keyboardDraft = computed(() => (anchor.value ? normalizedBox(anchor.value, cursor.value) : null))
const draftBox = computed(() => (draft.value ? normalizedBox(draft.value.from, draft.value.to) : keyboardDraft.value))

function boxStyle(points: RatioPoint[]) {
  const [tl, br] = points as [RatioPoint, RatioPoint]
  return { left: pct(tl[0]), top: pct(tl[1]), width: pct(br[0] - tl[0]), height: pct(br[1] - tl[1]) }
}

function markerStyle(region: IActionRegion) {
  if (region.shape === 'box') return boxStyle(region.points)
  const [px, py] = region.points[0] ?? [0.5, 0.5]
  return { left: pct(px), top: pct(py) }
}

function labelOf(region: IActionRegion): string {
  if (region.status === 'pending') return '识别中…'
  if (region.status === 'error') return '识别失败'
  return region.label || '未命名主体'
}

const hint = computed(() =>
  props.mode === 'point'
    ? '点击图片选取主体。键盘：方向键移动准星，回车确认'
    : anchor.value
      ? '已定起点，移动准星后回车确认终点，Esc 取消'
      : '拖拽框出主体。键盘：方向键移动准星，回车定起点',
)
</script>

<template>
  <div>
    <!-- 顶部留 20px：序号 / 标签贴在框外上方 -->
    <div
      class="flex justify-center px-8px pt-22px pb-8px overflow-hidden rounded-8px border border-solid border-line [background:repeating-conic-gradient(#e9ecef_0%,#e9ecef_25%,transparent_0%,transparent_50%)_0_0/16px_16px,#f3f4f5]"
    >
      <div class="relative inline-block max-w-full">
        <img :src="url" alt="" draggable="false" class="block max-w-full max-h-300px w-auto h-auto select-none" />
        <div
          ref="overlayRef"
          class="absolute inset-0 touch-none outline-none rounded-2px focus-visible:shadow-[0_0_0_3px_rgba(135,95,154,0.35)]"
          :class="disabled ? 'cursor-not-allowed' : 'cursor-crosshair'"
          tabindex="0"
          role="application"
          :aria-label="`${mode === 'point' ? '点选' : '框选'}区域。${hint}`"
          :aria-disabled="disabled || undefined"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="draft = null"
          @keydown="onKeydown"
          @focus="focused = true"
          @blur="focused = false"
        >
          <template v-for="region in regions" :key="region.key">
            <!-- 框选标记 -->
            <div
              v-if="region.shape === 'box'"
              class="absolute border-2 rounded-4px pointer-events-auto"
              :class="[
                region.status === 'pending' ? 'border-dashed' : 'border-solid',
                region.status === 'error'
                  ? 'border-danger bg-[rgba(180,67,62,0.10)]'
                  : 'border-violet bg-[rgba(135,95,154,0.12)]',
              ]"
              :style="markerStyle(region)"
              @pointerenter="emit('hover', region.key)"
              @pointerleave="emit('hover', '')"
            >
              <span :class="REGION_BADGE" class="absolute left-0 top-0 -translate-x-2px -translate-y-18px">{{
                numberOf ? numberOf(region) : regions.indexOf(region) + 1
              }}</span>
              <span
                class="absolute left-22px top-0 max-w-160px overflow-hidden px-6px rounded-8px bg-white text-ink-2 text-11px leading-16px whitespace-nowrap text-ellipsis -translate-y-18px"
                >{{ labelOf(region) }}</span
              >
              <span
                v-if="activeKey === region.key && region.status === 'done' && region.description"
                class="absolute left-0 top-full z-2 w-max max-w-200px mt-4px px-8px py-6px rounded-8px border border-solid border-line bg-white text-ink-2 text-11px leading-16px shadow-pop"
                >{{ region.description }}</span
              >
            </div>
            <!-- 点选标记：12px 圆点，序号与标签在点的右上方 -->
            <div
              v-else
              class="absolute w-0 h-0 pointer-events-auto"
              :style="markerStyle(region)"
              @pointerenter="emit('hover', region.key)"
              @pointerleave="emit('hover', '')"
            >
              <span
                class="absolute -left-6px -top-6px w-12px h-12px border-2 border-solid border-white rounded-full shadow-[0_0_0_1px_rgba(31,35,41,0.25)]"
                :class="[
                  region.status === 'error' ? 'bg-danger' : 'bg-violet',
                  region.status === 'pending' ? 'opacity-60' : '',
                ]"
              />
              <span :class="REGION_BADGE" class="absolute left-8px -top-22px">{{
                numberOf ? numberOf(region) : regions.indexOf(region) + 1
              }}</span>
              <span
                class="absolute left-28px -top-22px max-w-160px overflow-hidden px-6px rounded-8px bg-white text-ink-2 text-11px leading-16px whitespace-nowrap text-ellipsis"
                >{{ labelOf(region) }}</span
              >
              <span
                v-if="activeKey === region.key && region.status === 'done' && region.description"
                class="absolute left-8px top-10px z-2 w-max max-w-200px px-8px py-6px rounded-8px border border-solid border-line bg-white text-ink-2 text-11px leading-16px shadow-pop"
                >{{ region.description }}</span
              >
            </div>
          </template>

          <!-- 拖拽 / 键盘框选中的预览框（待定态虚线） -->
          <div
            v-if="draftBox"
            class="absolute border-2 border-dashed border-violet rounded-4px bg-[rgba(135,95,154,0.12)] pointer-events-none"
            :style="boxStyle(draftBox)"
          />
          <!-- 键盘准星：只在键盘聚焦时出现 -->
          <span
            v-if="focused && !disabled"
            class="absolute w-18px h-18px -ml-9px -mt-9px border-2 border-solid border-violet rounded-full bg-white/40 pointer-events-none"
            :style="{ left: pct(cursor[0]), top: pct(cursor[1]) }"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
    <p class="m-0 mt-6px text-muted text-11px leading-16px" aria-live="polite">{{ hint }}</p>
  </div>
</template>
