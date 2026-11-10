<script setup lang="ts">
/**
 * 一行接好的校色参数台：ColorFixPanel（参数 + 选区）+ 手动涂抹弹窗，全部状态取自 useResultColorFix 的返回值。
 * 与 ColorFixPanel 一样 `position: absolute`，放在结果卡（relative）里。
 *
 * <p>`local-adjust=false` 关掉选区区块（只整图校色）。
 */
import { computed, defineAsyncComponent } from 'vue'
import ColorFixPanel from '@/views/tools/ColorFixPanel.vue'
import ColorFixMaskPainter from './ColorFixMaskPainter.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import { COLORFIX_MASK_LOAD_FAILED } from '@/utils/colorfix.ts'

/** 点选弹窗（含本机分割模型）懒加载：选「点选」之前不下载这块代码 */
const PointSelect = defineAsyncComponent(() => import('./PointSelect.vue'))

const {
  cf,
  title = '图片校色',
  localAdjust = true,
} = defineProps<{
  cf: ResultColorFix
  title?: string
  /** 显示「选区」（局部调色）区块 */
  localAdjust?: boolean
}>()

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
    :open="cf.panelOpen.value && !!cf.src.value"
    :title="title"
    :region-modes="cf.regionModes.value"
    :auto-targets="cf.autoTargets.value"
    :garment-parts="cf.garmentParts.value"
    :mask-busy="cf.maskBusy.value"
    :mask-hint="maskHint"
    :has-painted="!!cf.paintedMask.value"
    :has-point="!!cf.pointMask.value"
    :point-blocked="cf.pointBlocked.value"
    @done="done"
    @reset="emit('reset')"
    @paint="cf.openPainter()"
    @point="cf.openPointSelect()"
  />
  <ColorFixPanel
    v-else
    v-model="params"
    :open="cf.panelOpen.value && !!cf.src.value"
    :title="title"
    @done="done"
    @reset="emit('reset')"
  />
  <!-- key = 原图：换图（切记录 / 切候选）时重建弹窗，旧图的点 / 笔迹不会带到新图上 -->
  <ColorFixMaskPainter
    v-if="localAdjust && cf.src.value"
    :key="cf.src.value"
    v-model:show="painterShow"
    :src="cf.src.value"
    @apply="cf.applyPaintedMask"
  />
  <PointSelect
    v-if="localAdjust && cf.src.value && pointShow"
    :key="cf.src.value"
    v-model:show="pointShow"
    :src="cf.src.value"
    @apply="cf.applyPointMask"
  />
</template>
