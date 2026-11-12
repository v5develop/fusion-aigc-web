<script setup lang="ts">
/**
 * 色阶 + 曲线（2026-11-11，放在「更多调整」里 HSL 分色之后）：每层独立，生效顺序 白平衡 → HSL → 色阶 → 曲线 → 五个滑杆。
 *
 * <ul>
 *   <li>色阶：输入黑场 / 中间调（gamma，对数刻度）/ 输入白场、输出黑场 / 白场五条滑杆；上方是原图（选区内）亮度直方图，
 *       竖线标出输入黑 / 白场；「自动」按直方图两端各 0.5% 定黑白场；</li>
 *   <li>曲线：RGB 主曲线 + 红 / 绿 / 蓝分通道（先主曲线再分通道），每条最多 8 个控制点（含两端），单调三次插值；
 *       底图是对应通道的直方图。鼠标：空白处单击加点、拖动移点、双击删点（两端不能删）；键盘：Tab / Shift+Tab 在控制点间循环，方向键移动
 *       1（Shift ×10）、Delete 删点、Esc 回到曲线；也可在下方输入框精确改选中点的输入 / 输出。</li>
 * </ul>
 * 数学在 utils/colorfix-math（monotoneCurve / levelsMap / buildToneLuts，有 node 校验）；这里只做编辑。
 */
import { computed, nextTick, ref } from 'vue'
import { vCfFine, vCfValueEdit } from './fine-adjust.ts'
import {
  COLORFIX_CURVE_CHANNELS,
  COLORFIX_CURVE_LABELS,
  COLORFIX_LEVELS_IDENTITY,
  CURVE_MAX_POINTS,
  CURVE_MIN_GAP,
  LEVELS_GAMMA_MAX,
  LEVELS_GAMMA_MIN,
  cloneCurves,
  curveIdentity,
  curveIsIdentity,
  curvesIdentity,
  levelsIsIdentity,
  monotoneCurve,
  type ColorFixCurveChannel,
  type ColorFixCurves,
  type ColorFixHistogram,
  type ColorFixLevels,
  type CurvePoint,
} from '@/utils/colorfix-math.ts'

const { histogram = null } = defineProps<{
  /** 原图（选区内）直方图；null = 还没算出 / 读不了像素（不画底图） */
  histogram?: ColorFixHistogram | null
}>()
const levels = defineModel<ColorFixLevels | null>('levels', { default: null })
const curves = defineModel<ColorFixCurves | null>('curves', { default: null })

const uid = `cft-${Math.random().toString(36).slice(2, 9)}`

// ---------------- 直方图 ----------------

/** 直方图 → SVG 面积路径（viewBox 0 0 256 H；按第 99.5 百分位归一，免得纯白 / 纯黑底的尖峰把其余压扁） */
function histPath(bins: Uint32Array | undefined, height: number): string {
  if (!bins) return ''
  const sorted = Array.from(bins).sort((a, b) => a - b)
  const cap = Math.max(1, sorted[Math.floor(sorted.length * 0.995)] ?? 1)
  let d = `M0 ${height}`
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, bins[i]! / cap)
    d += ` L${i} ${(height - v * height).toFixed(1)} L${i + 1} ${(height - v * height).toFixed(1)}`
  }
  return `${d} L256 ${height} Z`
}
const hasHist = computed(() => !!histogram && histogram.count > 0)

// ---------------- 色阶 ----------------

