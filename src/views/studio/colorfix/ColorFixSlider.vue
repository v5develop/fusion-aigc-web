<script setup lang="ts">
/**
 * 校色参数滑杆（原型 components/tool/ColorFixSlider.vue）：以 0 为中心的「双向填充」——负值从零位往左，正值往右。
 *
 * <p>零位按区间算 zeroPct = (0 − min) / (max − min)：饱和度 −60..70 这类不对称区间的零位不在正中，
 * 填充从零位起算（旧版按 50% 起算，正负两侧比例不一致）。原生 range 负责键盘与拖动，轨道 / 填充 / 手柄自己画。
 * 数值：行距 5、标签 11.5/500、12px 渐变色点（1px rgba(31,35,41,.1) + 内高光）、数值芯片 18 高 r7、轨道 18 高（可视 4px）。
 */
import { computed, nextTick, ref } from 'vue'
import { shiftStepOf } from '@/components/ColorFix/fine-adjust.ts'

const props = withDefaults(
  defineProps<{
    label: string
    min: number
    max: number
    step?: number
    /** 参数的小色点：hue / sat / light / bright / contrast */
    tone: 'hue' | 'sat' | 'light' | 'bright' | 'contrast'
    /** 可选精调（默认关，只有分页面板打开）：Shift+方向键 ±shiftStepOf；点数值变成小输入框，回车 / 失焦提交、Esc 取消 */
    editable?: boolean
    /** 显式覆盖 Shift 步长（默认按区间跨度：< 100 → 5，≥ 100 → 10） */
    shiftStep?: number
  }>(),
  { step: 1, editable: false },
)

const value = defineModel<number>({ required: true })

const span = computed(() => props.max - props.min || 1)
const pct = computed(() => ((value.value - props.min) / span.value) * 100)
const zeroPct = computed(() => ((0 - props.min) / span.value) * 100)
const fillStyle = computed(() => ({
  left: `${Math.min(zeroPct.value, pct.value)}%`,
  width: `${Math.abs(pct.value - zeroPct.value)}%`,
}))
const signed = computed(() => `${value.value > 0 ? '+' : ''}${value.value}`)

const DOT: Record<string, string> = {
  hue: 'conic-gradient(from -90deg, #e65b5b, #e6c95b, #6fbf73, #5bb6c9, #6b6fd6, #b25bbf, #e65b5b)',
  sat: 'linear-gradient(90deg, #cbc5d1, #875f9a)',
  light: 'linear-gradient(135deg, #ffffff, #cfc7d6)',
  bright: 'linear-gradient(135deg, #f7ecd4, #eaa94d)',
  contrast: 'linear-gradient(135deg, #1f2329, #ffffff)',
}

function clamp(n: number) {
  return Math.min(props.max, Math.max(props.min, Math.round(n)))
}

function onKeydown(event: KeyboardEvent) {
  if (!props.editable || !event.shiftKey) return
  const dir = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
  if (!dir) return
  event.preventDefault()
  value.value = clamp(value.value + dir * (props.shiftStep ?? shiftStepOf(props.min, props.max)))
}

const editing = ref(false)
const draft = ref('')
const editEl = ref<HTMLInputElement | null>(null)

async function startEdit() {
  draft.value = String(value.value)
  editing.value = true
  await nextTick()
  editEl.value?.focus()
  editEl.value?.select()
}

function commitEdit() {
  if (!editing.value) return
  editing.value = false
  const text = draft.value.trim()
  const n = Number(text)
  if (text !== '' && Number.isFinite(n)) value.value = clamp(n)
}

function cancelEdit() {
  editing.value = false
}

function onInput(event: Event) {
  const n = Number((event.target as HTMLInputElement).value)
  value.value = Math.min(props.max, Math.max(props.min, Math.round(n)))
}
</script>

<template>
  <div class="cfs">
    <div class="cfs__head">
      <span class="cfs__dot" :style="{ background: DOT[tone] }" aria-hidden="true" />
      <span class="cfs__label">{{ label }}</span>
      <input
        v-if="editable && editing"
        ref="editEl"
        v-model="draft"
        class="cfs__edit"
        type="text"
        inputmode="numeric"
        :aria-label="`${label}（${min} 到 ${max}）`"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent.stop="cancelEdit"
        @blur="commitEdit"
      />
      <button
        v-else-if="editable"
        type="button"
        class="cfs__value cfs__value--btn"
        :class="{ 'is-zero': value === 0 }"
        :title="`点击输入数值（${min} 到 ${max}）`"
        @click="startEdit"
      >
        {{ signed }}
      </button>
      <b v-else class="cfs__value" :class="{ 'is-zero': value === 0 }" aria-hidden="true">{{ signed }}</b>
    </div>
    <div class="cfs__track">
      <span class="cfs__zero" :style="{ left: `${zeroPct}%` }" aria-hidden="true" />
      <span class="cfs__fill" :style="fillStyle" aria-hidden="true" />
      <input
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="value"
        :aria-label="label"
        :aria-valuetext="`${label} ${signed}`"
        @input="onInput"
        @keydown="onKeydown"
      />
    </div>
  </div>
