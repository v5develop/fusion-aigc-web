<script setup lang="ts">
/**
 * 更多调整（2026-11-11，参数台里「替换颜色」与五个滑杆之间，折叠在「更多调整」下）：每层独立。
 *
 * <ul>
 *   <li>白平衡：色温（冷 ↔ 暖）/ 色调（绿 ↔ 洋红）两条滑杆 + 中性灰吸管（点一个本该是灰色的地方，自动算出让它变灰的
 *       色温 / 色调；吸管弹窗由调用方开，发 pickNeutral）；</li>
 *   <li>HSL 分色：8 个色带（红 / 橙 / 黄 / 绿 / 青 / 蓝 / 紫 / 洋红）选一个，调它的色相 / 饱和度 / 明度；色带之间在 OKLCH 色相上
 *       平滑过渡（utils/colorfix-math hslBandWeights）；「保护肤色」打开时肤色区域只受 20% 影响。</li>
 * </ul>
 * 生效顺序：替换颜色 → 白平衡 → HSL 分色 → 五个滑杆。数学在 colorfix-math（纯函数，有 node 校验）。
 * 折叠状态按浏览器记住（localStorage，读写失败不影响使用）。
 */
import { computed, ref } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import {
  COLORFIX_HSL_BANDS,
  COLORFIX_HSL_BAND_LABELS,
  COLORFIX_HSL_SWATCHES,
  adjustIsZero,
  adjustZero,
  type ColorFixAdjust,
  type ColorFixHslShift,
} from '@/utils/colorfix-math.ts'

const { docked = false } = defineProps<{ docked?: boolean }>()
const adjust = defineModel<ColorFixAdjust | null>({ default: null })
const emit = defineEmits<{ pickNeutral: [] }>()

const OPEN_KEY = 'colorfix:adjust-open'
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}
const open = ref(readOpen())
const bodyId = `cfa-${Math.random().toString(36).slice(2, 9)}`
function toggle() {
  open.value = !open.value
  try {
    localStorage.setItem(OPEN_KEY, open.value ? '1' : '0')
  } catch {
    /* 隐私模式：只是记不住折叠状态 */
  }
}

const cur = computed<ColorFixAdjust>(() => adjust.value ?? adjustZero())
const band = ref(0)
const bandShift = computed<ColorFixHslShift>(() => cur.value.hsl[band.value] ?? { h: 0, s: 0, l: 0 })
const bandTouched = (i: number) => {
  const b = cur.value.hsl[i]
  return !!b && (b.h !== 0 || b.s !== 0 || b.l !== 0)
}

function write(next: ColorFixAdjust) {
  // 全零且没开保护肤色 = 没调（存 null，与老数据一致）
  adjust.value = adjustIsZero(next) && !next.skin ? null : next
}
function setWb(k: 'temp' | 'tint', v: number) {
  write({ ...cur.value, hsl: cur.value.hsl.map((b) => ({ ...b })), [k]: v })
}
function setBand(k: keyof ColorFixHslShift, v: number) {
  write({
    ...cur.value,
    hsl: cur.value.hsl.map((b, i) => (i === band.value ? { ...b, [k]: v } : { ...b })),
  })
}
function setSkin(v: boolean) {
  write({ ...cur.value, hsl: cur.value.hsl.map((b) => ({ ...b })), skin: v })
}
function resetAll() {
  adjust.value = null
}
function resetBand() {
  write({ ...cur.value, hsl: cur.value.hsl.map((b, i) => (i === band.value ? { h: 0, s: 0, l: 0 } : { ...b })) })
}

const summary = computed(() => {
  const a = adjust.value
  if (!a || adjustIsZero(a)) return '白平衡 · HSL 分色'
  const bits: string[] = []
  if (a.temp || a.tint) bits.push(`色温 ${signed(a.temp)} · 色调 ${signed(a.tint)}`)
  const n = a.hsl.filter((b) => b.h || b.s || b.l).length
  if (n) bits.push(`HSL ${n} 色`)
  return bits.join(' · ')
})
const active = computed(() => !!adjust.value && !adjustIsZero(adjust.value))

