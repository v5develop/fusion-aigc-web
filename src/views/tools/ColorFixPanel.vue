<script setup lang="ts">
/**
 * 服装校色 · 悬浮参数台（原型 components/tool/ColorFixPanel.vue 2026-11-05 第二版；工具页与商拍工作室共用这一块）。
 *
 * <p>定位：`position: absolute`，相对最近的定位祖先（结果列 / 结果卡，父级需 `relative`）——
 * 打开时贴右缘 12px、垂直居中（避开顶部视图切换与底部候选条）；按住标题栏可拖，位置夹在这一列内，
 * 窗口 / 列尺寸变化时重新夹回。拖动中加深投影；进场 160/200ms 上浮 6px + 0.99 缩放，离场 120ms 淡出，
 * 减少动态效果时不做过渡。
 *
 * <p>数值：宽 364、r13、1px line、柔紫径向渐变 + 97% 白、模糊 10；头部 40 高 + 底部 1px 分隔线、2×3 拖动点、
 * 标题「服装校色」13/600、关闭 26 r6（悬停 #f2eef5，命中区外扩到 34）；滑杆区 gap 5 / 内边距 9 12 2；
 * 底行虚线 #ece7f0 分隔、脚注 11px、「恢复默认 / 完成」视觉 24 高 r12（命中区外扩到 32），完成 #8b64a0 描边 + #966baa→#83598f。
 *
 * <p>参数 v-model 双向；「恢复默认」把参数改回 defaults 并发 reset（与默认相同时禁用）；「完成」与 × 都发 done。
 *
 * <p>局部调色（可选，2026-11-09）：绑定 `v-model:region` 才出「选区」区块——整图 / 自动识别（服装 · 商品 · 人物 · 背景）/
 * 手动涂抹，非整图时多出「反选」与「边缘柔化 0–20」。不绑 region 时与旧版完全一致（商拍工作室现有调用不受影响）。
 * 选区状态与蒙版由调用方（components/ColorFix useResultColorFix）负责，本组件只发 paint（打开涂抹）。
 *
 * <p>服装细分部位（2026-11-09）：「自动识别 · 服装」下再出一排多选：全部服装 / 上衣 / 外套 / 下装 / 裙装 / 鞋 / 包 / 帽，
 * 写进 region.parts（空 = 全部服装）。只在传了 `garment-parts`（服务端支持的部位，调用方探测）时出现。
 *
 * <p>停靠（`docked`，2026-11-11 全屏调色）：不浮、不拖，铺满父容器（高度由父级给，内容超出时本体滚动），没有 ×
 * （退出由全屏层负责）；其余内容与交互完全相同。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ColorFixSlider from '@/views/studio/colorfix/ColorFixSlider.vue'
import { COLORFIX_DEFAULT, COLORFIX_RANGES, colorFixEquals, type ColorFixParams } from '@/utils/colorfix.ts'
import {
  COLORFIX_PART_LABELS,
  COLORFIX_REGION_LABELS,
  COLORFIX_TARGET_LABELS,
  colorFixPartsSanitize,
  type ColorFixAutoTarget,
  type ColorFixGarmentPart,
  type ColorFixRegion,
  type ColorFixRegionMode,
} from '@/components/ColorFix/types.ts'

const props = withDefaults(
  defineProps<{
    /** 是否显示（保留过渡动画用；不传 = 显示，兼容外层 v-if 的老写法） */
    open?: boolean
    /** 「恢复默认」恢复到的那组值 */
    defaults?: ColorFixParams
    /** 标题（商拍默认「服装校色」，工具页等通用场景传「图片校色」） */
    title?: string
    /** 选区区块可选的方式（只在绑定 v-model:region 时有用） */
    regionModes?: ColorFixRegionMode[]
    /** 自动识别可选的目标 */
    autoTargets?: ColorFixAutoTarget[]
    /** 正在识别 / 准备蒙版 */
    maskBusy?: boolean
    /** 选区下方的一行提示（识别失败 / 还没涂抹 / 蒙版只在内存等） */
    maskHint?: string
    /** 已有涂抹选区（按钮写「重新涂抹」） */
    hasPainted?: boolean
    /** 已有点选选区（按钮写「重新选区」） */
    hasPoint?: boolean
    /** 「点选」不可用的原因（如「当前浏览器不支持点选」）：按钮置灰、悬停看原因；'' = 可用 */
    pointBlocked?: string
    /** 「自动识别 · 服装」可细分的部位（服务端支持的）；空 = 不出部位选择 */
    garmentParts?: ColorFixGarmentPart[]
    /** 识别中的提示（不传 = 「正在识别选区…」；首次识别慢时调用方换成更长的说明） */
    maskBusyHint?: string
    /** 选区提示旁给「重试」（识别失败可重试时） */
    maskRetry?: boolean
    /** 选区提示下的替代操作按钮（如「改用人物」「改用点选」），点了发 maskAction(key) */
    maskActions?: { key: string; label: string }[]
    /** 停靠在全屏调色右侧：不浮、不拖、无 × */
    docked?: boolean
  }>(),
  {
    open: true,
    defaults: () => ({ ...COLORFIX_DEFAULT }),
    title: '服装校色',
    regionModes: () => ['whole', 'auto', 'paint'],
    autoTargets: () => ['garment', 'product', 'person', 'background'],
    maskBusy: false,
    maskHint: '',
    hasPainted: false,
    hasPoint: false,
    pointBlocked: '',
    garmentParts: () => [],
    maskBusyHint: '',
    maskRetry: false,
    maskActions: () => [],
    docked: false,
  },
)