</template>

<style scoped lang="less">
/* range 的伪元素（轨道 / 手柄）无法用原子类表达，按原型数值落 scoped 样式 */
.cfs {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cfs__head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.cfs__dot {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  box-sizing: border-box;
  border: 1px solid rgb(var(--xq-ink-rgb) / 0.1);
  border-radius: 50%;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.cfs__label {
  color: var(--xq-ink);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 16px;
}
.cfs__value {
  min-width: 30px;
  box-sizing: border-box;
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--xq-line);
  border-radius: 7px;
  background: var(--xq-surface);
  color: var(--xq-violet-ink);
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  text-align: center;
}
/* 精调模式下数值是按钮 / 输入框：压在 range 外扩的触控区之上，保证点得到 */
.cfs__value--btn {
  position: relative;
  z-index: 1;
  font-family: inherit;
  cursor: text;
}
.cfs__value--btn:hover {
  border-color: var(--xq-violet);
}
.cfs__value--btn:focus-visible,
.cfs__edit:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 1px;
}
.cfs__edit {
  position: relative;
  z-index: 1;
  width: 44px;
  box-sizing: border-box;
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--xq-violet);
  border-radius: 7px;
  background: var(--xq-surface);
  color: var(--xq-ink);
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
}
.cfs__value.is-zero {
  border-color: transparent;
  background: transparent;
  color: var(--xq-placeholder);
  font-weight: 500;
}
.cfs__track {
  position: relative;
  height: 18px;
}
.cfs__track::before {
  content: '';
  position: absolute;
  top: 7px;
  right: 0;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: var(--xq-line);
  box-shadow: inset 0 1px 1px rgba(31, 35, 41, 0.05);
}
.cfs__zero {
  position: absolute;
  top: 4px;
  width: 1px;
  height: 10px;
  transform: translateX(-0.5px);
  background: var(--xq-control);
}
.cfs__fill {
  position: absolute;
  top: 7px;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--xq-violet-top), var(--xq-violet-bottom));
}
/* 可点区域：视觉轨道 18 高，range 本体撑到 32 高、上下各外扩 7px（绝对定位 + 负偏移，不改版面） */
.cfs input[type='range'] {
  position: absolute;
  top: -7px;
  right: 0;
  left: 0;
  width: 100%;
  height: 32px;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}
.cfs input[type='range']::-webkit-slider-runnable-track {
  height: 32px;
  background: transparent;
}
.cfs input[type='range']::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  margin-top: 9px;
  appearance: none;
  -webkit-appearance: none;
  border: 2px solid var(--xq-violet);
  border-radius: 50%;
  background: var(--xq-surface);
  box-shadow: 0 1px 3px rgba(31, 35, 41, 0.22);
  transition: transform 0.12s ease;
}
.cfs input[type='range']:active::-webkit-slider-thumb {
  transform: scale(1.12);
}
.cfs input[type='range']:focus-visible {
  outline: none;
}
.cfs input[type='range']:focus-visible::-webkit-slider-thumb {
  box-shadow:
    0 0 0 3px rgba(131, 89, 143, 0.18),
    0 1px 3px rgba(31, 35, 41, 0.22);
}
.cfs input[type='range']::-moz-range-track {
  height: 32px;
  background: transparent;
}
.cfs input[type='range']::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid var(--xq-violet);
  border-radius: 50%;
  background: var(--xq-surface);
  box-shadow: 0 1px 3px rgba(31, 35, 41, 0.22);
}
.cfs input[type='range']:focus-visible::-moz-range-thumb {
  box-shadow:
    0 0 0 3px rgba(131, 89, 143, 0.18),
    0 1px 3px rgba(31, 35, 41, 0.22);
}
@media (prefers-reduced-motion: reduce) {
  .cfs input[type='range']::-webkit-slider-thumb {
    transition: none;
  }
}
/* 深色：轨道沉进底面一档、零位刻线换成描边色（浅色原值保持）；scoped 只作用在最后一段，祖先 [data-theme] 照常匹配 */
[data-theme='dark'] .cfs__track::before {
  background: var(--xq-sunken);
}
[data-theme='dark'] .cfs__zero {
  background: var(--xq-line-strong);
}
</style>