function signed(v: number) {
  return `${v > 0 ? '+' : ''}${v}`
}
function num(e: Event) {
  return Math.round(Number((e.target as HTMLInputElement).value))
}

/** 色带色相滑杆的轨道：往左偏向上一个色带、往右偏向下一个色带 */
const hueTrack = computed(() => {
  const n = COLORFIX_HSL_BANDS.length
  const sw = (i: number) => COLORFIX_HSL_SWATCHES[COLORFIX_HSL_BANDS[(i + n) % n]!]
  return `linear-gradient(90deg, ${sw(band.value - 1)}, ${sw(band.value)}, ${sw(band.value + 1)})`
})
const satTrack = computed(() => `linear-gradient(90deg, #a3a3a3, ${COLORFIX_HSL_SWATCHES[COLORFIX_HSL_BANDS[band.value]!]})`)
const lightTrack = computed(
  () => `linear-gradient(90deg, #1f2329, ${COLORFIX_HSL_SWATCHES[COLORFIX_HSL_BANDS[band.value]!]}, #ffffff)`,
)

/** 色带单选：← / → 切换（radiogroup 键盘约定） */
function onBandKey(e: KeyboardEvent) {
  const n = COLORFIX_HSL_BANDS.length
  let next = band.value
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (band.value + 1) % n
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (band.value - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  else return
  e.preventDefault()
  e.stopPropagation()
  band.value = next
  const btns = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="radio"]')
  btns[next]?.focus()
}
</script>