const params = defineModel<ColorFixParams>({ required: true })
/** 局部调色选区；不绑定 = 不出选区区块 */
const region = defineModel<ColorFixRegion | undefined>('region')

const emit = defineEmits<{
  /** 点了「完成」或 × */
  done: []
  /** 点了「恢复默认」（参数已改回 defaults） */
  reset: []
  /** 点了「涂抹选区 / 重新涂抹」 */
  paint: []
  /** 点了「智能选区 / 重新选区」（本机分割 + 钢笔 / 自由的选区弹窗） */
  point: []
  /** 点了选区提示旁的「重试」（自动识别失败后） */
  retryMask: []
  /** 点了选区提示下的替代操作（maskActions 的 key） */
  maskAction: [key: string]
}>()

const R = COLORFIX_RANGES
const root = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const placed = ref(false)
const dragging = ref(false)
let dragStart = { x: 0, y: 0, px: 0, py: 0 }
let observer: ResizeObserver | null = null

function parentEl(): HTMLElement | null {
  return (root.value?.offsetParent as HTMLElement | null) ?? null
}

function parentBox(): { w: number; h: number } {
  const parent = parentEl()
  return { w: parent?.clientWidth ?? 0, h: parent?.clientHeight ?? 0 }
}

function clamp(x: number, y: number) {
  const el = root.value
  if (!el) return { x, y }
  const { w, h } = parentBox()
  const maxX = Math.max(0, w - el.offsetWidth)
  const maxY = Math.max(0, h - el.offsetHeight)
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) }
}

/** 默认落点：贴右缘 12、垂直居中（原型 2026-11-06：右下角会盖住候选条） */
function placeDefault() {
  const el = root.value
  if (!el) return
  if (props.docked) {
    placed.value = true
    return
  }
  const { w, h } = parentBox()
  pos.value = clamp(w - el.offsetWidth - 12, Math.max(12, Math.round((h - el.offsetHeight) / 2)))
  placed.value = true
}

function observeParent() {
  observer?.disconnect()
  const parent = parentEl()
  if (!parent || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    if (props.open && placed.value && !props.docked) pos.value = clamp(pos.value.x, pos.value.y)
  })
  observer.observe(parent)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      // placed 留到离场动画结束（onAfterLeave）再复位：这里清掉会立刻 visibility:hidden，离场淡出看不到
      observer?.disconnect()
      return
    }
    await nextTick()
    placeDefault()
    observeParent()
  },
  { immediate: true },
)