const lv = computed<ColorFixLevels>(() => levels.value ?? { ...COLORFIX_LEVELS_IDENTITY })
const levelsOn = computed(() => !levelsIsIdentity(levels.value))
function setLevels(patch: Partial<ColorFixLevels>) {
  const next = { ...lv.value, ...patch }
  if (next.inWhite < next.inBlack + 2) {
    if ('inBlack' in patch) next.inBlack = next.inWhite - 2
    else next.inWhite = next.inBlack + 2
  }
  levels.value = levelsIsIdentity(next) ? null : next
}
/** 中间调滑杆：-100…100 ↔ gamma 0.1…10（对数刻度，0 = 1.00） */
const gammaPos = computed(() => Math.round(Math.log10(lv.value.gamma) * 100))
function setGammaPos(pos: number) {
  setLevels({ gamma: clampGamma(Math.pow(10, pos / 100)) })
}
function clampGamma(g: number): number {
  return Math.round(Math.min(LEVELS_GAMMA_MAX, Math.max(LEVELS_GAMMA_MIN, g)) * 100) / 100
}
/** 中间调键盘：方向键 ±0.01，Shift ±0.10（直接在 gamma 上加减，再取两位小数；滑杆位置由 gammaPos 反推，两者始终一致） */
function onGammaKey(e: KeyboardEvent) {
  const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
  if (!dir) return
  e.preventDefault()
  e.stopPropagation()
  const next = clampGamma(lv.value.gamma + dir * (e.shiftKey ? 0.1 : 0.01))
  if (next !== lv.value.gamma) setLevels({ gamma: next })
}
/** 点数值行内编辑中间调（0.10–9.99，两位小数；回车 / 失焦提交，Esc 取消，非数字忽略） */
const gammaEditing = ref(false)
const gammaDraft = ref('')
const gammaBox = ref<HTMLInputElement | null>(null)
let gammaCancelled = false
function startGammaEdit(e: Event) {
  e.preventDefault() // 值在 <label> 里，别让点击把焦点转给滑杆
  gammaCancelled = false
  gammaDraft.value = lv.value.gamma.toFixed(2)
  gammaEditing.value = true
  void nextTick(() => {
    gammaBox.value?.focus()
    gammaBox.value?.select()
  })
}
function finishGammaEdit(commit: boolean) {
  if (!gammaEditing.value) return
  gammaEditing.value = false
  if (!commit || gammaCancelled) return
  const text = gammaDraft.value.trim()
  const n = Number(text)
  if (text === '' || !Number.isFinite(n)) return
  const g = clampGamma(n)
  if (g !== lv.value.gamma) setLevels({ gamma: g })
}
function onGammaBoxKey(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    finishGammaEdit(true)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    gammaCancelled = true
    finishGammaEdit(false)
  }
}
const levelsHist = computed(() => (hasHist.value ? histPath(histogram!.l, 48) : ''))
/** 自动：亮度直方图两端各裁 0.5% */
function autoLevels() {
  const h = histogram
  if (!h || !h.count) return
  const cut = h.count * 0.005
  let acc = 0
  let lo = 0
  for (; lo < 255; lo++) {
    acc += h.l[lo]!
    if (acc > cut) break
  }
  acc = 0
  let hi = 255
  for (; hi > 0; hi--) {
    acc += h.l[hi]!
    if (acc > cut) break
  }
  if (hi - lo < 8) return
  setLevels({ inBlack: Math.min(253, lo), inWhite: Math.max(lo + 2, hi), gamma: 1 })
}

// ---------------- 曲线 ----------------

const channel = ref<ColorFixCurveChannel>('rgb')
const cur = computed<ColorFixCurves>(() => curves.value ?? curvesIdentity())
const points = computed<CurvePoint[]>(() => cur.value[channel.value])
const curvesOn = computed(() => !!curves.value && COLORFIX_CURVE_CHANNELS.some((c) => !curveIsIdentity(curves.value![c])))
const channelTouched = (c: ColorFixCurveChannel) => !!curves.value && !curveIsIdentity(curves.value[c])
const selIndex = ref(-1)
const sel = computed(() => (selIndex.value >= 0 ? points.value[selIndex.value] : undefined))

const CHANNEL_COLORS: Record<ColorFixCurveChannel, string> = {
  rgb: 'var(--xq-ink)',
  r: '#d9413b',
  g: '#3fa356',
  b: '#3467d6',
}

function writePoints(pts: CurvePoint[]) {
  const next = cloneCurves(cur.value)
  next[channel.value] = pts
  curves.value = COLORFIX_CURVE_CHANNELS.every((c) => curveIsIdentity(next[c])) ? null : next
}

/** 曲线路径（viewBox 0 0 256 256，y 向下） */
function curvePath(pts: readonly CurvePoint[]): string {
  const f = monotoneCurve(pts)
  let d = ''
  for (let x = 0; x <= 256; x += 4) {
    const xx = Math.min(255, x)
    d += `${d ? ' L' : 'M'}${xx} ${(255 - f(xx)).toFixed(2)}`
  }
  return d
}
const mainPath = computed(() => curvePath(points.value))
const ghostPaths = computed(() =>
  COLORFIX_CURVE_CHANNELS.filter((c) => c !== channel.value && channelTouched(c)).map((c) => ({
    c,
    d: curvePath(cur.value[c]),
  })),
)
const curveHist = computed(() => {
  if (!hasHist.value) return ''
  const h = histogram!
  const bins = channel.value === 'rgb' ? h.l : h[channel.value]
  return histPath(bins, 256)
})

