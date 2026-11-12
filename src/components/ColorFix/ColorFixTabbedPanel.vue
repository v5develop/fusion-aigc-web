<script setup lang="ts">
/**
 * 校色悬浮参数台 · 分页版（2026-11-12，非全屏的页面上那份；全屏停靠仍用 views/tools/ColorFixPanel，布局不变）。
 *
 * <p>为什么拆页：旧版把图层 / 选区 / 替换颜色 / 更多调整 / 五个滑杆全叠在一列，浮在结果图上把模特盖住。
 * 现在固定部分只有：头部（标题 + 拖动 + 看原图 + ×）、「当前图层」一行（名称 + 状态 + 显隐）、三个页签、底栏（脚注 + 恢复默认 + 完成）；
 * 页签内容在中间滚动，同一时刻只显示一页——「调整」（替换颜色 / 更多调整 / 五滑杆，默认页）、「选区」、「图层」。
 * 最后一次用的页签按本机记住（localStorage，读写都包 try/catch）。
 *
 * <p>高度：最高 = 所在舞台高度的 50%（不低于 {@link MIN_MAX_H}），且任何时候不高于舞台 − 24；舞台尺寸变化时重算。
 * 位置 / 拖动 / 夹取与旧版一致（相对最近的定位祖先，默认贴右缘 12、垂直居中）。
 *
 * <p>自动识别 · 单品（宿主传了 references 且带部位，商拍换装）：只出用户上传过的那几件，每件一枚带缩略图的 chip，
 * 点一下 = 切到 / 新建这件的「自动识别 · 服装 · 部位」图层（useColorFixPieces.select）；服装 / 商品 / 人物 / 背景与部位细分收进「更多」。
 * 没有参考图时保持原来的类别列表。某件的图层识别失败，它的 chip 上常驻「识别失败」。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ColorFixSlider from '@/views/studio/colorfix/ColorFixSlider.vue'
import IconButton from '@/components/IconButton/index.vue'
import { normalizeHex } from '@/utils/colorfix-math.ts'
import { COLORFIX_RECOLOR_DEFAULT, isBaseLayer, isSelectionLayer, type ColorFixRecolor } from './layers.ts'
import { COLORFIX_DEFAULT, COLORFIX_RANGES, colorFixEquals, type ColorFixParams } from '@/utils/colorfix.ts'
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

/** 50% 高度的下限：舞台很矮时也要放得下头部 + 页签 + 底栏 + 一点内容 */
const MIN_MAX_H = 260
const TAB_KEY = 'xq-colorfix-panel-tab'
type TabKey = 'adjust' | 'region' | 'layers'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'layers', label: '图层' },
  { key: 'region', label: '选区' },
  { key: 'adjust', label: '调整' },
]

// 宿主与停靠版共用同一组绑定（docked / recolor-enabled 在这里没有意义），不透传到根节点
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    cf: ResultColorFix
    open?: boolean
    defaults?: ColorFixParams
    title?: string
    regionModes?: ColorFixRegionMode[]
    autoTargets?: ColorFixAutoTarget[]
    maskBusy?: boolean
    maskHint?: string
    hasPainted?: boolean
    hasPoint?: boolean
    pointBlocked?: string
    garmentParts?: ColorFixGarmentPart[]
    maskBusyHint?: string
    maskRetry?: boolean
    maskActions?: { key: string; label: string }[]
    recolorAutoSource?: string | null
    slidersTitle?: string
    pixelLayer?: boolean
    pixelNote?: string
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
    recolorAutoSource: null,
    slidersTitle: '',
    pixelLayer: false,
    pixelNote: '',
  },
)

const params = defineModel<ColorFixParams>({ required: true })
const region = defineModel<ColorFixRegion | undefined>('region')
const recolor = defineModel<ColorFixRecolor | null>('recolor', { default: null })

const emit = defineEmits<{
  done: []
  reset: []
  paint: []
  point: []
  retryMask: []
  maskAction: [key: string]
  pickSource: []
}>()

const R = COLORFIX_RANGES
const pieces = useColorFixPieces(props.cf)

// ---------------- 页签（记住上次） ----------------

