<script setup lang="ts">
/**
 * 一行接好的校色参数台：ColorFixPanel（参数 + 选区）+ 手动涂抹弹窗，全部状态取自 useResultColorFix 的返回值。
 * 与 ColorFixPanel 一样 `position: absolute`，放在结果卡（relative）里。
 *
 * <p>`local-adjust=false` 关掉选区区块（只整图校色）。
 *
 * <p>全屏调色（cf.fullscreen）开着时：页面上这份整体让位（参数台、涂抹 / 点选弹窗都不渲染），由全屏层里
 * `docked` 的那份接管——同一份 cf，两处不会同时各开一套弹窗。`large` = 涂抹 / 点选弹窗铺到接近整屏。
 */
import { computed, defineAsyncComponent, watch } from 'vue'
import ColorFixPanel from '@/views/tools/ColorFixPanel.vue'
import ColorFixMaskPainter from './ColorFixMaskPainter.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import type { ColorFixSegmentSuggestion } from './segment.ts'
import { COLORFIX_MASK_LOAD_FAILED } from '@/utils/colorfix.ts'
import { schedulePointSegmentPrefetch } from './point-support.ts'

/** 点选弹窗（含本机分割模型）懒加载：选「点选」之前不下载这块代码 */
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
  /** 显示「选区」（局部调色）区块 */
  localAdjust?: boolean
  /** 停靠在全屏调色右栏（ColorFixFullscreen 用） */
  docked?: boolean
  /** 涂抹 / 点选弹窗用大尺寸（全屏调色里） */
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

const maskHint = computed(() => {
  const r = cf.region.value
  if (r.mode === 'auto' && cf.maskError.value) return cf.maskError.value
  if (r.mode === 'paint' && !cf.paintedMask.value) return '还没有涂抹选区，点「涂抹选区」开始'
  if (r.mode === 'paint' && cf.paintedVolatile.value) return '选区较大，只在本次浏览中保留'
  if (r.mode === 'point' && !cf.pointMask.value) return cf.pointBlocked.value || '还没有点选选区，点「点选区域」开始'
  if (r.mode === 'point' && cf.pointVolatile.value) return '选区较大，只在本次浏览中保留'
  if (r.mode !== 'whole' && cf.failed.value)
    return cf.maskLoadFailed.value ? COLORFIX_MASK_LOAD_FAILED : '选区校色未能生成，已显示原图'
  return ''
})

const params = computed({ get: () => cf.params.value, set: (v) => cf.setParams(v) })
const region = computed({ get: () => cf.region.value, set: (v) => v && cf.setRegion(v) })
const painterShow = computed({ get: () => cf.painterOpen.value, set: (v) => cf.setPainterOpen(v) })
const pointShow = computed({ get: () => cf.pointOpen.value, set: (v) => cf.setPointOpen(v) })

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
  if (cf.region.value.mode !== 'auto' || !cf.maskError.value) return []
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
  <ColorFixPanel
    v-if="localAdjust"
    v-model="params"
    v-model:region="region"
    :open="panelOpen"
    :title="title"
    :region-modes="cf.regionModes.value"
    :auto-targets="cf.autoTargets.value"
    :garment-parts="cf.garmentParts.value"
    :mask-busy="cf.maskBusy.value"
    :mask-hint="maskHint"
    :has-painted="!!cf.paintedMask.value"
    :has-point="!!cf.pointMask.value"
    :point-blocked="cf.pointBlocked.value"
    :mask-busy-hint="maskBusyHint"
    :mask-retry="cf.region.value.mode === 'auto' && !!cf.maskError.value && cf.maskRetryable.value"
    :mask-actions="maskActions"
    @mask-action="onMaskAction"
    :docked="docked"
    @retry-mask="cf.retryMask()"
    @done="done"
    @reset="emit('reset')"
    @paint="cf.openPainter()"
    @point="cf.openPointSelect()"
  />
  <ColorFixPanel
    v-else
    v-model="params"
    :open="panelOpen"
    :title="title"
    :docked="docked"
    @done="done"
    @reset="emit('reset')"
  />
  <!-- key = 原图：换图（切记录 / 切候选）时重建弹窗，旧图的点 / 笔迹不会带到新图上 -->
  <ColorFixMaskPainter
    v-if="present && localAdjust && cf.src.value"
    :key="cf.src.value"
    v-model:show="painterShow"
    :src="cf.src.value"
    :large="large"
    @apply="cf.applyPaintedMask"
  />
  <PointSelect
    v-if="present && localAdjust && cf.src.value && pointShow"
    :key="cf.src.value"
    v-model:show="pointShow"
    :src="cf.src.value"
    :large="large"
    @apply="cf.applyPointMask"
  />
</template>
