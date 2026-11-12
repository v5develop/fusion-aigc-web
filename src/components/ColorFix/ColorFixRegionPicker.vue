<script setup lang="ts">
/**
 * 校色选区选择器（2026-11-12 从分页版参数台抽出，分页版「选区」页与全屏停靠参数台共用这一份实现）。
 *
 * <p>内容：「方式」（自动识别 / 手动涂抹 / 点选）→ 自动识别下的「单品」（用户上传过的参考图，每件一枚带缩略图的 chip，
 * 点一下 = 切到 / 新建这件的「自动识别 · 服装 · 部位」图层；识别中 / 失败常驻在 chip 上）+「更多」（aria-expanded 折叠钮，
 * 展开「类别」服装 / 商品 / 人物 / 背景 与服装部位多选）。没有可按部位识别的单品时，类别与部位直接展示（标签「目标」）。
 * 之后是涂抹 / 点选入口、反选 + 边缘柔化、识别提示（重试 / 改用其他方式）。
 *
 * <p>`region` 为空 = 整图底层：只出说明；有单品时仍可直接点一件新建它的选区图层。`cf` 不传 = 没有单品（只出类别）。
 * 行对齐：行 flex 居中、标签列固定宽、行高取 `--crp-row-h`；`large` 只放大控件尺寸，结构与文案不变。
 * 展开 / 收起撑高由宿主按 `button[aria-expanded]` 的点击处理（分页版 onBodyToggle），这里不碰布局。
 */
import { computed, ref, watch } from 'vue'
import { vCfFine, vCfValueEdit } from './fine-adjust.ts'
import { isSelectionLayer } from './layers.ts'
import {
  COLORFIX_PART_LABELS,
  COLORFIX_REGION_LABELS,
  COLORFIX_TARGET_LABELS,
  colorFixPartsEqual,
  colorFixPartsSanitize,
  type ColorFixAutoTarget,
  type ColorFixGarmentPart,
  type ColorFixRegion,
  type ColorFixRegionMode,
} from './types.ts'
import { referenceParts, useColorFixPieces, type ColorFixReference } from './references.ts'
import type { ResultColorFix } from './useResultColorFix.ts'

const props = withDefaults(
  defineProps<{
    /** 取单品参考图与图层状态；不传 = 没有单品 */
    cf?: ResultColorFix
    regionModes?: ColorFixRegionMode[]
    autoTargets?: ColorFixAutoTarget[]
    maskBusy?: boolean
    maskHint?: string
    maskBusyHint?: string
    hasPainted?: boolean
    hasPoint?: boolean
    pointBlocked?: string
    garmentParts?: ColorFixGarmentPart[]
    maskRetry?: boolean
    maskActions?: { key: string; label: string }[]
    /** 整图底层、没有单品时的指引（各宿主的「图层」入口说法不同） */
    baseHint?: string
    /** 控件放大一档（全屏停靠） */
    large?: boolean
  }>(),
  {
    cf: undefined,
    regionModes: () => ['whole', 'auto', 'paint'],
    autoTargets: () => ['garment', 'product', 'person', 'background'],
    maskBusy: false,
    maskHint: '',
    maskBusyHint: '',
    hasPainted: false,
    hasPoint: false,
    pointBlocked: '',
    garmentParts: () => [],
    maskRetry: false,
    maskActions: () => [],
    baseHint: '要只调局部，请在「图层」页添加选区。',
    large: false,
  },
)

const region = defineModel<ColorFixRegion | undefined>('region')

const emit = defineEmits<{
  paint: []
  point: []
  retryMask: []
  maskAction: [key: string]
}>()

function setRegion(patch: Partial<ColorFixRegion>) {
  if (region.value) region.value = { ...region.value, ...patch }
}
const pickedParts = computed(() => {
  const allowed = new Set(props.garmentParts)
  return colorFixPartsSanitize(region.value?.parts).filter((p) => allowed.has(p))
})
const showParts = computed(
  () => region.value?.mode === 'auto' && region.value.target === 'garment' && props.garmentParts.length > 0,
)
function togglePart(part: ColorFixGarmentPart | null) {
  if (!part) return setRegion({ parts: [] })
  const cur = pickedParts.value
  setRegion({ parts: colorFixPartsSanitize(cur.includes(part) ? cur.filter((p) => p !== part) : [...cur, part]) })
}
function pickMode(mode: ColorFixRegionMode) {
  if (mode === 'point' && props.pointBlocked && region.value?.mode !== 'point') return
  setRegion({ mode })
  if (mode === 'point' && !props.hasPoint && !props.pointBlocked) emit('point')
  if (mode === 'paint' && !props.hasPainted) emit('paint')
}