/** 离场动画结束：复位落点标记，下次打开重新量；离场期间又打开了（open 已回 true）就不动 */
function onAfterLeave() {
  if (!props.open) placed.value = false
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || props.docked) return
  // 头部里的按钮（×）不起拖，否则会吞掉它的 click
  if ((event.target as HTMLElement).closest('button')) return
  dragging.value = true
  dragStart = { x: event.clientX, y: event.clientY, px: pos.value.x, py: pos.value.y }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  pos.value = clamp(dragStart.px + (event.clientX - dragStart.x), dragStart.py + (event.clientY - dragStart.y))
}

function stopDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  stopDrag()
}

function onResize() {
  if (!props.open || !placed.value || props.docked) return
  pos.value = clamp(pos.value.x, pos.value.y)
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  stopDrag()
  observer?.disconnect()
})

/** 系统给的值就是 defaults；改过之后才允许「恢复默认」 */
const valuesMoved = computed(() => !colorFixEquals(params.value, props.defaults))

function setParam(key: keyof ColorFixParams, value: number) {
  params.value = { ...params.value, [key]: value }
}

function reset() {
  params.value = { ...props.defaults }
  emit('reset')
}

function setRegion(patch: Partial<ColorFixRegion>) {
  if (region.value) region.value = { ...region.value, ...patch }
}

/** 当前选中的部位（只留服务端支持的）；空 = 全部服装 */
const pickedParts = computed(() => {
  const allowed = new Set(props.garmentParts)
  return colorFixPartsSanitize(region.value?.parts).filter((p) => allowed.has(p))
})
const showParts = computed(
  () => region.value?.mode === 'auto' && region.value.target === 'garment' && props.garmentParts.length > 0,
)

/** 部位多选：点「全部服装」清空；点某件切换，全取消 = 回到全部服装 */
function togglePart(part: ColorFixGarmentPart | null) {
  if (!part) return setRegion({ parts: [] })
  const cur = pickedParts.value
  setRegion({ parts: colorFixPartsSanitize(cur.includes(part) ? cur.filter((p) => p !== part) : [...cur, part]) })
}

function pickMode(mode: ColorFixRegionMode) {
  if (mode === 'point' && props.pointBlocked && region.value?.mode !== 'point') return
  setRegion({ mode })
  // 选「点选」还没有点过：直接打开点选
  if (mode === 'point' && !props.hasPoint && !props.pointBlocked) emit('point')
  // 选「手动涂抹」还没有涂过：直接打开涂抹
  if (mode === 'paint' && !props.hasPainted) emit('paint')
}

const SLIDERS: { key: keyof ColorFixParams; label: string }[] = [
  { key: 'hue', label: '色相' },
  { key: 'sat', label: '饱和度' },
  { key: 'light', label: '明度' },
  { key: 'bright', label: '亮度' },
  { key: 'contrast', label: '对比度' },
]
</script>

