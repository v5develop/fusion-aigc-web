<script setup lang="ts">
/**
 * 结果图校色面板（原型 tool/ColorFixPanel：364 宽、可拖标题栏、五滑杆）。
 *
 * <p>挂在结果列里（就地 fixed、右缘垂直居中，可拖走；不 Teleport——body 级浮层在本页会被下层内容盖住）：
 * - 滑杆：色相 / 饱和度 / 明度 / 亮度 / 对比度，11.5 标签 + 12px 色点 + 18h 数值芯片（0 显 ghost），
 *   4px 轨道（零位刻度 + 紫渐变填充）+ 14px 白拇指（按下 1.12）；
 * - 底行：说明 11px + 恢复默认（24h r12，未动过禁用）+ 完成（主按钮）。
 * 参数 v-model 双向；改动即时生效由父级把 colorFixFilter 挂到舞台图上。
 */
import { computed, ref, useId } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { COLORFIX_DEFAULT, COLORFIX_RANGES, colorFixIsZero, type ColorFixParams } from '@/utils/colorfix.ts'

const params = defineModel<ColorFixParams>({ required: true })

const emit = defineEmits<{
  /** 点了「完成」 */
  done: []
}>()

const panelId = `cfp-${useId()}`

/** 面板位置：默认贴结果列右缘、垂直居中；标题栏可拖（拖出边界夹回，不越出视口） */
const pos = ref<{ x: number | null; y: number | null }>({ x: null, y: null })
const rootRef = ref<HTMLElement>()
let drag: { startX: number; startY: number; baseX: number; baseY: number } | null = null