/** 把点 i 挪到 (x, y)，夹在相邻点之间（保持 {@link CURVE_MIN_GAP} 间距）与 0–255 */
function movePoint(i: number, x: number, y: number) {
  const pts = points.value.map((p) => [p[0], p[1]] as CurvePoint)
  const lo = i > 0 ? pts[i - 1]![0] + CURVE_MIN_GAP : 0
  const hi = i < pts.length - 1 ? pts[i + 1]![0] - CURVE_MIN_GAP : 255
  pts[i] = [Math.round(Math.min(hi, Math.max(lo, x))), Math.round(Math.min(255, Math.max(0, y)))]
  writePoints(pts)
}
function removePoint(i: number) {
  const pts = points.value
  if (i <= 0 || i >= pts.length - 1) return
  writePoints(pts.filter((_, k) => k !== i))
  selIndex.value = Math.min(i, pts.length - 2) - 1
}
/** 在输入 x 处加一个点（落在曲线上）；满了 / 离已有点太近返回 -1 */
function addPointAt(x: number, y?: number): number {
  const pts = points.value
  if (pts.length >= CURVE_MAX_POINTS) return -1
  const xi = Math.round(Math.min(255, Math.max(0, x)))
  if (pts.some((p) => Math.abs(p[0] - xi) < CURVE_MIN_GAP)) return -1
  const yi = Math.round(y ?? monotoneCurve(pts)(xi))
  const next = [...pts.map((p) => [p[0], p[1]] as CurvePoint), [xi, Math.min(255, Math.max(0, yi))] as CurvePoint].sort(
    (a, b) => a[0] - b[0],
  )
  writePoints(next)
  return next.findIndex((p) => p[0] === xi)
}
/** 「添加控制点」按钮：加在最宽的空档正中 */
function addPointButton() {
  const pts = points.value
  let best = 0
  for (let i = 1; i < pts.length - 1; i++) if (pts[i + 1]![0] - pts[i]![0] > pts[best + 1]![0] - pts[best]![0]) best = i
  const at = addPointAt((pts[best]![0] + pts[best + 1]![0]) / 2)
  if (at >= 0) focusPoint(at)
}
function resetCurve() {
  writePoints(curveIdentity())
  selIndex.value = -1
}
const canAdd = computed(() => points.value.length < CURVE_MAX_POINTS)

// --- 指针 ---

const svgEl = ref<SVGSVGElement | null>(null)
let dragging = -1
function toCurve(e: PointerEvent): [number, number] {
  // viewBox 四周各留 6 个单位给控制点圆圈
  const r = svgEl.value!.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * 268 - 6
  const y = ((e.clientY - r.top) / r.height) * 268 - 6
  return [x, 255 - y]
}
function onPointDown(e: PointerEvent, i: number) {
  e.preventDefault()
  e.stopPropagation()
  selIndex.value = i
  dragging = i
  svgEl.value?.setPointerCapture?.(e.pointerId)
  ;(e.currentTarget as SVGElement).focus?.()
}
function onSvgDown(e: PointerEvent) {
  if (e.button !== 0) return
  const [x, y] = toCurve(e)
  // 点在曲线附近才加点（离曲线 > 24 级当作误点）
  const f = monotoneCurve(points.value)
  if (Math.abs(f(x) - y) > 24) return
  const at = addPointAt(x)
  if (at < 0) return
  selIndex.value = at
  dragging = at
  svgEl.value?.setPointerCapture?.(e.pointerId)
}
function onSvgMove(e: PointerEvent) {
  if (dragging < 0) return
  const [x, y] = toCurve(e)
  movePoint(dragging, x, y)
}
function onSvgUp(e: PointerEvent) {
  if (dragging < 0) return
  dragging = -1
  svgEl.value?.releasePointerCapture?.(e.pointerId)
}

// --- 键盘 ---