function loadTab(): TabKey {
  try {
    const v = localStorage.getItem(TAB_KEY)
    if (v === 'adjust' || v === 'region' || v === 'layers') return v
  } catch {
    /* 隐私模式 / 禁用存储：走默认 */
  }
  return 'adjust'
}
const tab = ref<TabKey>(loadTab())
function setTab(k: TabKey, focus = false) {
  tab.value = k
  try {
    localStorage.setItem(TAB_KEY, k)
  } catch {
    /* 存不了就只在本次生效 */
  }
  if (focus) void nextTick(() => tabEls.value[k]?.focus())
}
const tabEls = ref<Partial<Record<TabKey, HTMLElement | null>>>({})
function onTabKey(e: KeyboardEvent) {
  const i = TABS.findIndex((t) => t.key === tab.value)
  let n = i
  if (e.key === 'ArrowRight') n = (i + 1) % TABS.length
  else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length
  else if (e.key === 'Home') n = 0
  else if (e.key === 'End') n = TABS.length - 1
  else return
  e.preventDefault()
  setTab(TABS[n]!.key, true)
}
const body = ref<HTMLElement | null>(null)
watch(tab, () => {
  if (body.value) body.value.scrollTop = 0
})

// ---------------- 位置 / 拖动 / 高度 ----------------

const root = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const placed = ref(false)
const dragging = ref(false)
const maxH = ref(0)
let dragStart = { x: 0, y: 0, px: 0, py: 0 }
let observer: ResizeObserver | null = null

function parentEl(): HTMLElement | null {
  return (root.value?.offsetParent as HTMLElement | null) ?? null
}
function parentBox() {
  const p = parentEl()
  return { w: p?.clientWidth ?? 0, h: p?.clientHeight ?? 0 }
}
/** 最高：舞台一半（有下限），但不超过舞台 − 24 */
function calcMaxH() {
  const { h } = parentBox()
  if (!h) return 0
  return Math.max(120, Math.min(Math.max(MIN_MAX_H, Math.round(h * 0.5)), h - 24))
}
function clamp(x: number, y: number) {
  const el = root.value
  if (!el) return { x, y }
  const { w, h } = parentBox()
  return {
    x: Math.min(Math.max(0, x), Math.max(0, w - el.offsetWidth)),
    y: Math.min(Math.max(0, y), Math.max(0, h - el.offsetHeight)),
  }
}
function placeDefault() {
  const el = root.value
  if (!el) return
  maxH.value = calcMaxH()
  void nextTick(() => {
    const { w, h } = parentBox()
    pos.value = clamp(w - el.offsetWidth - 12, Math.max(12, Math.round((h - el.offsetHeight) / 2)))
    placed.value = true
  })
}
function onParentResize() {
  if (!props.open || !placed.value) return
  maxH.value = calcMaxH()
  void nextTick(() => (pos.value = clamp(pos.value.x, pos.value.y)))
}
function observeParent() {
  observer?.disconnect()
  const p = parentEl()
  if (!p || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(onParentResize)
  observer.observe(p)
}
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      observer?.disconnect()
      return
    }
    await nextTick()
    placeDefault()
    observeParent()
  },
  { immediate: true },
)
// 内容高度变了（换页签 / 展开更多）：贴着底边的面板要再夹回舞台里
watch([tab, () => props.pixelLayer], () => {
  void nextTick(() => {
    if (placed.value) pos.value = clamp(pos.value.x, pos.value.y)
  })
})
function onAfterLeave() {
  if (!props.open) placed.value = false
}
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button')) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, px: pos.value.x, py: pos.value.y }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  pos.value = clamp(dragStart.px + (e.clientX - dragStart.x), dragStart.py + (e.clientY - dragStart.y))
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
onMounted(() => window.addEventListener('resize', onParentResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onParentResize)
  stopDrag()
  observer?.disconnect()
})

// ---------------- 当前图层行 ----------------

const sel = computed(() => props.cf.selectedLayer.value)
const onBase = computed(() => isBaseLayer(sel.value))
const selStatus = computed(() => {
  const st = props.cf.layerStatus(sel.value)
  if (st === 'busy') return { text: '识别中', tone: 'busy' }
  if (st === 'error') return { text: '识别失败', tone: 'warn' }
  if (st === 'pending') return { text: '未选区', tone: 'warn' }
  return null
})
const layerCount = computed(() => props.cf.layers.value.length)

// ---------------- 调整页 ----------------

const valuesMoved = computed(() => !colorFixEquals(params.value, props.defaults))
function setParam(key: keyof ColorFixParams, value: number) {
  params.value = { ...params.value, [key]: value }
}
function reset() {
  params.value = { ...props.defaults }
  emit('reset')
}
const SLIDERS: { key: keyof ColorFixParams; label: string }[] = [
  { key: 'hue', label: '色相' },
  { key: 'sat', label: '饱和度' },
  { key: 'light', label: '明度' },
  { key: 'bright', label: '亮度' },
  { key: 'contrast', label: '对比度' },
]