// ---------------- 单品 ----------------

const pieces = computed(() => (props.cf ? useColorFixPieces(props.cf) : null))
/** 能按部位识别的单品（用户上传过的那几件）：有它们就只出它们，通用类别收进「更多」 */
const pieceRefs = computed<ColorFixReference[]>(
  () => pieces.value?.references.value.filter((r) => referenceParts(r).length > 0) ?? [],
)
const hasPieces = computed(() => pieceRefs.value.length > 0)
function pieceLayer(r: ColorFixReference) {
  const parts = referenceParts(r)
  return props.cf?.layers.value.find(
    (l) =>
      isSelectionLayer(l) &&
      l.region.mode === 'auto' &&
      l.region.target === 'garment' &&
      colorFixPartsEqual(colorFixPartsSanitize(l.region.parts), parts),
  )
}
function pieceOn(r: ColorFixReference): boolean {
  const l = pieceLayer(r)
  return !!l && l.id === props.cf?.selectedLayerId.value
}
function pieceFailed(r: ColorFixReference): boolean {
  const l = pieceLayer(r)
  return !!l && props.cf?.layerStatus(l) === 'error'
}
function pieceBusy(r: ColorFixReference): boolean {
  const l = pieceLayer(r)
  return !!l && props.cf?.layerStatus(l) === 'busy'
}
function pickPiece(r: ColorFixReference) {
  const cf = props.cf
  if (!cf) return
  const l = pieceLayer(r)
  // 识别失败的这件：再点一下 = 重试识别（选中它并走原有重试），否则只是切过去
  if (l && cf.layerStatus(l) === 'error' && pieceOn(r) && cf.maskRetryable.value) {
    cf.retryMask()
    return
  }
  pieces.value?.select(r.key)
}
const moreOpen = ref(false)
/** 当前图层是通用类别（不是某件单品）：「更多」默认展开，免得选中态藏起来 */
const genericActive = computed(
  () => !!region.value && region.value.mode === 'auto' && !pieceRefs.value.some((r) => pieceOn(r)),
)
watch(
  () => [hasPieces.value, genericActive.value] as const,
  ([has, generic]) => {
    if (has && generic) moreOpen.value = true
  },
)
</script>