const pointEls = ref<(SVGCircleElement | null)[]>([])
function focusPoint(i: number) {
  selIndex.value = i
  requestAnimationFrame(() => pointEls.value[i]?.focus())
}
function onPointKey(e: KeyboardEvent, i: number) {
  const p = points.value[i]
  if (!p) return
  const step = e.shiftKey ? 10 : 1
  let handled = true
  if (e.key === 'Tab') {
    const n = points.value.length
    const next = (i + (e.shiftKey ? -1 : 1) + n) % n
    selIndex.value = next
    pointEls.value[next]?.focus()
  } else if (e.key === 'Escape') {
    if (selIndex.value < 0) return
    svgEl.value?.focus()
  } else if (e.key === 'ArrowLeft') movePoint(i, p[0] - step, p[1])
  else if (e.key === 'ArrowRight') movePoint(i, p[0] + step, p[1])
  else if (e.key === 'ArrowUp') movePoint(i, p[0], p[1] + step)
  else if (e.key === 'ArrowDown') movePoint(i, p[0], p[1] - step)
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (i > 0 && i < points.value.length - 1) {
      removePoint(i)
      focusPoint(Math.max(0, i - 1))
    }
  } else handled = false
  if (!handled) return
  e.preventDefault()
  e.stopPropagation()
}
/** 编辑器本体（SVG）有焦点、已选中某点时，方向键 / Delete 同样作用于选中点 */
function onSvgKey(e: KeyboardEvent) {
  if (e.target !== e.currentTarget || selIndex.value < 0 || e.key === 'Tab' || e.key === 'Escape') return
  onPointKey(e, selIndex.value)
}
function onChannelKey(e: KeyboardEvent) {
  const list = COLORFIX_CURVE_CHANNELS
  const at = list.indexOf(channel.value)
  let next = at
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % list.length
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + list.length) % list.length
  else return
  e.preventDefault()
  e.stopPropagation()
  pickChannel(list[next]!)
  const btns = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="radio"]')
  btns[next]?.focus()
}
function pickChannel(c: ColorFixCurveChannel) {
  channel.value = c
  selIndex.value = -1
}

function onFieldKey(e: KeyboardEvent) {
  if (e.key === 'Tab') return
  e.stopPropagation() // 输入框里的按键不触发画布 / 全局快捷键
  const el = e.target as HTMLInputElement
  if (e.key === 'Enter') {
    e.preventDefault()
    el.blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    const p = points.value[selIndex.value]
    if (p) el.value = String(el === xInput.value ? p[0] : p[1])
    el.blur()
  }
}
const xInput = ref<HTMLInputElement | null>(null)
function num(e: Event) {
  return Math.round(Number((e.target as HTMLInputElement).value))
}
function onSelInput(axis: 0 | 1, e: Event) {
  const i = selIndex.value
  const p = points.value[i]
  if (!p) return
  const el = e.target as HTMLInputElement
  const v = el.value.trim() === '' ? NaN : num(e)
  if (!Number.isFinite(v)) {
    el.value = String(p[axis])
    return
  }
  movePoint(i, axis === 0 ? v : p[0], axis === 1 ? v : p[1])
  el.value = String(points.value[i]?.[axis] ?? v) // 被夹住时把框里的值同步成实际值
}

const QUARTERS = [64, 128, 192]
</script>