<template>
  <Transition name="cfp" @after-leave="onAfterLeave">
    <section
      v-if="open"
      ref="root"
      class="cfp"
      :class="{ 'is-dragging': dragging, 'is-placed': placed, 'is-docked': docked }"
      :style="docked ? undefined : { left: `${pos.x}px`, top: `${pos.y}px` }"
      :aria-label="`${title}参数`"
    >
      <header class="cfp__head" :title="docked ? undefined : '拖动调整面板'" @pointerdown="onPointerDown">
        <span v-if="!docked" class="cfp__grip" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        <b class="cfp__title">{{ title }}</b>
        <slot name="head-extra" />
        <button
          v-if="!docked"
          type="button"
          class="cfp__close sx-hit"
          aria-label="收起校色参数"
          title="收起校色参数"
          @click="emit('done')"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div v-if="region" class="cfp__region" role="group" aria-label="调色选区">
        <div class="cfp__row">
          <span class="cfp__label">选区</span>
          <span class="cfp__seg" role="radiogroup" aria-label="选区方式">
            <button
              v-for="m in regionModes"
              :key="m"
              type="button"
              role="radio"
              class="cfp__seg-btn sx-hit"
              :class="{ 'is-on': region.mode === m }"
              :aria-checked="region.mode === m"
              :aria-disabled="m === 'point' && !!pointBlocked ? 'true' : undefined"
              :title="m === 'point' && pointBlocked ? pointBlocked : undefined"
              @click="pickMode(m)"
            >
              {{ COLORFIX_REGION_LABELS[m] }}
            </button>
          </span>
        </div>
        <div v-if="region.mode === 'auto'" class="cfp__row">
          <span class="cfp__label" />
          <span class="cfp__chips" role="radiogroup" aria-label="识别目标">
            <button
              v-for="t in autoTargets"
              :key="t"
              type="button"
              role="radio"
              class="cfp__chip sx-hit"
              :class="{ 'is-on': region.target === t }"
              :aria-checked="region.target === t"
              @click="setRegion({ target: t })"
            >
              {{ COLORFIX_TARGET_LABELS[t] }}
            </button>
          </span>
        </div>
        <div v-if="showParts" class="cfp__row cfp__row--top">
          <span class="cfp__label" />
          <span class="cfp__parts" role="group" aria-label="服装部位（可多选）">
            <button
              type="button"
              class="cfp__part sx-hit"
              :class="{ 'is-on': pickedParts.length === 0 }"
              :aria-pressed="pickedParts.length === 0"
              @click="togglePart(null)"
            >
              全部服装
            </button>
            <button
              v-for="p in garmentParts"
              :key="p"
              type="button"
              class="cfp__part sx-hit"
              :class="{ 'is-on': pickedParts.includes(p) }"
              :aria-pressed="pickedParts.includes(p)"
              @click="togglePart(p)"
            >
              {{ COLORFIX_PART_LABELS[p] }}
            </button>
          </span>
        </div>
        <div v-if="region.mode === 'paint'" class="cfp__row">
          <span class="cfp__label" />
          <button type="button" class="cfp__btn sx-hit" @click="emit('paint')">
            {{ hasPainted ? '重新涂抹' : '涂抹选区' }}
          </button>
        </div>
        <div v-if="region.mode === 'point'" class="cfp__row">
          <span class="cfp__label" />
          <button
            type="button"
            class="cfp__btn sx-hit"
            :disabled="!!pointBlocked"
            :title="pointBlocked || '点选 / 钢笔 / 自由勾选区域'"
            @click="emit('point')"
          >
            {{ hasPoint ? '重新选区' : '智能选区' }}
          </button>
        </div>
        <template v-if="region.mode !== 'whole'">
          <div class="cfp__row">
            <span class="cfp__label">反选</span>
            <button
              type="button"
              role="switch"
              class="cfp__switch sx-hit"
              :class="{ 'is-on': region.invert }"
              :aria-checked="region.invert"
              aria-label="反选：调整选区以外"
              @click="setRegion({ invert: !region.invert })"
            >
              <i aria-hidden="true" />
            </button>
            <span class="cfp__label cfp__label--soft">柔化</span>
            <input
              class="cfp__range"
              type="range"
              min="0"
              max="20"
              step="1"
              :value="region.feather"
              aria-label="边缘柔化"
              @input="setRegion({ feather: Number(($event.target as HTMLInputElement).value) })"
            />
            <b class="cfp__num" aria-hidden="true">{{ region.feather }}</b>
          </div>
        </template>
        <p v-if="maskBusy || maskHint" class="cfp__note" role="status" aria-live="polite">
          <span class="cfp__note-text">{{ maskBusy ? maskBusyHint || '正在识别选区…' : maskHint }}</span>
          <button
            v-if="!maskBusy && maskRetry"
            type="button"
            class="cfp__btn sx-hit"
            @click="emit('retryMask')"
          >
            重试
          </button>
        </p>
        <div v-if="!maskBusy && maskHint && maskActions.length" class="cfp__fixes" role="group" aria-label="改用其他选区方式">
          <button
            v-for="a in maskActions"
            :key="a.key"
            type="button"
            class="cfp__btn sx-hit"
            @click="emit('maskAction', a.key)"
          >
            {{ a.label }}
          </button>
        </div>
      </div>

      <div class="cfp__sliders">
        <ColorFixSlider
          v-for="s in SLIDERS"
          :key="s.key"
          :model-value="params[s.key]"
          :label="s.label"
          :tone="s.key"
          :min="R[s.key].min"
          :max="R[s.key].max"
          @update:model-value="setParam(s.key, $event)"
        />
      </div>

      <footer class="cfp__foot">
        <span class="cfp__hint">参数只作用于当前结果，可随时恢复默认</span>
        <button type="button" class="cfp__btn sx-hit" :disabled="!valuesMoved" @click="reset">恢复默认</button>
        <button type="button" class="cfp__btn sx-hit is-primary" @click="emit('done')">完成</button>
      </footer>
    </section>
  </Transition>
