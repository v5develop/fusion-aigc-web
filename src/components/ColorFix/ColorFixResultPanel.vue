<script setup lang="ts">
/**
 * 一行接好的校色参数台：ColorFixPanel（图层 + 选区 + 替换颜色 + 参数）+ 智能选区 / 涂抹弹窗 + 吸取源色弹窗，
 * 全部状态取自 useResultColorFix 的返回值。与 ColorFixPanel 一样 `position: absolute`，放在结果卡（relative）里。
 *
 * <p>`local-adjust=false` 关掉选区与图层（只整图校色，与旧版一致）。
 *
 * <p>图层（2026-11-11）：头部下方是图层列表（ColorFixLayerList），下面的选区 / 替换颜色 / 滑杆都改当前选中的那一层；
 * 选中「整图」底层时不出选区区块。手动涂抹与智能选区是同一个弹窗（PointSelect）：涂抹入口打开时预选画笔，
 * 并把这一层已有的选区垫在下面细化。
 *
 * <p>更多调整（2026-11-11；2026-11-12 起一律在五个滑杆之后）：折叠的「更多调整」（ColorFixAdjustments：白平衡 + HSL 分色），中性灰吸管复用
 * 吸取弹窗。图层满 8 层时添加 / 从整图进涂抹或智能选区会在图层列表里给提示（cf.capNotice）。
 *
 * <p>智能选区「继续编辑」：打开时按 cf.loadSelectionSession 取回这一层上次的编辑状态（点 / 框 / 形状 / 魔棒 / 笔画 /
 * 扩展收缩平滑），完成时连同会话一起存（cf.applyPointMask(blob, session)）。
 *
 * <p>全屏调色（cf.fullscreen）开着时：页面上这份整体让位（参数台、弹窗都不渲染），由全屏层里 `docked` 的那份接管——
 * 同一份 cf，两处不会同时各开一套弹窗。`large` = 弹窗铺到接近整屏。
 */
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import ColorFixPanel from '@/views/tools/ColorFixPanel.vue'
import ColorFixTabbedPanel from './ColorFixTabbedPanel.vue'
import ColorFixPeekButton from './ColorFixPeekButton.vue'
import ColorFixLayerList from './ColorFixLayerList.vue'
import ColorFixEyedropper from './ColorFixEyedropper.vue'
import ColorFixAdjustments from './ColorFixAdjustments.vue'
import ColorFixReferenceCard from './ColorFixReferenceCard.vue'
import { adjustZero, neutralGrayWB, parseHex, type ColorFixAdjust, type ColorFixHistogram } from '@/utils/colorfix-math.ts'
import type { ResultColorFix } from './useResultColorFix.ts'
import type { ColorFixSegmentSuggestion } from './segment.ts'
import { COLORFIX_MASK_LOAD_FAILED, COLORFIX_ZERO, colorFixHistogram } from '@/utils/colorfix.ts'
import { schedulePointSegmentPrefetch } from './point-support.ts'
import { isBaseLayer, type ColorFixRecolor } from './layers.ts'
import type { ColorFixRegion } from './types.ts'

/** 智能选区弹窗（含本机分割模型）懒加载：用到之前不下载这块代码 */
const PointSelect = defineAsyncComponent(() => import('./PointSelect.vue'))

const {
  cf,
  title = '图片校色',
  localAdjust = true,
  docked = false,
  large = false,
} = defineProps<{
  cf: ResultColorFix
  title?: string
  /** 显示「图层 / 选区」（局部调色）与替换颜色 */
  localAdjust?: boolean
  /** 停靠在全屏调色右栏（ColorFixFullscreen 用） */
  docked?: boolean
  /** 弹窗用大尺寸（全屏调色里） */
  large?: boolean
}>()

/** 这一份是否在场：全屏时只有停靠的那份在场 */
const present = computed(() => (docked ? cf.fullscreen.value : !cf.fullscreen.value))
const panelOpen = computed(() => present.value && !!cf.src.value && (docked || cf.panelOpen.value))
/** 识别中的提示：等了 15s 以上换成首次识别慢的说明 */
const maskBusyHint = computed(() =>
  cf.maskSlow.value ? '首次识别较慢，约需 1 分钟，可先调整其它参数' : '正在识别选区…',
)

const emit = defineEmits<{ done: []; reset: [] }>()

const onBase = computed(() => isBaseLayer(cf.selectedLayer.value))

const maskHint = computed(() => {
  if (onBase.value) return ''
  const r = cf.region.value
  if (r.mode === 'auto' && cf.maskError.value) return cf.maskError.value
  if (r.mode === 'paint' && !cf.paintedMask.value) return '还没有涂抹选区，点「涂抹选区」开始'
  if (r.mode === 'paint' && cf.paintedVolatile.value) return '选区较大，只在本次浏览中保留'
  if (r.mode === 'point' && !cf.pointMask.value) return cf.pointBlocked.value || '还没有选区，点「智能选区」开始'
  if (r.mode === 'point' && cf.pointVolatile.value) return '选区较大，只在本次浏览中保留'
  if (cf.failed.value) return cf.maskLoadFailed.value ? cf.loadFailedText.value || COLORFIX_MASK_LOAD_FAILED : '选区校色未能生成，已显示原图'
  return ''
})