<template>
  <div class="crp" :class="{ 'is-large': large }">
    <template v-if="region">
      <div class="crp__row">
        <span class="crp__label">方式</span>
        <span class="crp__seg" role="radiogroup" aria-label="选区方式">
          <button
            v-for="m in regionModes"
            :key="m"
            type="button"
            role="radio"
            class="crp__seg-btn sx-hit"
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

      <template v-if="region.mode === 'auto'">
        <!-- 有单品参考图：只出用户上传的那几件 -->
        <div v-if="hasPieces" class="crp__row crp__row--top crp__row--piece">
          <span class="crp__label">单品</span>
          <span class="crp__chips" role="radiogroup" aria-label="识别哪一件">
            <button
              v-for="r in pieceRefs"
              :key="r.key"
              type="button"
              role="radio"
              class="crp__piece sx-hit"
              :class="{ 'is-on': pieceOn(r), 'is-failed': pieceFailed(r) }"
              :aria-checked="pieceOn(r)"
              :aria-label="pieceFailed(r) ? `${r.label}，识别失败` : r.label"
              :aria-busy="pieceBusy(r) || undefined"
              @click="pickPiece(r)"
            >
              <img class="crp__thumb" :src="r.url" alt="" draggable="false" loading="lazy" />
              {{ r.label }}
              <em v-if="pieceFailed(r)" class="crp__fail">识别失败</em>
              <em v-else-if="pieceBusy(r)" class="crp__busy">识别中</em>
            </button>
            <button
              type="button"
              class="crp__chip crp__chip--more sx-hit"
              :aria-expanded="moreOpen"
              aria-controls="cft-more"
              @click="moreOpen = !moreOpen"
            >
              更多
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="{ 'is-open': moreOpen }">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </span>
        </div>
        <div v-if="!hasPieces || moreOpen" id="cft-more" class="crp__row crp__row--top">
          <span class="crp__label">{{ hasPieces ? '类别' : '目标' }}</span>
          <span class="crp__chips" role="radiogroup" aria-label="识别目标">
            <button
              v-for="t in autoTargets"
              :key="t"
              type="button"
              role="radio"
              class="crp__chip sx-hit"
              :class="{ 'is-on': region.target === t && (!hasPieces || genericActive) }"
              :aria-checked="region.target === t"
              @click="setRegion({ target: t })"
            >
              {{ COLORFIX_TARGET_LABELS[t] }}
            </button>
          </span>
        </div>
        <div v-if="showParts && (!hasPieces || moreOpen)" class="crp__row crp__row--top crp__row--part">
          <span class="crp__label" />
          <span class="crp__chips" role="group" aria-label="服装部位（可多选）">
            <button
              type="button"
              class="crp__part sx-hit"
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
              class="crp__part sx-hit"
              :class="{ 'is-on': pickedParts.includes(p) }"
              :aria-pressed="pickedParts.includes(p)"
              @click="togglePart(p)"
            >
              {{ COLORFIX_PART_LABELS[p] }}
            </button>
          </span>
        </div>
      </template>

      <div v-if="region.mode === 'paint'" class="crp__row">
        <span class="crp__label" />
        <button type="button" class="crp__btn sx-hit" @click="emit('paint')">
          {{ hasPainted ? '重新涂抹' : '涂抹选区' }}
        </button>
      </div>
      <div v-if="region.mode === 'point'" class="crp__row">
        <span class="crp__label" />
        <button
          type="button"
          class="crp__btn sx-hit"
          :disabled="!!pointBlocked"
          :title="pointBlocked || '点选 / 钢笔 / 自由勾选区域'"
          @click="emit('point')"
        >
          {{ hasPoint ? '重新选区' : '智能选区' }}
        </button>
      </div>
      <div v-if="region.mode !== 'whole'" class="crp__row">
        <span class="crp__label">反选</span>
        <button
          type="button"
          role="switch"
          class="crp__switch sx-hit"
          :class="{ 'is-on': region.invert }"
          :aria-checked="region.invert"
          aria-label="反选：调整选区以外"
          @click="setRegion({ invert: !region.invert })"
        >
          <i aria-hidden="true" />
        </button>
        <span class="crp__label crp__label--soft">柔化</span>
        <input
          v-cf-fine
          class="crp__range"
          type="range"
          min="0"
          max="20"
          step="1"
          :value="region.feather"
          aria-label="边缘柔化"
          @input="setRegion({ feather: Number(($event.target as HTMLInputElement).value) })"
        />
        <b v-cf-value-edit class="crp__num">{{ region.feather }}</b>
      </div>
    </template>
    <!-- 整图底层：没有选区设置；有单品参考图时仍可直接点一件新建它的选区 -->
    <template v-else>
      <p class="crp__note">当前是「整图」底层，作用于整幅图片。{{ hasPieces ? '点一件单品，新建它的选区图层：' : baseHint }}</p>
      <div v-if="hasPieces" class="crp__row crp__row--top crp__row--piece">
        <span class="crp__chips" role="group" aria-label="新建单品选区">
          <button
            v-for="r in pieceRefs"
            :key="r.key"
            type="button"
            class="crp__piece sx-hit"
            :class="{ 'is-failed': pieceFailed(r) }"
            :aria-label="pieceFailed(r) ? `${r.label}，识别失败` : r.label"
            @click="pickPiece(r)"
          >
            <img class="crp__thumb" :src="r.url" alt="" draggable="false" loading="lazy" />
            {{ r.label }}
            <em v-if="pieceFailed(r)" class="crp__fail">识别失败</em>
          </button>
        </span>
      </div>
    </template>

    <p v-if="maskBusy || maskHint" class="crp__note crp__note--row" role="status" aria-live="polite">
      <span class="crp__note-text">{{ maskBusy ? maskBusyHint || '正在识别选区…' : maskHint }}</span>
      <button v-if="!maskBusy && maskRetry" type="button" class="crp__btn sx-hit" @click="emit('retryMask')">重试</button>
    </p>
    <div v-if="!maskBusy && maskHint && maskActions.length" class="crp__fixes" role="group" aria-label="改用其他选区方式">
      <button v-for="a in maskActions" :key="a.key" type="button" class="crp__btn sx-hit" @click="emit('maskAction', a.key)">
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="less">
.crp {
  --crp-row-h: 28px;
  --crp-chip-h: 28px;
  --crp-piece-h: 30px;
  --crp-part-h: 24px;
  --crp-thumb: 24px;
  --crp-label-w: 30px;
  --crp-font: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.crp.is-large {
  --crp-row-h: 32px;
  --crp-chip-h: 32px;
  --crp-piece-h: 36px;
  --crp-part-h: 28px;
  --crp-thumb: 30px;
  --crp-label-w: 36px;
  --crp-font: 13px;
}
/* 统一行布局：标签列固定宽，标签行高 = 控件行高，文字垂直正中；
   换行的 chip 行（--top）标签与第一行控件对齐，其余行 align-items:center */
.crp__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--crp-row-h);
}
.crp__row--top {
  align-items: flex-start;
}
.crp__row--piece {
  --crp-row-h: var(--crp-piece-h);
}
.crp__row--part {
  --crp-row-h: var(--crp-part-h);
}
.crp__label {
  display: flex;
  width: var(--crp-label-w);
  height: var(--crp-row-h);
  flex: 0 0 var(--crp-label-w);
  align-items: center;
  color: var(--xq-ink-2);
  font-size: calc(var(--crp-font) - 0.5px);
  font-weight: 500;
  line-height: var(--crp-row-h);
  white-space: nowrap;
}
.crp__label--soft {
  width: auto;
  flex: 0 0 auto;
  margin-left: 6px;
}
.crp__seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--xq-line);
  border-radius: 9px;
  background: var(--xq-sunken);
}
.crp__seg-btn,
.crp__chip {
  height: var(--crp-chip-h);
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--xq-muted);
  font: inherit;
  font-size: var(--crp-font);
  line-height: calc(var(--crp-chip-h) - 2px);
  white-space: nowrap;
  cursor: pointer;
}
.crp__seg-btn[aria-disabled='true'] {
  color: var(--xq-control-hover);
  cursor: not-allowed;
}
.crp__seg-btn.is-on {
  border-color: var(--xq-violet-line);
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font-weight: 600;
}
.crp__chips {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.crp__chip,
.crp__piece,
.crp__part {
  border: 1px solid var(--xq-line);
  background: var(--xq-surface);
}
.crp__chip {
  border-radius: calc(var(--crp-chip-h) / 2);
}
.crp__chip.is-on,
.crp__piece.is-on,
.crp__part.is-on {
  border-color: var(--xq-violet);
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font-weight: 600;
}
.crp__chip--more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border-style: dashed;
}
.crp__chip--more svg {
  width: 12px;
  height: 12px;
  transition: transform 0.12s ease;
}
.crp__chip--more svg.is-open {
  transform: rotate(180deg);
}
/* 单品 chip：圆角缩略图 + 件名；识别失败的在名字后常驻警示 */
.crp__piece {
  display: inline-flex;
  height: var(--crp-piece-h);
  box-sizing: border-box;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 3px;
  border-radius: calc(var(--crp-piece-h) / 2);
  color: var(--xq-muted);
  font: inherit;
  font-size: var(--crp-font);
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.12s ease;
}
.crp__piece:hover:not(.is-on) {
  border-color: var(--xq-control);
}
.crp__piece.is-failed:not(.is-on) {
  border-color: var(--xq-warning-fg);
}
.crp__thumb {
  width: var(--crp-thumb);
  height: var(--crp-thumb);
  flex: none;
  border-radius: 6px;
  background: var(--xq-surface3);
  object-fit: cover;
}
.crp__fail,
.crp__busy {
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
}
.crp__fail {
  color: var(--xq-warning-fg);
}
.crp__busy {
  color: var(--xq-placeholder);
}
.crp__part {
  height: var(--crp-part-h);
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: calc(var(--crp-part-h) / 2);
  color: var(--xq-muted);
  font: inherit;
  font-size: var(--crp-font);
  line-height: calc(var(--crp-part-h) - 2px);
  white-space: nowrap;
  cursor: pointer;
}
.crp__switch {
  position: relative;
  width: 30px;
  height: 18px;
  flex: 0 0 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: var(--xq-control);
  cursor: pointer;
  transition: background 0.12s ease;
}
.crp__switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--xq-surface);
  box-shadow: 0 1px 2px rgb(var(--xq-ink-rgb) / 0.25);
  transition: transform 0.12s ease;
}
.crp__switch.is-on {
  background: var(--xq-violet);
}
.crp__switch.is-on i {
  transform: translateX(12px);
}
.crp__range {
  min-width: 0;
  flex: 1;
  accent-color: var(--xq-violet);
}
.crp__num {
  width: 18px;
  color: var(--xq-violet-ink);
  font-size: 11px;
  text-align: right;
}
.crp__note {
  margin: 0;
  color: var(--xq-placeholder);
  font-size: 11px;
  line-height: 16px;
}
.crp__note--row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.crp__note-text {
  min-width: 0;
  flex: 1;
}
.crp__fixes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.crp__btn {
  height: 24px;
  flex: 0 0 auto;
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
.crp__btn:hover:not(:disabled) {
  border-color: var(--xq-control);
}
.crp__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.crp__btn:focus-visible,
.crp__seg-btn:focus-visible,
.crp__chip:focus-visible,
.crp__piece:focus-visible,
.crp__part:focus-visible,
.crp__switch:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .crp__piece,
  .crp__switch,
  .crp__switch i,
  .crp__chip--more svg {
    transition: none;
  }
}
</style>