</template>

<style scoped lang="less">
/* 浮层材质 / 过渡 / 拖动态是多状态组合选择器，按原型数值落 scoped 样式 */
.cfp {
  position: absolute;
  z-index: 20;
  display: flex;
  width: 364px;
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 13px;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(150, 107, 170, 0.1), transparent 62%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(250, 249, 252, 0.97));
  box-shadow:
    0 18px 40px -16px rgba(30, 41, 59, 0.32),
    0 4px 12px rgba(31, 35, 41, 0.1),
    inset 0 1px 0 #fff;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  transition: box-shadow 0.16s ease;
}
/* 首帧还没量到落点：先藏起来，免得在左上角闪一下 */
.cfp:not(.is-placed) {
  visibility: hidden;
}
.cfp.is-dragging {
  box-shadow:
    0 24px 50px -18px rgba(30, 41, 59, 0.38),
    0 6px 16px rgba(31, 35, 41, 0.12);
}
.cfp-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cfp-leave-active {
  transition: opacity 0.12s ease;
}
.cfp-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.99);
}
.cfp-leave-to {
  opacity: 0;
}

.cfp__head {
  display: flex;
  height: 40px;
  flex: 0 0 40px;
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid #e5e7eb;
  cursor: grab;
  touch-action: none;
}
.cfp.is-dragging .cfp__head {
  cursor: grabbing;
}
.cfp__grip {
  display: grid;
  grid-template-columns: repeat(2, 3px);
  gap: 2px;
  margin-right: 1px;
}
.cfp__grip i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #c9bfd1;
}
.cfp__title {
  min-width: 0;
  flex: 1;
  color: #1f2329;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.cfp__close {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9aa1aa;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.cfp__close svg {
  width: 14px;
  height: 14px;
}
.cfp__close:hover {
  background: #f2eef5;
  color: #6b487c;
}
.cfp__close:focus-visible,
.cfp__btn:focus-visible {
  outline: 2px solid #875f9a;
  outline-offset: 2px;
}

.cfp__region {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 12px;
  padding: 9px 0 8px;
  border-bottom: 1px dashed #ece7f0;
  cursor: default;
}
.cfp__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.cfp__label {
  width: 30px;
  flex: 0 0 30px;
  color: #4a5059;
  font-size: 11.5px;
  font-weight: 500;
}
.cfp__label--soft {
  width: auto;
  flex: 0 0 auto;
  margin-left: 6px;
}
/* 选区分段 / 识别目标：视觉 28 高、12px 字（§10 交互控件下限），按钮间距 8；
   命中区只外扩 2 → 32，相邻两颗之间各占一半间距，不会互相盖住（触屏也不再加大外扩） */