<template>
  <div class="cfa" :class="{ 'is-docked': docked }" role="group" aria-label="更多调整">
    <div class="cfa__head">
      <button
        type="button"
        class="cfa__toggle sx-hit"
        :aria-expanded="open"
        :aria-controls="bodyId"
        @click="toggle"
      >
        <svg class="cfa__chev" :class="{ 'is-open': open }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
        更多调整
      </button>
      <span class="cfa__summary" :class="{ 'is-on': active }">{{ summary }}</span>
      <button v-if="active" type="button" class="cfa__btn sx-hit" title="白平衡与 HSL 分色全部归零" @click="resetAll">重置</button>
    </div>

    <div v-if="open" :id="bodyId" class="cfa__body">
      <div class="cfa__sec">
        <span class="cfa__sec-title">白平衡</span>
        <IconButton label="中性灰吸管：点图上本该是灰色 / 白色的地方，自动校正色温与色调" size="sm" variant="quiet" @click="emit('pickNeutral')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m2 22 1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
          </svg>
        </IconButton>
      </div>
      <label class="cfa__row">
        <span class="cfa__label">色温</span>
        <input
          class="cfa__range"
          type="range"
          min="-100"
          max="100"
          step="1"
          :value="cur.temp"
          style="--track: linear-gradient(90deg, #4f7fd9, #e9e6df, #e2b23c)"
          aria-label="色温：向左偏冷（蓝），向右偏暖（黄）"
          :aria-valuetext="`色温 ${signed(cur.temp)}`"
          @input="setWb('temp', num($event))"
          @dblclick="setWb('temp', 0)"
        />
        <b class="cfa__num" :class="{ 'is-zero': !cur.temp }">{{ signed(cur.temp) }}</b>
      </label>
      <label class="cfa__row">
        <span class="cfa__label">色调</span>
        <input
          class="cfa__range"
          type="range"
          min="-100"
          max="100"
          step="1"
          :value="cur.tint"
          style="--track: linear-gradient(90deg, #4fae62, #e9e6df, #c955b5)"
          aria-label="色调：向左偏绿，向右偏洋红"
          :aria-valuetext="`色调 ${signed(cur.tint)}`"
          @input="setWb('tint', num($event))"
          @dblclick="setWb('tint', 0)"
        />
        <b class="cfa__num" :class="{ 'is-zero': !cur.tint }">{{ signed(cur.tint) }}</b>
      </label>

      <div class="cfa__sec">
        <span class="cfa__sec-title">HSL 分色</span>
        <span class="cfa__spacer" />
        <button
          type="button"
          role="switch"
          class="cfa__switch sx-hit"
          :class="{ 'is-on': cur.skin }"
          :aria-checked="cur.skin"
          aria-label="保护肤色：调整分色时肤色区域只受很小影响"
          title="保护肤色：调整分色时肤色区域只受很小影响"
          @click="setSkin(!cur.skin)"
        >
          <i aria-hidden="true" />
        </button>
        <span class="cfa__soft" aria-hidden="true">保护肤色</span>
      </div>
      <div class="cfa__bands" role="radiogroup" aria-label="色带" @keydown="onBandKey">
        <button
          v-for="(b, i) in COLORFIX_HSL_BANDS"
          :key="b"
          type="button"
          role="radio"
          class="cfa__band sx-hit"
          :class="{ 'is-on': band === i }"
          :aria-checked="band === i"
          :tabindex="band === i ? 0 : -1"
          :aria-label="`${COLORFIX_HSL_BAND_LABELS[b]}${bandTouched(i) ? '（已调整）' : ''}`"
          :title="COLORFIX_HSL_BAND_LABELS[b]"
          @click="band = i"
        >
          <span class="cfa__band-dot" :style="{ background: COLORFIX_HSL_SWATCHES[b] }" aria-hidden="true" />
          <i v-if="bandTouched(i)" class="cfa__band-mark" aria-hidden="true" />
        </button>
      </div>
      <label class="cfa__row">
        <span class="cfa__label">色相</span>
        <input
          class="cfa__range"
          type="range"
          min="-100"
          max="100"
          step="1"
          :value="bandShift.h"
          :style="{ '--track': hueTrack }"
          :aria-label="`${COLORFIX_HSL_BAND_LABELS[COLORFIX_HSL_BANDS[band]!]}的色相`"
          :aria-valuetext="`色相 ${signed(bandShift.h)}`"
          @input="setBand('h', num($event))"
          @dblclick="setBand('h', 0)"
        />
        <b class="cfa__num" :class="{ 'is-zero': !bandShift.h }">{{ signed(bandShift.h) }}</b>
      </label>
      <label class="cfa__row">
        <span class="cfa__label">饱和度</span>
        <input
          class="cfa__range"
          type="range"
          min="-100"
          max="100"
          step="1"
          :value="bandShift.s"
          :style="{ '--track': satTrack }"
          :aria-label="`${COLORFIX_HSL_BAND_LABELS[COLORFIX_HSL_BANDS[band]!]}的饱和度`"
          :aria-valuetext="`饱和度 ${signed(bandShift.s)}`"
          @input="setBand('s', num($event))"
          @dblclick="setBand('s', 0)"
        />
        <b class="cfa__num" :class="{ 'is-zero': !bandShift.s }">{{ signed(bandShift.s) }}</b>
      </label>
      <label class="cfa__row">
        <span class="cfa__label">明度</span>
        <input
          class="cfa__range"
          type="range"
          min="-100"
          max="100"
          step="1"
          :value="bandShift.l"
          :style="{ '--track': lightTrack }"
          :aria-label="`${COLORFIX_HSL_BAND_LABELS[COLORFIX_HSL_BANDS[band]!]}的明度`"
          :aria-valuetext="`明度 ${signed(bandShift.l)}`"
          @input="setBand('l', num($event))"
          @dblclick="setBand('l', 0)"
        />
        <b class="cfa__num" :class="{ 'is-zero': !bandShift.l }">{{ signed(bandShift.l) }}</b>
      </label>
      <div v-if="bandTouched(band)" class="cfa__row cfa__row--end">
        <button type="button" class="cfa__btn sx-hit" @click="resetBand">
          重置「{{ COLORFIX_HSL_BAND_LABELS[COLORFIX_HSL_BANDS[band]!] }}」
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.cfa {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 12px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--xq-violet-soft-2);
  cursor: default;
}
.cfa.is-docked {
  margin: 0 16px;
}
.cfa__head {
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 8px;
}
.cfa__toggle {
  display: inline-flex;
  height: 28px;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 0 6px 0 2px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--xq-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cfa__toggle:hover {
  background: var(--xq-info-soft);
}
.cfa__chev {
  width: 14px;
  height: 14px;
  color: var(--xq-muted);
  transition: transform 0.14s ease;
}
.cfa__chev.is-open {
  transform: rotate(90deg);
}
.cfa__summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--xq-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfa__summary.is-on {
  color: var(--xq-violet-ink);
  font-weight: 600;
}
.cfa__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cfa__sec {
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.cfa__sec-title {
  color: var(--xq-ink-2);
  font-size: 11.5px;
  font-weight: 600;
}
.cfa__spacer {
  flex: 1;
}
.cfa__row {
  display: flex;
  min-height: 26px;
  align-items: center;
  gap: 8px;
}
.cfa__row--end {
  justify-content: flex-end;
}
.cfa__label {
  width: 40px;
  flex: 0 0 40px;
  color: var(--xq-ink-2);
  font-size: 11.5px;
}
.cfa__num {
  width: 32px;
  flex: none;
  color: var(--xq-violet-ink);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.cfa__num.is-zero {
  color: var(--xq-muted);
  font-weight: 500;
}
.cfa__soft {
  color: var(--xq-muted);
  font-size: 11.5px;
}
/* 渐变轨道滑杆：轨道 6px（可点高 22），手柄 14 白底藤紫描边 */
.cfa__range {
  height: 22px;
  min-width: 0;
  flex: 1;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.cfa__range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: var(--track, var(--xq-line));
  box-shadow: inset 0 0 0 1px rgba(31, 35, 41, 0.08);
}
.cfa__range::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--track, var(--xq-line));
}
.cfa__range::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -4px;
  border: 2px solid var(--xq-violet);
  border-radius: 50%;
  background: var(--xq-surface);
  box-shadow: 0 1px 3px rgba(31, 35, 41, 0.25);
  -webkit-appearance: none;
}
.cfa__range::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid var(--xq-violet);
  border-radius: 50%;
  background: var(--xq-surface);
}
.cfa__range:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
  border-radius: 4px;
}
.cfa__bands {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-left: 48px;
}
.cfa__band {
  position: relative;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--xq-line);
  border-radius: 8px;
  background: var(--xq-surface);
  cursor: pointer;
}
.cfa__band.is-on {
  border-color: var(--xq-violet);
  box-shadow: 0 0 0 2px rgba(135, 95, 154, 0.22);
}
.cfa__band-dot {
  width: 14px;
  height: 14px;
  border: 1px solid rgb(var(--xq-ink-rgb) / 0.12);
  border-radius: 50%;
}
.cfa__band-mark {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--xq-surface);
  border-radius: 50%;
  background: var(--xq-violet);
}
.cfa__band:focus-visible,
.cfa__toggle:focus-visible,
.cfa__btn:focus-visible,
.cfa__switch:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
}
.cfa__switch {
  position: relative;
  width: 30px;
  height: 18px;
  flex: 0 0 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: var(--xq-line-strong);
  cursor: pointer;
  transition: background 0.12s ease;
}
.cfa__switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--xq-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.12s ease;
}
.cfa__switch.is-on {
  background: var(--xq-violet);
}
.cfa__switch.is-on i {
  transform: translateX(12px);
}
.cfa__btn {
  height: 24px;
  flex: none;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--xq-line);
  border-radius: 12px;
  background: linear-gradient(var(--xq-surface), var(--xq-surface2));
  color: var(--xq-ink-2);
  font: inherit;
  font-size: 11px;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
}
.cfa__btn:hover {
  border-color: var(--xq-control);
}
@media (prefers-reduced-motion: reduce) {
  .cfa__chev,
  .cfa__switch,
  .cfa__switch i {
    transition: none;
  }
}
</style>