const SWATCHES: { hex: string; name: string }[] = [
  { hex: '#1f2329', name: '黑' },
  { hex: '#f5f5f2', name: '白' },
  { hex: '#8a8f98', name: '灰' },
  { hex: '#b4433e', name: '红' },
  { hex: '#d9822b', name: '橙' },
  { hex: '#e3c14d', name: '黄' },
  { hex: '#34795a', name: '绿' },
  { hex: '#2f6db5', name: '蓝' },
  { hex: '#875f9a', name: '紫' },
  { hex: '#c8a27a', name: '卡其' },
]
const recolorOn = computed(() => !!recolor.value)
function setRecolor(patch: Partial<ColorFixRecolor>) {
  recolor.value = { ...(recolor.value ?? COLORFIX_RECOLOR_DEFAULT), ...patch }
}
function toggleRecolor() {
  recolor.value = recolor.value ? null : { ...COLORFIX_RECOLOR_DEFAULT }
}
const hexDraft = ref('')
watch(
  () => recolor.value?.target,
  (t) => (hexDraft.value = t ?? ''),
  { immediate: true },
)
function commitHex() {
  const hex = normalizeHex(hexDraft.value)
  if (hex) setRecolor({ target: hex })
  else hexDraft.value = recolor.value?.target ?? ''
}
const sourceShown = computed(() => recolor.value?.source ?? props.recolorAutoSource ?? '')

// ---------------- 选区页 ----------------

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

/** 能按部位识别的单品（用户上传过的那几件）：有它们就只出它们，通用类别收进「更多」 */
const pieceRefs = computed<ColorFixReference[]>(() =>
  pieces.references.value.filter((r) => referenceParts(r).length > 0),
)
const hasPieces = computed(() => pieceRefs.value.length > 0)
function pieceLayer(r: ColorFixReference) {
  const parts = referenceParts(r)
  return props.cf.layers.value.find(
    (l) =>
      isSelectionLayer(l) &&
      l.region.mode === 'auto' &&
      l.region.target === 'garment' &&
      colorFixPartsEqual(colorFixPartsSanitize(l.region.parts), parts),
  )
}
function pieceOn(r: ColorFixReference): boolean {
  const l = pieceLayer(r)
  return !!l && l.id === props.cf.selectedLayerId.value
}
function pieceFailed(r: ColorFixReference): boolean {
  const l = pieceLayer(r)
  return !!l && props.cf.layerStatus(l) === 'error'
}
function pieceBusy(r: ColorFixReference): boolean {
  const l = pieceLayer(r)
  return !!l && props.cf.layerStatus(l) === 'busy'
}
function pickPiece(r: ColorFixReference) {
  const l = pieceLayer(r)
  // 识别失败的这件：再点一下 = 重试识别（选中它并走原有重试），否则只是切过去
  if (l && props.cf.layerStatus(l) === 'error' && pieceOn(r) && props.cf.maskRetryable.value) {
    props.cf.retryMask()
    return
  }
  pieces.select(r.key)
}
const moreOpen = ref(false)
/** 当前图层是通用类别（不是某件单品）：「更多」默认展开，免得选中态藏起来 */
const genericActive = computed(
  () => !!region.value && region.value.mode === 'auto' && !pieceRefs.value.some((r) => pieceOn(r)),
)
watch(
  () => [hasPieces.value, genericActive.value, onBase.value] as const,
  ([has, generic, base]) => {
    if (has && generic && !base && region.value?.mode === 'auto') moreOpen.value = true
  },
)
</script>