const params = computed({ get: () => cf.params.value, set: (v) => cf.setParams(v) })
/** 选区：底层（整图）不出选区区块 → 传 undefined */
const region = computed<ColorFixRegion | undefined>({
  get: () => (onBase.value ? undefined : cf.region.value),
  set: (v) => v && cf.setRegion(v),
})
const recolor = computed<ColorFixRecolor | null>({
  get: () => cf.recolor.value,
  set: (v) => cf.setRecolor(v),
})
/** 选区图层不能选「整图」（那就是底层） */
const layerModes = computed(() => cf.regionModes.value.filter((m) => m !== 'whole'))
const panelDefaults = computed(() => (onBase.value ? cf.defaults : COLORFIX_ZERO))
const slidersTitle = computed(() =>
  cf.selectedIsPixel.value
    ? cf.selectedLayer.value.name
    : cf.layers.value.length > 1
      ? `调整「${cf.selectedLayer.value.name}」`
      : '',
)
/** 像素层的补充说明：只在内存 / 本机数据丢了（刷新、被清、这张图不是合并时的那张） */
const pixelNote = computed(() => {
  if (!cf.selectedIsPixel.value) return ''
  if (cf.layerStatus(cf.selectedLayer.value) === 'error') return '这张图在本机没有这一层的像素数据（已被清理，或不是合并时的那张图），导出会被拒绝；可删除这一层。'
  return cf.selectedPixelVolatile.value ? '这一层较大或本机存储不可用，只在本次浏览中保留。' : ''
})

const painterShow = computed({ get: () => cf.painterOpen.value, set: (v) => cf.setPainterOpen(v) })
const pointShow = computed({ get: () => cf.pointOpen.value, set: (v) => cf.setPointOpen(v) })
const pickerShow = ref(false)
/** 中性灰吸管（更多调整 · 白平衡） */
const neutralShow = ref(false)
watch(present, (v) => {
  if (!v) {
    pickerShow.value = false
    neutralShow.value = false
  }
})
function onPickSource(hex: string) {
  const r = cf.recolor.value
  if (r) cf.setRecolor({ ...r, source: hex })
}
const adjust = computed<ColorFixAdjust | null>({
  get: () => cf.adjust.value,
  set: (v) => cf.setAdjust(v),
})
/**
 * 中性灰：按原图像素算色温 / 色调（选区图层下面若还有别的层改过颜色，这里按原图算，可能要再微调）
 */
function onPickNeutral(hex: string) {
  const rgb = parseHex(hex)
  if (!rgb) return
  const wb = neutralGrayWB(rgb[0], rgb[1], rgb[2])
  const cur = cf.adjust.value ?? adjustZero()
  cf.setAdjust({ ...cur, hsl: cur.hsl.map((b) => ({ ...b })), temp: wb.temp, tint: wb.tint })
}

/**
 * 色阶 / 曲线的底图：选中图层范围内的原图直方图（底层 = 整图，选区图层 = 它的蒙版内，蒙版没就绪时不画）。
 * 按原图算——下面若还有别的层改过颜色，这里看到的是原图分布。
 */
const histogram = ref<ColorFixHistogram | null>(null)
let histTicket = 0
watch(
  () => {
    const l = cf.selectedLayer.value
    return [panelOpen.value && localAdjust, cf.src.value, isBaseLayer(l), cf.effectiveMask.value, l.region.invert] as const
  },
  async ([want, image, base, mask, invert]) => {
    const my = ++histTicket
    if (!want || !image || (!base && !mask)) {
      histogram.value = null
      return
    }
    const h = await colorFixHistogram(image, base ? null : mask, !base && invert)
    if (my === histTicket) histogram.value = h
  },
  { immediate: true },
)

// 参数台打开且提供「点选」：空闲时预取点选的引擎与模型（本会话一次）
watch(
  () => panelOpen.value && localAdjust && cf.regionModes.value.includes('point') && !cf.pointBlocked.value,
  (yes) => {
    if (yes) schedulePointSegmentPrefetch()
  },
  { immediate: true },
)

// ---------------- 识别没结果时的替代方式（4001：换人物 / 点选 / 手动涂抹） ----------------