<template>
  <div class="cft">
    <!-- 色阶 -->
    <div class="cft__sec">
      <span class="cft__title">色阶</span>
      <span class="cft__spacer" />
      <button type="button" class="cft__btn sx-hit" :disabled="!hasHist" :title="hasHist ? '按直方图两端各 0.5% 自动定黑白场' : '直方图还没算出'" @click="autoLevels">自动</button>
      <button v-if="levelsOn" type="button" class="cft__btn sx-hit" @click="levels = null">重置色阶</button>
    </div>
    <div class="cft__hist" aria-hidden="true">
      <svg viewBox="0 0 256 48" preserveAspectRatio="none">
        <path v-if="levelsHist" :d="levelsHist" class="cft__hist-area" />
        <line :x1="lv.inBlack" :x2="lv.inBlack" y1="0" y2="48" class="cft__mark" />
        <line :x1="lv.inWhite" :x2="lv.inWhite" y1="0" y2="48" class="cft__mark" />
      </svg>
      <span v-if="!hasHist" class="cft__hist-empty">直方图计算中…</span>
    </div>
    <label class="cft__row">
      <span class="cft__label">输入黑场</span>
      <input v-cf-fine class="cft__range" type="range" min="0" max="253" step="1" :value="lv.inBlack" style="--track: linear-gradient(90deg, #000, #888)" aria-label="色阶输入黑场：比它暗的都变成黑" @input="setLevels({ inBlack: num($event) })" @dblclick="setLevels({ inBlack: 0 })" />
      <b v-cf-value-edit class="cft__num" :class="{ 'is-zero': lv.inBlack === 0 }">{{ lv.inBlack }}</b>
    </label>
    <label class="cft__row">
      <span class="cft__label">中间调</span>
      <input class="cft__range" type="range" min="-100" max="100" step="1" :value="gammaPos" style="--track: linear-gradient(90deg, #333, #888, #ddd)" aria-label="色阶中间调：向右提亮中间调，向左压暗；方向键 ±0.01，Shift ±0.10，点右侧数值可直接输入" :aria-valuetext="`中间调 ${lv.gamma.toFixed(2)}`" @input="setGammaPos(num($event))" @keydown="onGammaKey" @dblclick="setLevels({ gamma: 1 })" />
      <input v-if="gammaEditing" ref="gammaBox" v-model="gammaDraft" class="cft__gbox" type="text" inputmode="decimal" aria-label="输入中间调数值（0.10 到 9.99）" @keydown="onGammaBoxKey" @blur="finishGammaEdit(true)" @click.stop />
      <b v-else class="cft__num cft__num--gamma" :class="{ 'is-zero': lv.gamma === 1 }" role="button" title="点击输入数值" @click="startGammaEdit">{{ lv.gamma.toFixed(2) }}</b>
    </label>
    <label class="cft__row">
      <span class="cft__label">输入白场</span>
      <input v-cf-fine class="cft__range" type="range" min="2" max="255" step="1" :value="lv.inWhite" style="--track: linear-gradient(90deg, #888, #fff)" aria-label="色阶输入白场：比它亮的都变成白" @input="setLevels({ inWhite: num($event) })" @dblclick="setLevels({ inWhite: 255 })" />
      <b v-cf-value-edit class="cft__num" :class="{ 'is-zero': lv.inWhite === 255 }">{{ lv.inWhite }}</b>
    </label>
    <label class="cft__row">
      <span class="cft__label">输出黑场</span>
      <input v-cf-fine class="cft__range" type="range" min="0" max="255" step="1" :value="lv.outBlack" style="--track: linear-gradient(90deg, #000, #fff)" aria-label="色阶输出黑场：最暗处提到这个亮度（褪色感）" @input="setLevels({ outBlack: num($event) })" @dblclick="setLevels({ outBlack: 0 })" />
      <b v-cf-value-edit class="cft__num" :class="{ 'is-zero': lv.outBlack === 0 }">{{ lv.outBlack }}</b>
    </label>
    <label class="cft__row">
      <span class="cft__label">输出白场</span>
      <input v-cf-fine class="cft__range" type="range" min="0" max="255" step="1" :value="lv.outWhite" style="--track: linear-gradient(90deg, #000, #fff)" aria-label="色阶输出白场：最亮处压到这个亮度" @input="setLevels({ outWhite: num($event) })" @dblclick="setLevels({ outWhite: 255 })" />
      <b v-cf-value-edit class="cft__num" :class="{ 'is-zero': lv.outWhite === 255 }">{{ lv.outWhite }}</b>
    </label>

    <!-- 曲线 -->
    <div class="cft__sec">
      <span class="cft__title">曲线</span>
      <span class="cft__spacer" />
      <div class="cft__chans" role="radiogroup" aria-label="曲线通道" @keydown="onChannelKey">
        <button
          v-for="c in COLORFIX_CURVE_CHANNELS"
          :key="c"
          type="button"
          role="radio"
          class="cft__chan sx-hit"
          :class="{ 'is-on': channel === c }"
          :aria-checked="channel === c"
          :tabindex="channel === c ? 0 : -1"
          :aria-label="`${COLORFIX_CURVE_LABELS[c]}${c === 'rgb' ? '主曲线' : '通道'}${channelTouched(c) ? '（已调整）' : ''}`"
          @click="pickChannel(c)"
        >
          <i class="cft__chan-dot" :style="{ background: CHANNEL_COLORS[c] }" aria-hidden="true" />
          {{ COLORFIX_CURVE_LABELS[c] }}
          <i v-if="channelTouched(c)" class="cft__chan-mark" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div class="cft__curve">
      <svg
        ref="svgEl"
        class="cft__svg"
        viewBox="-6 -6 268 268"
        role="group"
        tabindex="0"
        :aria-label="`${COLORFIX_CURVE_LABELS[channel]}曲线：Tab / Shift+Tab 切换控制点，方向键移动 1（Shift 移动 10），Delete 删除，Esc 回到曲线；空白处单击曲线加点，双击控制点删除`"
        @keydown="onSvgKey"
        @pointerdown="onSvgDown"
        @pointermove="onSvgMove"
        @pointerup="onSvgUp"
        @pointercancel="onSvgUp"
      >
        <rect x="0" y="0" width="256" height="256" class="cft__bg" />
        <path v-if="curveHist" :d="curveHist" class="cft__hist-area" />
        <g class="cft__grid">
          <line v-for="q in QUARTERS" :key="`v${q}`" :x1="q" :x2="q" y1="0" y2="256" />
          <line v-for="q in QUARTERS" :key="`h${q}`" :y1="q" :y2="q" x1="0" x2="256" />
          <line x1="0" y1="256" x2="256" y2="0" class="cft__diag" />
        </g>
        <path v-for="g in ghostPaths" :key="g.c" :d="g.d" class="cft__ghost" :style="{ stroke: CHANNEL_COLORS[g.c] }" />
        <path :d="mainPath" class="cft__line" :style="{ stroke: CHANNEL_COLORS[channel] }" />
        <circle
          v-for="(p, i) in points"
          :key="`${channel}-${i}`"
          :ref="(el) => (pointEls[i] = el as SVGCircleElement | null)"
          :cx="p[0]"
          :cy="255 - p[1]"
          r="5.5"
          class="cft__pt"
          :class="{ 'is-on': selIndex === i }"
          tabindex="0"
          role="slider"
          :aria-label="`控制点 ${i + 1}${i === 0 ? '（左端）' : i === points.length - 1 ? '（右端）' : ''}`"
          aria-valuemin="0"
          aria-valuemax="255"
          :aria-valuenow="p[1]"
          :aria-valuetext="`输入 ${p[0]}，输出 ${p[1]}`"
          @pointerdown="onPointDown($event, i)"
          @dblclick.stop="removePoint(i)"
          @focus="selIndex = i"
          @keydown="onPointKey($event, i)"
        />
      </svg>
    </div>
    <div class="cft__row cft__row--tools">
      <template v-if="sel">
        <label class="cft__field">
          <span>输入</span>
          <input ref="xInput" :id="`${uid}-x`" type="number" min="0" max="255" :value="sel[0]" class="cft__input" aria-label="选中控制点的输入值（0–255）" @change="onSelInput(0, $event)" @keydown="onFieldKey" />
        </label>
        <label class="cft__field">
          <span>输出</span>
          <input :id="`${uid}-y`" type="number" min="0" max="255" :value="sel[1]" class="cft__input" aria-label="选中控制点的输出值（0–255）" @change="onSelInput(1, $event)" @keydown="onFieldKey" />
        </label>
      </template>
      <span v-else class="cft__soft">{{ points.length }}/{{ CURVE_MAX_POINTS }} 个控制点</span>
      <span class="cft__spacer" />
      <button type="button" class="cft__btn sx-hit" :disabled="!canAdd" :title="canAdd ? '在最宽的空档加一个控制点' : `每条曲线最多 ${CURVE_MAX_POINTS} 个控制点`" @click="addPointButton">加点</button>
      <button type="button" class="cft__btn sx-hit" :disabled="!channelTouched(channel)" @click="resetCurve">重置{{ COLORFIX_CURVE_LABELS[channel] }}</button>
    </div>
    <p v-if="curvesOn || levelsOn" class="cft__order">生效顺序：替换颜色 → 白平衡 → HSL → 色阶 → 曲线（先 RGB 再分通道）→ 五个滑杆</p>
  </div>