<template>
  <Transition name="cft" @after-leave="onAfterLeave">
    <section
      v-if="open"
      ref="root"
      class="cft"
      :class="{ 'is-dragging': dragging, 'is-placed': placed }"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px`, maxHeight: maxH ? `${maxH}px` : undefined }"
      :aria-label="`${title}参数`"
    >
      <header class="cft__head" title="拖动调整面板" @pointerdown="onPointerDown">
        <span class="cft__grip" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        <b class="cft__title">{{ title }}</b>
        <slot name="head-extra" />
        <button type="button" class="cft__close sx-hit" aria-label="收起校色参数" title="收起校色参数" @click="emit('done')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div class="cft__cur" role="group" aria-label="当前图层">
        <span class="cft__cur-label">当前</span>
        <b class="cft__cur-name" :title="sel.name">{{ sel.name }}</b>
        <span v-if="layerCount > 1" class="cft__cur-count" :aria-label="`共 ${layerCount} 层`">{{ layerCount }} 层</span>
        <span v-if="selStatus" class="cft__status" :class="`is-${selStatus.tone}`">{{ selStatus.text }}</span>
        <span class="cft__spacer" />
        <IconButton
          :label="sel.visible ? `隐藏「${sel.name}」` : `显示「${sel.name}」`"
          size="sm"
          variant="quiet"
          :pressed="!sel.visible"
          @click="cf.setLayerVisible(sel.id, !sel.visible)"
        >
          <svg v-if="sel.visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" />
          </svg>
        </IconButton>
      </div>

      <div class="cft__tabs" role="tablist" aria-label="校色分页" @keydown="onTabKey">
        <button
          v-for="t in TABS"
          :id="`cft-tab-${t.key}`"
          :key="t.key"
          :ref="(el) => (tabEls[t.key] = el as HTMLElement | null)"
          type="button"
          role="tab"
          class="cft__tab sx-hit"
          :class="{ 'is-on': tab === t.key }"
          :aria-selected="tab === t.key"
          :aria-controls="`cft-pane-${t.key}`"
          :tabindex="tab === t.key ? 0 : -1"
          @click="setTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <div ref="body" class="cft__body">
        <!-- 图层 -->
        <div v-show="tab === 'layers'" id="cft-pane-layers" role="tabpanel" aria-labelledby="cft-tab-layers" class="cft__pane">
          <slot name="layers" />
        </div>

        <!-- 选区 -->
        <div v-show="tab === 'region'" id="cft-pane-region" role="tabpanel" aria-labelledby="cft-tab-region" class="cft__pane">
          <div class="cft__sec" role="group" aria-label="调色选区">
            <p v-if="pixelLayer" class="cft__note">像素层没有选区；可在「图层」页给它上面添加新的选区图层。</p>
            <template v-else-if="region">
              <div class="cft__row">
                <span class="cft__label">方式</span>
                <span class="cft__seg" role="radiogroup" aria-label="选区方式">
                  <button
                    v-for="m in regionModes"
                    :key="m"
                    type="button"
                    role="radio"
                    class="cft__seg-btn sx-hit"
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
                <div v-if="hasPieces" class="cft__row cft__row--top">
                  <span class="cft__label">单品</span>
                  <span class="cft__chips" role="radiogroup" aria-label="识别哪一件">
                    <button
                      v-for="r in pieceRefs"
                      :key="r.key"
                      type="button"
                      role="radio"
                      class="cft__piece sx-hit"
                      :class="{ 'is-on': pieceOn(r), 'is-failed': pieceFailed(r) }"
                      :aria-checked="pieceOn(r)"
                      :aria-label="pieceFailed(r) ? `${r.label}，识别失败` : r.label"
                      :aria-busy="pieceBusy(r) || undefined"
                      @click="pickPiece(r)"
                    >
                      <img class="cft__thumb" :src="r.url" alt="" draggable="false" loading="lazy" />
                      {{ r.label }}
                      <em v-if="pieceFailed(r)" class="cft__fail">识别失败</em>
                      <em v-else-if="pieceBusy(r)" class="cft__busy">识别中</em>
                    </button>
                    <button
                      type="button"
                      class="cft__chip cft__chip--more sx-hit"
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
                <div v-if="!hasPieces || moreOpen" id="cft-more" class="cft__row cft__row--top">
                  <span class="cft__label">{{ hasPieces ? '类别' : '目标' }}</span>
                  <span class="cft__chips" role="radiogroup" aria-label="识别目标">
                    <button
                      v-for="t in autoTargets"
                      :key="t"
                      type="button"
                      role="radio"
                      class="cft__chip sx-hit"
                      :class="{ 'is-on': region.target === t && (!hasPieces || genericActive) }"
                      :aria-checked="region.target === t"
                      @click="setRegion({ target: t })"
                    >
                      {{ COLORFIX_TARGET_LABELS[t] }}
                    </button>
                  </span>
                </div>
                <div v-if="showParts && (!hasPieces || moreOpen)" class="cft__row cft__row--top">
                  <span class="cft__label" />
                  <span class="cft__chips" role="group" aria-label="服装部位（可多选）">
                    <button
                      type="button"
                      class="cft__part sx-hit"
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
                      class="cft__part sx-hit"
                      :class="{ 'is-on': pickedParts.includes(p) }"
                      :aria-pressed="pickedParts.includes(p)"
                      @click="togglePart(p)"
                    >
                      {{ COLORFIX_PART_LABELS[p] }}
                    </button>
                  </span>
                </div>
              </template>

              <div v-if="region.mode === 'paint'" class="cft__row">
                <span class="cft__label" />
                <button type="button" class="cft__btn sx-hit" @click="emit('paint')">
                  {{ hasPainted ? '重新涂抹' : '涂抹选区' }}
                </button>
              </div>
              <div v-if="region.mode === 'point'" class="cft__row">
                <span class="cft__label" />
                <button
                  type="button"
                  class="cft__btn sx-hit"
                  :disabled="!!pointBlocked"
                  :title="pointBlocked || '点选 / 钢笔 / 自由勾选区域'"
                  @click="emit('point')"
                >
                  {{ hasPoint ? '重新选区' : '智能选区' }}
                </button>
              </div>
              <div v-if="region.mode !== 'whole'" class="cft__row">
                <span class="cft__label">反选</span>
                <button
                  type="button"
                  role="switch"
                  class="cft__switch sx-hit"
                  :class="{ 'is-on': region.invert }"
                  :aria-checked="region.invert"
                  aria-label="反选：调整选区以外"
                  @click="setRegion({ invert: !region.invert })"
                >
                  <i aria-hidden="true" />
                </button>
                <span class="cft__label cft__label--soft">柔化</span>
                <input
                  class="cft__range"
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  :value="region.feather"
                  aria-label="边缘柔化"
                  @input="setRegion({ feather: Number(($event.target as HTMLInputElement).value) })"
                />
                <b class="cft__num" aria-hidden="true">{{ region.feather }}</b>
              </div>
            </template>
            <!-- 整图底层：没有选区设置；有单品参考图时仍可直接点一件新建它的选区 -->
            <template v-else>
              <p class="cft__note">当前是「整图」底层，作用于整幅图片。{{ hasPieces ? '点一件单品，新建它的选区图层：' : '要只调局部，请在「图层」页添加选区。' }}</p>
              <div v-if="hasPieces" class="cft__row cft__row--top">
                <span class="cft__chips" role="group" aria-label="新建单品选区">
                  <button
                    v-for="r in pieceRefs"
                    :key="r.key"
                    type="button"
                    class="cft__piece sx-hit"
                    :class="{ 'is-failed': pieceFailed(r) }"
                    :aria-label="pieceFailed(r) ? `${r.label}，识别失败` : r.label"
                    @click="pickPiece(r)"
                  >
                    <img class="cft__thumb" :src="r.url" alt="" draggable="false" loading="lazy" />
                    {{ r.label }}
                    <em v-if="pieceFailed(r)" class="cft__fail">识别失败</em>
                  </button>
                </span>
              </div>
            </template>

            <p v-if="!pixelLayer && (maskBusy || maskHint)" class="cft__note cft__note--row" role="status" aria-live="polite">
              <span class="cft__note-text">{{ maskBusy ? maskBusyHint || '正在识别选区…' : maskHint }}</span>
              <button v-if="!maskBusy && maskRetry" type="button" class="cft__btn sx-hit" @click="emit('retryMask')">重试</button>
            </p>
            <div v-if="!pixelLayer && !maskBusy && maskHint && maskActions.length" class="cft__fixes" role="group" aria-label="改用其他选区方式">
              <button v-for="a in maskActions" :key="a.key" type="button" class="cft__btn sx-hit" @click="emit('maskAction', a.key)">
                {{ a.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 调整 -->
        <div v-show="tab === 'adjust'" id="cft-pane-adjust" role="tabpanel" aria-labelledby="cft-tab-adjust" class="cft__pane">
          <div v-if="pixelLayer" class="cft__pixel" role="note">
            <b>{{ slidersTitle || '像素层' }}</b>
            <p>像素层是「向下合并」得到的成品像素，没有可调的参数；想改颜色，可在它上面添加新的选区图层，或撤销合并后再调整。</p>
            <p v-if="pixelNote" class="cft__pixel-warn">{{ pixelNote }}</p>
          </div>
          <template v-else>
            <p v-if="slidersTitle" class="cft__subtitle">{{ slidersTitle }}</p>
            <div class="cft__sliders">
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
            <slot name="adjust" />
            <div class="cft__sec" role="group" aria-label="替换为目标颜色">
              <div class="cft__row">
                <span class="cft__label cft__label--wide">替换颜色</span>
                <button
                  type="button"
                  role="switch"
                  class="cft__switch sx-hit"
                  :class="{ 'is-on': recolorOn }"
                  :aria-checked="recolorOn"
                  aria-label="替换为目标颜色"
                  @click="toggleRecolor"
                >
                  <i aria-hidden="true" />
                </button>
                <span class="cft__note-text cft__soft">{{ recolorOn ? '保留明暗纹理，只换颜色' : '把这一层里的主色换成指定颜色' }}</span>
              </div>
              <template v-if="recolor">
                <div class="cft__row">
                  <span class="cft__label">源色</span>
                  <span
                    class="cft__swatch is-big"
                    :style="{ background: sourceShown || undefined }"
                    :class="{ 'is-empty': !sourceShown }"
                    role="img"
                    :aria-label="sourceShown ? `源色 ${sourceShown}` : '源色：选区未就绪'"
                    :title="recolor.source ? `吸取的源色 ${recolor.source}` : sourceShown ? `自动：选区主色 ${sourceShown}` : '选区就绪后自动取主色'"
                  />
                  <button
                    type="button"
                    class="cft__chip cft__chip--sm sx-hit"
                    :class="{ 'is-on': recolor.source === null }"
                    :aria-pressed="recolor.source === null"
                    title="自动：取选区里面积最大的颜色"
                    @click="setRecolor({ source: null })"
                  >
                    自动
                  </button>
                  <IconButton label="从图上吸取源色" size="sm" variant="quiet" @click="emit('pickSource')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m2 22 1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
                    </svg>
                  </IconButton>
                  <span class="cft__arrow" aria-hidden="true">→</span>
                  <span class="cft__swatch is-big" :style="{ background: recolor.target }" role="img" :aria-label="`目标色 ${recolor.target}`" />
                  <span class="cft__picker" title="更多颜色" aria-label="更多目标颜色（取色器）" role="group">
                    <n-color-picker
                      size="small"
                      :value="recolor.target"
                      :show-alpha="false"
                      :modes="['hex']"
                      :swatches="SWATCHES.map((s) => s.hex)"
                      :render-label="() => ''"
                      @update:value="(v: string) => { const h = normalizeHex(v); if (h) setRecolor({ target: h }) }"
                    />
                  </span>
                </div>
                <div class="cft__row">
                  <span class="cft__label">目标</span>
                  <span class="cft__swatches" role="radiogroup" aria-label="常用目标色">
                    <button
                      v-for="sw in SWATCHES"
                      :key="sw.hex"
                      type="button"
                      role="radio"
                      class="cft__swatch sx-hit"
                      :class="{ 'is-on': recolor.target === sw.hex }"
                      :style="{ background: sw.hex }"
                      :aria-checked="recolor.target === sw.hex"
                      :aria-label="`目标色：${sw.name}`"
                      :title="sw.name"
                      @click="setRecolor({ target: sw.hex })"
                    />
                  </span>
                </div>
                <div class="cft__row">
                  <span class="cft__label" />
                  <input
                    v-model="hexDraft"
                    class="cft__hex"
                    type="text"
                    maxlength="7"
                    spellcheck="false"
                    aria-label="目标颜色十六进制，如 #2f6db5"
                    placeholder="#2f6db5"
                    @keydown.enter.prevent="commitHex"
                    @blur="commitHex"
                  />
                  <span class="cft__label cft__label--soft">强度</span>
                  <input
                    class="cft__range"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    :value="recolor.strength"
                    aria-label="替换强度"
                    @input="setRecolor({ strength: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <b class="cft__num cft__num--wide" aria-hidden="true">{{ recolor.strength }}</b>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>

      <footer class="cft__foot">
        <span class="cft__hint">参数只作用于当前结果，可随时恢复默认</span>
        <button type="button" class="cft__btn sx-hit" :disabled="!valuesMoved" @click="reset">恢复默认</button>
        <button type="button" class="cft__btn is-primary sx-hit" @click="emit('done')">完成</button>
      </footer>
    </section>
  </Transition>
</template>

<style scoped lang="less">
.cft {
  position: absolute;
  z-index: 20;
  display: flex;
  width: 364px;
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--xq-line);
  border-radius: 13px;
  background: rgb(var(--xq-overlay-rgb) / 0.97);
  box-shadow:
    0 18px 40px -16px rgb(var(--xq-ink-rgb) / 0.32),
    0 4px 12px rgb(var(--xq-ink-rgb) / 0.1);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  transition: box-shadow 0.16s ease;
}
.cft:not(.is-placed) {
  visibility: hidden;
}
.cft.is-dragging {
  box-shadow:
    0 24px 50px -18px rgb(var(--xq-ink-rgb) / 0.38),
    0 6px 16px rgb(var(--xq-ink-rgb) / 0.12);
}
.cft-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cft-leave-active {
  transition: opacity 0.12s ease;
}
.cft-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.99);
}
.cft-leave-to {
  opacity: 0;
}

.cft__head {
  display: flex;
  height: 40px;
  flex: 0 0 40px;
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--xq-line);
  cursor: grab;
  touch-action: none;
}
.cft.is-dragging .cft__head {
  cursor: grabbing;
}
.cft__grip {
  display: grid;
  grid-template-columns: repeat(2, 3px);
  gap: 2px;
  margin-right: 1px;
}
.cft__grip i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--xq-violet-line);
}
.cft__title {
  min-width: 0;
  flex: 1;
  color: var(--xq-ink);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.cft__close {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--xq-placeholder);
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.cft__close svg {
  width: 14px;
  height: 14px;
}
.cft__close:hover {
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
}
.cft__close:focus-visible,
.cft__btn:focus-visible,
.cft__tab:focus-visible,
.cft__seg-btn:focus-visible,
.cft__chip:focus-visible,
.cft__piece:focus-visible,
.cft__part:focus-visible,
.cft__switch:focus-visible,
.cft__swatch:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
}

/* 当前图层行 */
.cft__cur {
  display: flex;
  flex: 0 0 auto;
  min-height: 36px;
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 12px;
  cursor: default;
}
.cft__cur-label {
  color: var(--xq-muted);
  font-size: 11px;
}
.cft__cur-name {
  min-width: 0;
  overflow: hidden;
  color: var(--xq-ink);
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cft__cur-count {
  flex: none;
  color: var(--xq-placeholder);
  font-size: 11px;
}
.cft__status {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font-size: 11px;
  line-height: 18px;
}
.cft__status.is-warn {
  background: var(--xq-warning-soft, var(--xq-surface3));
  color: var(--xq-warning-fg);
}
.cft__spacer {
  flex: 1;
}

/* 页签：分段，选中 = 藤紫软底 */
.cft__tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  margin: 0 12px 8px;
  padding: 2px;
  border: 1px solid var(--xq-line);
  border-radius: 9px;
  background: var(--xq-sunken);
}
.cft__tab {
  height: 26px;
  flex: 1;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--xq-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.cft__tab:hover:not(.is-on) {
  color: var(--xq-ink);
}
.cft__tab.is-on {
  border-color: var(--xq-violet-line);
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font-weight: 600;
}

/* 页签内容：中间滚动，头尾固定 */
.cft__body {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: 1px dashed var(--xq-line);
  cursor: default;
}
.cft__pane {
  display: flex;
  flex-direction: column;
}
/* 图层 / 更多调整两个子组件自带 12px 侧边距与底部虚线；页签里最后一块不再要分隔线 */
.cft__pane :deep(.cfl),
.cft__pane :deep(.cfa) {
  border-bottom: 0;
}
.cft__sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 12px;
  padding: 9px 0 8px;
}
.cft__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.cft__row--top {
  align-items: flex-start;
}
.cft__label {
  width: 30px;
  flex: 0 0 30px;
  color: var(--xq-ink-2);
  font-size: 11.5px;
  font-weight: 500;
}
.cft__label--soft {
  width: auto;
  flex: 0 0 auto;
  margin-left: 6px;
}
.cft__label--wide {
  width: auto;
  flex: 0 0 auto;
}
.cft__seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--xq-line);
  border-radius: 9px;
  background: var(--xq-sunken);
}
.cft__seg-btn,
.cft__chip {
  height: 28px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--xq-muted);
  font: inherit;
  font-size: 12px;
  line-height: 26px;
  white-space: nowrap;
  cursor: pointer;
}
.cft__seg-btn[aria-disabled='true'] {
  color: var(--xq-control-hover);
  cursor: not-allowed;
}
.cft__seg-btn.is-on {
  border-color: var(--xq-violet-line);
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font-weight: 600;
}
.cft__chips {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}
.cft__chip,
.cft__piece,
.cft__part {
  border: 1px solid var(--xq-line);
  background: var(--xq-surface);
}
.cft__chip {
  border-radius: 14px;
}
.cft__chip.is-on,
.cft__piece.is-on,
.cft__part.is-on {
  border-color: var(--xq-violet);
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font-weight: 600;
}
.cft__chip--more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border-style: dashed;
}
.cft__chip--more svg {
  width: 12px;
  height: 12px;
  transition: transform 0.12s ease;
}
.cft__chip--more svg.is-open {
  transform: rotate(180deg);
}
.cft__chip--sm {
  height: 24px;
  padding: 0 8px;
  line-height: 22px;
}
/* 单品 chip：24 圆角缩略图 + 件名；识别失败的在名字后常驻警示 */
.cft__piece {
  display: inline-flex;
  height: 30px;
  box-sizing: border-box;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 3px;
  border-radius: 15px;
  color: var(--xq-muted);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.12s ease;
}
.cft__piece:hover:not(.is-on) {
  border-color: var(--xq-control);
}
.cft__piece.is-failed:not(.is-on) {
  border-color: var(--xq-warning-fg);
}
.cft__thumb {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 6px;
  background: var(--xq-surface3);
  object-fit: cover;
}
.cft__fail,
.cft__busy {
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
}
.cft__fail {
  color: var(--xq-warning-fg);
}
.cft__busy {
  color: var(--xq-placeholder);
}
.cft__part {
  height: 24px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 12px;
  color: var(--xq-muted);
  font: inherit;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
}
.cft__switch {
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
.cft__switch i {
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
.cft__switch.is-on {
  background: var(--xq-violet);
}
.cft__switch.is-on i {
  transform: translateX(12px);
}
.cft__range {
  min-width: 0;
  flex: 1;
  accent-color: var(--xq-violet);
}
.cft__num {
  width: 18px;
  color: var(--xq-violet-ink);
  font-size: 11px;
  text-align: right;
}
.cft__num--wide {
  width: 24px;
}
.cft__note {
  margin: 0;
  color: var(--xq-placeholder);
  font-size: 11px;
  line-height: 16px;
}
.cft__note--row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cft__note-text {
  min-width: 0;
  flex: 1;
}
.cft__soft {
  color: var(--xq-placeholder);
  font-size: 11px;
}
.cft__fixes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cft__swatches {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}
.cft__swatch {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  box-sizing: border-box;
  padding: 0;
  border: 1px solid rgb(var(--xq-ink-rgb) / 0.14);
  border-radius: 50%;
  cursor: pointer;
}
.cft__swatch.is-big {
  width: 26px;
  height: 26px;
  flex-basis: 26px;
  border-radius: 7px;
  cursor: default;
}
.cft__swatch.is-empty {
  background: repeating-conic-gradient(var(--xq-checker-b) 0% 25%, var(--xq-checker-a) 0% 50%) 0 0 / 8px 8px;
}
.cft__swatch.is-on {
  outline: 2px solid var(--xq-violet);
  outline-offset: 2px;
}
.cft__arrow {
  color: var(--xq-placeholder);
  font-size: 13px;
}
.cft__picker {
  width: 32px;
  flex: 0 0 32px;
}
.cft__picker :deep(.n-color-picker) {
  width: 32px;
}
.cft__picker :deep(.n-color-picker__value) {
  display: none;
}
.cft__hex {
  width: 84px;
  height: 28px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--xq-line);
  border-radius: 7px;
  background: var(--xq-sunken);
  color: var(--xq-ink);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cft__hex:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: 1px;
}
.cft__subtitle {
  margin: 8px 12px 0;
  color: var(--xq-violet-ink);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 16px;
}
.cft__sliders {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 12px 4px;
}
.cft__pixel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 12px;
  padding: 8px 10px;
  border: 1px solid var(--xq-line);
  border-radius: 10px;
  background: var(--xq-surface2);
  color: var(--xq-ink-2);
  font-size: 11.5px;
  line-height: 1.55;
}
.cft__pixel b {
  color: var(--xq-ink);
  font-size: 12px;
}
.cft__pixel p {
  margin: 0;
}
.cft__pixel .cft__pixel-warn {
  color: var(--xq-warning-fg);
}

.cft__foot {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--xq-line);
  cursor: default;
}
.cft__hint {
  min-width: 0;
  flex: 1;
  color: var(--xq-placeholder);
  font-size: 11px;
  line-height: 16px;
}
.cft__btn {
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
.cft__btn:hover:not(:disabled) {
  border-color: var(--xq-control);
}
.cft__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cft__btn.is-primary {
  border-color: var(--xq-violet);
  background: linear-gradient(180deg, var(--xq-violet-top), var(--xq-violet-bottom));
  color: var(--xq-on-accent);
  font-weight: 600;
}
.cft__btn.is-primary:hover {
  filter: brightness(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .cft,
  .cft__close,
  .cft__tab,
  .cft__piece,
  .cft__switch,
  .cft__switch i,
  .cft__chip--more svg,
  .cft-enter-active,
  .cft-leave-active {
    transition: none;
  }
}
</style>