.cfp__seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px;
  border: 1px solid #e5e7eb;
  border-radius: 9px;
  background: #f5f6f7;
}
.cfp__seg-btn,
.cfp__chip {
  height: 28px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #6b7280;
  font: inherit;
  font-size: 12px;
  line-height: 26px;
  white-space: nowrap;
  cursor: pointer;
}
.cfp__seg-btn[aria-disabled='true'] {
  color: #b8bdc4;
  cursor: not-allowed;
}
.cfp__seg-btn.is-on {
  border-color: #d9c8e4;
  background: linear-gradient(180deg, #fff, #f8f3fc);
  color: #6b487c;
  font-weight: 600;
}
.cfp__seg .cfp__seg-btn::after,
.cfp__chips .cfp__chip::after {
  inset: -2px;
}
.cfp__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cfp__chip {
  border-color: #e5e7eb;
  border-radius: 14px;
  background: #fff;
}
.cfp__chip.is-on {
  border-color: #8b64a0;
  background: #f4eef8;
  color: #6b487c;
  font-weight: 600;
}
.cfp__row--top {
  align-items: flex-start;
}
/* 部位多选：视觉 24 高，sx-hit 外扩 4 → 命中 32；行 / 列间距 8（外扩不超过间距一半） */
.cfp__parts {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}
.cfp__part {
  height: 24px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  color: #5f6673;
  font: inherit;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.cfp__part:hover:not(.is-on) {
  border-color: #c9cfd6;
}
.cfp__part.is-on {
  border-color: #8b64a0;
  background: #f4eef8;
  color: #6b487c;
  font-weight: 600;
}
.cfp__part:focus-visible {
  outline: 2px solid #875f9a;
  outline-offset: 2px;
}
.cfp__switch {
  position: relative;
  width: 30px;
  height: 18px;
  flex: 0 0 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: #d5d9de;
  cursor: pointer;
  transition: background 0.12s ease;
}
.cfp__switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.12s ease;
}
.cfp__switch.is-on {
  background: #875f9a;
}
.cfp__switch.is-on i {
  transform: translateX(12px);
}
.cfp__range {
  min-width: 0;
  flex: 1;
  accent-color: #875f9a;
}
.cfp__num {
  width: 18px;
  color: #6b487c;
  font-size: 11px;
  text-align: right;
}
.cfp__note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #9aa1aa;
  font-size: 11px;
  line-height: 16px;
}
.cfp__fixes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: -2px;
}
.cfp__note-text {
  min-width: 0;
  flex: 1;
}
/* 停靠：铺满全屏层右栏，不浮、不拖 */
.cfp.is-docked {
  position: relative;
  z-index: auto;
  width: 100%;
  max-width: none;
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  user-select: auto;
}
.cfp.is-docked .cfp__head {
  height: 48px;
  flex-basis: 48px;
  padding: 0 16px;
  cursor: default;
  touch-action: auto;
}
.cfp.is-docked .cfp__title {
  font-size: 14px;
}
.cfp.is-docked .cfp__region,
.cfp.is-docked .cfp__foot {
  margin: 0 16px;
}
.cfp.is-docked .cfp__sliders {
  padding: 12px 16px 4px;
  gap: 8px;
}
.cfp.is-docked .cfp__foot {
  margin-top: auto;
}
.cfp__seg-btn:focus-visible,
.cfp__chip:focus-visible,
.cfp__switch:focus-visible {
  outline: 2px solid #875f9a;
  outline-offset: 2px;
}

.cfp__sliders {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 12px 2px;
}

.cfp__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px;
  padding: 8px 0 10px;
  border-top: 1px dashed #ece7f0;
  cursor: default;
}
.cfp__hint {
  min-width: 0;
  flex: 1;
  color: #9aa1aa;
  font-size: 11px;
  line-height: 16px;
}
.cfp__btn {
  height: 24px;
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: linear-gradient(#fff, #f7f8f9);
  color: #4a5059;
  font: inherit;
  font-size: 11px;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
}
.cfp__btn:hover:not(:disabled) {
  border-color: #c9cfd6;
}
.cfp__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cfp__btn.is-primary {
  border-color: #8b64a0;
  background: linear-gradient(180deg, #966baa, #83598f);
  color: #fff;
  font-weight: 600;
}
.cfp__btn.is-primary:hover {
  filter: brightness(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .cfp,
  .cfp__close,
  .cfp__switch,
  .cfp__switch i,
  .cfp__part,
  .cfp-enter-active,
  .cfp-leave-active {
    transition: none;
  }
}
</style>