</template>

<style scoped lang="less">
.cft {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cft__sec {
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.cft__title {
  color: var(--xq-ink-2);
  font-size: 11.5px;
  font-weight: 600;
}
.cft__spacer {
  flex: 1;
}
.cft__hist {
  position: relative;
  height: 48px;
  margin-left: 64px;
  border: 1px solid var(--xq-line);
  border-radius: 6px;
  background: var(--xq-surface2);
  overflow: hidden;
}
.cft__hist svg {
  display: block;
  width: 100%;
  height: 100%;
}
.cft__hist-area {
  fill: rgb(var(--xq-ink-rgb) / 0.18);
}
.cft__hist-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--xq-muted);
  font-size: 11px;
}
.cft__mark {
  stroke: var(--xq-violet);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.cft__row {
  display: flex;
  min-height: 26px;
  align-items: center;
  gap: 8px;
}
.cft__row--tools {
  flex-wrap: wrap;
  min-height: 30px;
}
.cft__label {
  width: 56px;
  flex: 0 0 56px;
  color: var(--xq-ink-2);
  font-size: 11.5px;
}
.cft__num {
  width: 32px;
  flex: none;
  color: var(--xq-violet-ink);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.cft__num--gamma {
  cursor: text;
}
.cft__gbox {
  width: 40px;
  flex: none;
  box-sizing: border-box;
  padding: 0 4px;
  border: 1px solid var(--xq-violet);
  border-radius: 6px;
  background: var(--xq-surface);
  color: var(--xq-ink);
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
}
.cft__gbox:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 1px;
}
.cft__num.is-zero {
  color: var(--xq-muted);
  font-weight: 500;
}
.cft__soft {
  color: var(--xq-muted);
  font-size: 11.5px;
}
.cft__order {
  margin: 0;
  color: var(--xq-muted);
  font-size: 11px;
  line-height: 1.5;
}
.cft__range {
  height: 22px;
  min-width: 0;
  flex: 1;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.cft__range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: var(--track, var(--xq-line));
  box-shadow: inset 0 0 0 1px rgba(31, 35, 41, 0.08);
}
.cft__range::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--track, var(--xq-line));
}
.cft__range::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -4px;
  border: 2px solid var(--xq-violet);
  border-radius: 50%;
  background: var(--xq-surface);
  box-shadow: 0 1px 3px rgba(31, 35, 41, 0.25);
  -webkit-appearance: none;
}
.cft__range::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid var(--xq-violet);
  border-radius: 50%;
  background: var(--xq-surface);
}
.cft__range:focus-visible,
.cft__btn:focus-visible,
.cft__chan:focus-visible,
.cft__input:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
}
.cft__chans {
  display: inline-flex;
  gap: 4px;
}
.cft__chan {
  position: relative;
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid var(--xq-line);
  border-radius: 12px;
  background: var(--xq-surface);
  color: var(--xq-ink-2);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.cft__chan.is-on {
  border-color: var(--xq-violet);
  color: var(--xq-violet-ink);
  font-weight: 600;
  box-shadow: 0 0 0 2px rgba(135, 95, 154, 0.2);
}
.cft__chan-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.cft__chan-mark {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--xq-surface);
  border-radius: 50%;
  background: var(--xq-violet);
}
.cft__curve {
  display: flex;
  justify-content: center;
}
.cft__svg:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
}
.cft__svg {
  width: 100%;
  max-width: 240px;
  aspect-ratio: 1;
  touch-action: none;
  cursor: crosshair;
  user-select: none;
}
.cft__bg {
  fill: var(--xq-surface2);
  stroke: var(--xq-line);
  stroke-width: 1;
}
.cft__grid line {
  stroke: rgb(var(--xq-ink-rgb) / 0.1);
  stroke-width: 1;
}
.cft__grid .cft__diag {
  stroke-dasharray: 4 4;
}
.cft__ghost {
  fill: none;
  stroke-width: 1.2;
  opacity: 0.45;
}
.cft__line {
  fill: none;
  stroke-width: 2;
}
.cft__pt {
  fill: var(--xq-surface);
  stroke: var(--xq-violet);
  stroke-width: 2;
  cursor: grab;
}
.cft__pt.is-on {
  fill: var(--xq-violet);
}
.cft__pt:focus {
  outline: none;
}
.cft__pt:focus-visible {
  stroke: var(--xq-ink);
  stroke-width: 3;
}
.cft__field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--xq-ink-2);
  font-size: 11.5px;
}
.cft__input {
  width: 52px;
  height: 26px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid var(--xq-line);
  border-radius: 6px;
  background: var(--xq-surface);
  color: var(--xq-ink);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cft__btn {
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
.cft__btn:hover:not(:disabled) {
  border-color: var(--xq-control);
}
.cft__btn:disabled {
  color: var(--xq-placeholder);
  cursor: not-allowed;
}
</style>