const positionStyle = computed(() =>
  pos.value.x == null || pos.value.y == null
    ? { right: '12px', top: 'calc(50% - 210px)' }
    : { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto' },
)

function onDragStart(e: PointerEvent) {
  // 头部里的按钮 / 输入控件（如 × 关闭）不起拖：否则 setPointerCapture 会吞掉它们的 click
  if ((e.target as Element | null)?.closest('button, input, select, textarea, [role="button"]')) return
  const node = rootRef.value
  if (!node) return
  const r = node.getBoundingClientRect()
  const baseX = pos.value.x ?? r.left
  const baseY = pos.value.y ?? r.top
  drag = { startX: e.clientX, startY: e.clientY, baseX, baseY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onDragMove(e: PointerEvent) {
  if (!drag) return
  const w = rootRef.value?.offsetWidth ?? 364
  const h = rootRef.value?.offsetHeight ?? 420
  const x = Math.min(Math.max(4, drag.baseX + e.clientX - drag.startX), window.innerWidth - w - 4)
  const y = Math.min(Math.max(4, drag.baseY + e.clientY - drag.startY), window.innerHeight - h - 4)
  pos.value = { x, y }
}
function onDragEnd() {
  drag = null
}

interface SliderSpec {
  key: keyof ColorFixParams
  label: string
  /** 标签前的小色点（原型给每根滑杆一个语义色点） */
  dot: string
}

const SLIDERS: SliderSpec[] = [
  { key: 'hue', label: '色相', dot: '#c2543f' },
  { key: 'sat', label: '饱和度', dot: '#a855a0' },
  { key: 'light', label: '明度', dot: '#4a6fa5' },
  { key: 'bright', label: '亮度', dot: '#b78a3e' },
  { key: 'contrast', label: '对比度', dot: '#5f6673' },
]

const touched = computed(() => !colorFixIsZero(params.value) && JSON.stringify(params.value) !== JSON.stringify(COLORFIX_DEFAULT))

function clamp(key: keyof ColorFixParams, value: number) {
  const { min, max } = COLORFIX_RANGES[key]
  return Math.min(max, Math.max(min, Math.round(value)))
}
</script>

<template>
    <div
      :id="panelId"
      ref="rootRef"
      class="cfp sx-squircle fixed z-[6000] flex w-364px max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-13px border border-solid border-line bg-[radial-gradient(120%_90%_at_100%_0%,rgba(150,107,170,0.10),transparent_62%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(250,249,252,0.97))] shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32),0_4px_12px_rgba(31,35,41,0.1),inset_0_1px_0_#fff] backdrop-blur-[10px]"
      :style="positionStyle"
      role="dialog"
      aria-label="校色"
    >
      <!-- 标题栏：6 点拖动把手 + 标题 + 关闭 -->
      <div
        class="flex h-40px flex-none items-center gap-8px px-12px"
        style="cursor: grab; touch-action: none"
        @pointerdown="onDragStart"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
      >
        <span class="flex flex-none items-center gap-2px" aria-hidden="true">
          <i v-for="n in 6" :key="n" class="block h-3px w-3px rounded-full bg-#c9bfd1" />
        </span>
        <b class="flex-1 text-13px font-600 text-ink">校色</b>
        <IconButton label="关闭校色面板" variant="quiet" size="sm" @click="emit('done')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </IconButton>
      </div>

      <!-- 五根滑杆 -->
      <div class="flex flex-col gap-10px px-12px pb-6px">
        <div v-for="s in SLIDERS" :key="s.key">
          <div class="flex items-center gap-6px">
            <i class="h-12px w-12px flex-none rounded-full border border-solid border-white/70" :style="{ background: s.dot }" aria-hidden="true"></i>
            <label :for="`${panelId}-${s.key}`" class="text-11.5px font-500 text-ink-2">{{ s.label }}</label>
            <span
              class="ml-auto inline-flex h-18px min-w-30px items-center justify-center rounded-7px border border-solid px-5px text-11px font-600 tabular-nums"
              :class="
                params[s.key] === 0
                  ? 'border-transparent bg-transparent text-placeholder'
                  : 'border-violet-line bg-white text-violet-ink'
              "
              >{{ params[s.key] > 0 ? '+' : '' }}{{ params[s.key] }}</span
            >
          </div>
          <div class="relative mt-4px h-14px">
            <!-- 轨道：4px、零位刻度、紫渐变填充 -->
            <span class="absolute top-1/2 left-0 h-4px w-full -translate-y-1/2 rounded-full bg-#ece8ef shadow-[inset_0_1px_1px_rgba(31,35,41,0.08)]" aria-hidden="true"></span>
            <span class="absolute top-1/2 left-1/2 h-8px w-1px -translate-y-1/2 bg-#c9c1cf" aria-hidden="true"></span>
            <span
              class="absolute top-1/2 left-0 h-4px -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,#9a74ab,#83598f)]"
              :style="params[s.key] >= 0 ? { left: '50%', width: `${(params[s.key] / COLORFIX_RANGES[s.key].max) * 50}%` } : { right: '50%', width: `${(-params[s.key] / COLORFIX_RANGES[s.key].min) * 50}%` }"
              aria-hidden="true"
            ></span>
            <input
              :id="`${panelId}-${s.key}`"
              type="range"
              class="absolute inset-0 m-0 w-full cursor-pointer appearance-none bg-transparent p-0 outline-none [&::-webkit-slider-thumb]:h-14px [&::-webkit-slider-thumb]:w-14px [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-#83598f [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(31,35,41,0.2)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110 active:[&::-webkit-slider-thumb]:scale-112 [&::-moz-range-thumb]:h-10px [&::-moz-range-thumb]:w-10px [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-#83598f [&::-moz-range-thumb]:bg-white"
              :min="COLORFIX_RANGES[s.key].min"
              :max="COLORFIX_RANGES[s.key].max"
              :step="1"
              :value="params[s.key]"
              :aria-valuetext="`${s.label} ${params[s.key]}`"
              @input="params = { ...params, [s.key]: clamp(s.key, Number(($event.target as HTMLInputElement).value)) }"
            />
          </div>
        </div>
      </div>

      <!-- 底行 -->
      <div class="flex flex-none items-center gap-8px px-12px pb-10px pt-4px">
        <span class="min-w-0 flex-1 truncate text-11px leading-16px text-placeholder">校色即时生效，切换记录自动还原</span>
        <button
          type="button"
          class="h-32px shrink-0 rounded-14px border border-solid border-line bg-white px-12px text-13px text-ink-2 cursor-pointer [transition:border-color_110ms,background_110ms] hover:border-#c9cfd6 disabled:(opacity-45 cursor-not-allowed)"
          :disabled="!touched"
          @click="params = { ...COLORFIX_DEFAULT }"
        >
          恢复默认
        </button>
        <button
          type="button"
          class="h-32px shrink-0 rounded-14px border border-solid border-violet-border bg-[linear-gradient(180deg,#966baa,#83598f)] px-14px text-13px font-600 text-white cursor-pointer shadow-btn [transition:filter_110ms] hover:brightness-105"
          @click="emit('done')"
        >
          完成
        </button>
      </div>
    </div>
</template>