const SUGGEST_LABELS: Record<ColorFixSegmentSuggestion, string> = {
  person: '改用「人物」',
  point: '改用「点选」',
  paint: '改用「手动涂抹」',
}
const maskActions = computed(() => {
  if (onBase.value || cf.region.value.mode !== 'auto' || !cf.maskError.value) return []
  return cf.maskSuggest.value
    .filter((k) => {
      if (k === 'person') return cf.region.value.target !== 'person' && cf.autoTargets.value.includes('person')
      if (k === 'point') return cf.regionModes.value.includes('point') && !cf.pointBlocked.value
      return cf.regionModes.value.includes('paint')
    })
    .map((k) => ({ key: k, label: SUGGEST_LABELS[k] }))
})
function onMaskAction(key: string) {
  const r = cf.region.value
  if (key === 'person') cf.setRegion({ ...r, target: 'person', parts: [] })
  else if (key === 'point') {
    cf.setRegion({ ...r, mode: 'point' })
    cf.openPointSelect()
  } else if (key === 'paint') {
    cf.setRegion({ ...r, mode: 'paint' })
    if (!cf.paintedMask.value) cf.openPainter()
  }
}

function done() {
  cf.close()
  emit('done')
}
</script>

<template>
  <component
    :is="docked ? ColorFixPanel : ColorFixTabbedPanel"
    v-if="localAdjust"
    :cf="cf"
    v-model="params"
    v-model:region="region"
    v-model:recolor="recolor"
    :open="panelOpen"
    :title="title"
    :defaults="panelDefaults"
    :region-modes="layerModes"
    :auto-targets="cf.autoTargets.value"
    :garment-parts="cf.garmentParts.value"
    :mask-busy="cf.maskBusy.value"
    :mask-hint="maskHint"
    :has-painted="!!cf.paintedMask.value"
    :has-point="!!cf.pointMask.value"
    :point-blocked="cf.pointBlocked.value"
    :mask-busy-hint="maskBusyHint"
    :mask-retry="!onBase && cf.region.value.mode === 'auto' && !!cf.maskError.value && cf.maskRetryable.value"
    :mask-actions="maskActions"
    :docked="docked"
    recolor-enabled
    :recolor-auto-source="cf.recolorAutoSource.value"
    :sliders-title="slidersTitle"
    :pixel-layer="cf.selectedIsPixel.value"
    :pixel-note="pixelNote"
    @mask-action="onMaskAction"
    @retry-mask="cf.retryMask()"
    @done="done"
    @reset="emit('reset')"
    @paint="cf.openPainter()"
    @point="cf.openPointSelect()"
    @pick-source="pickerShow = true"
  >
    <template #head-extra>
      <ColorFixPeekButton :cf="cf" class="ml-auto" />
    </template>
    <template #layers>
      <ColorFixLayerList :cf="cf" :docked="docked" />
    </template>
    <template #adjust>
      <ColorFixAdjustments v-model="adjust" :docked="docked" :histogram="histogram" @pick-neutral="neutralShow = true" />
    </template>
  </component>
  <ColorFixPanel
    v-else
    v-model="params"
    :open="panelOpen"
    :title="title"
    :docked="docked"
    @done="done"
    @reset="emit('reset')"
  >
    <template #head-extra>
      <ColorFixPeekButton :cf="cf" class="ml-auto" />
    </template>
  </ColorFixPanel>
  <!-- 参考图浮卡（宿主传了 references 才有）：页面上的参数台开着时浮在结果卡左上；全屏时由全屏层自己放 -->
  <ColorFixReferenceCard v-if="!docked && panelOpen && cf.references.value.length" :cf="cf" />
  <!-- key = 原图 + 图层：换图 / 换层时重建弹窗，旧的点 / 笔迹不会带过去 -->
  <PointSelect
    v-if="present && localAdjust && cf.src.value && painterShow"
    :key="`paint|${cf.src.value}|${cf.selectedLayerId.value}`"
    v-model:show="painterShow"
    :src="cf.src.value"
    :large="large"
    title="涂抹调色选区"
    initial-tool="brush"
    :sam-disabled="!!cf.pointBlocked.value"
    :base-mask="cf.paintedMask.value"
    :session-loader="() => cf.loadSelectionSession('paint')"
    @apply="cf.applyPaintedMask"
  />
  <PointSelect
    v-if="present && localAdjust && cf.src.value && pointShow"
    :key="`point|${cf.src.value}|${cf.selectedLayerId.value}`"
    v-model:show="pointShow"
    :src="cf.src.value"
    :large="large"
    :base-mask="cf.pointMask.value"
    :session-loader="() => cf.loadSelectionSession('point')"
    @apply="cf.applyPointMask"
  />
  <ColorFixEyedropper
    v-if="present && localAdjust && cf.src.value && pickerShow"
    v-model:show="pickerShow"
    :src="cf.src.value"
    @pick="onPickSource"
  />
  <ColorFixEyedropper
    v-if="present && localAdjust && cf.src.value && neutralShow"
    v-model:show="neutralShow"
    :src="cf.src.value"
    title="中性灰吸管"
    hint="单击图上本该是灰色 / 白色的地方（如白衬衫、灰墙），自动算出让它变成中性灰的色温与色调。方向键可微调位置，回车取色。"
    @pick="onPickNeutral"
  />
</template>
