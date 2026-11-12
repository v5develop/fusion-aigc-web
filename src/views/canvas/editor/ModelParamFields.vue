<script setup lang="ts">
/**
 * 生成卡参数行（2026-11-12 原型「参数上卡」；比例 / 尺寸 / 数量，视频另有时长 / 声音，模型声明了质量能力才出质量）。
 * 选项与上限只取自后端目录里当前模型的配置（ratios / sizes / durations / qualities / countMax / capabilities），
 * 不搬原型里写死的常量——例如 Nano Banana 2.1 数量上限 1，就只能选 1。
 * 参数写回节点 data（store.updateNodeData，撤销栈照常合并）；节点排队 / 运行中整行禁用，防止跑着改参。
 * 下拉走 naive 默认的 portal（挂 body），不被卡片 overflow 裁；控件带 nodrag / nopan / nowheel，不触发节点拖动与画布平移。
 */
import { computed } from 'vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasNodeData } from './types.ts'

const props = defineProps<{ nodeId: string; data: CanvasNodeData }>()

const store = useCanvasEditor()

const isVideo = computed(() => props.data.kind === 'video')
const disabled = computed(() => props.data.status === 'running' || props.data.status === 'queued')

const currentModel = computed(() => {
  const catalog = store.catalog.value
  const list = isVideo.value ? catalog?.video_models : catalog?.imageModels
  return (
    list?.find((item) => item.modelId === props.data.modelId) ?? list?.find((item) => item.model === props.data.model)
  )
})
const capabilities = computed(() => props.data.capabilities ?? {})

/** 目录没给时的兜底与原控制台一致；有目录一律以目录为准 */
const ratioOptions = computed(() =>
  (currentModel.value?.ratios ?? ['1:1', '3:4', '4:3', '9:16', '16:9']).map((value) => ({ label: value, value })),
)
const sizeOptions = computed(() =>
  (currentModel.value?.sizes ?? (isVideo.value ? ['720p', '1080p'] : ['1K', '2K'])).map((value) => ({
    label: value,
    value,
  })),
)
const qualityOptions = computed(() => {
  const list = currentModel.value?.qualities?.length ? currentModel.value.qualities : ['low', 'medium', 'high']
  return list.map((value) => ({ label: { low: '低', medium: '中', high: '高' }[value] ?? value, value }))
})
const durationOptions = computed(() =>
  (currentModel.value?.durations ?? ['4s', '6s', '8s']).map((value) => ({ label: value, value })),
)
const countMax = computed(() => Math.max(1, currentModel.value?.countMax ?? (isVideo.value ? 1 : 4)))

/** 旧快照的数量可能超过当前模型上限：只在显示时夹紧，不改写快照 */
const shownCount = computed(() => Math.min(countMax.value, Math.max(1, Math.round(Number(props.data.count) || 1))))

function patch(values: Record<string, unknown>) {
  store.updateNodeData(props.nodeId, values)
}

/** 小标签：11px muted（与控制台同款，读屏也靠它命名） */
const LABEL = 'block mb-2px text-muted text-11px leading-16px'
</script>

<template>
  <div
    class="grid grid-cols-3 gap-x-6px gap-y-6px nodrag nopan nowheel"
    role="group"
    aria-label="生成参数"
    data-node-params
    @pointerdown.stop
    @dblclick.stop
  >
    <div class="min-w-0">
      <span :class="LABEL">比例</span>
      <n-select
        :value="data.ratio"
        size="small"
        :disabled="disabled"
        :options="ratioOptions"
        :consistent-menu-width="false"
        @update:value="(value: string) => patch({ ratio: value })"
      />
    </div>
    <div class="min-w-0">
      <span :class="LABEL">分辨率</span>
      <n-select
        :value="data.size"
        size="small"
        :disabled="disabled"
        :options="sizeOptions"
        :consistent-menu-width="false"
        @update:value="(value: string) => patch({ size: value })"
      />
    </div>
    <div v-if="isVideo && capabilities.duration" class="min-w-0">
      <span :class="LABEL">时长</span>
      <n-select
        :value="data.duration"
        size="small"
        :disabled="disabled"
        :options="durationOptions"
        :consistent-menu-width="false"
        @update:value="(value: string) => patch({ duration: value })"
      />
    </div>
    <!-- 数量：图片排第三格，视频排第二行；上限为 1 时没有可选项，直接写「固定 1 张」 -->
    <div v-if="capabilities.count" class="min-w-0">
      <span :class="LABEL">数量{{ countMax > 1 ? `（≤${countMax}）` : '' }}</span>
      <div v-if="countMax <= 1" class="flex h-28px items-center text-ink-2 text-12px">固定 1 张</div>
      <n-input-number
        v-else
        :value="shownCount"
        class="w-full"
        size="small"
        :min="1"
        :max="countMax"
        :precision="0"
        :disabled="disabled"
        :input-props="{ 'aria-label': '数量' }"
        @update:value="(value: number | null) => patch({ count: value ?? 1 })"
      />
    </div>
    <div v-if="capabilities.quality" class="min-w-0">
      <span :class="LABEL">质量</span>
      <n-select
        :value="data.quality"
        size="small"
        :disabled="disabled"
        :options="qualityOptions"
        :consistent-menu-width="false"
        @update:value="(value: string) => patch({ quality: value })"
      />
    </div>
    <div v-if="isVideo && capabilities.sound" class="min-w-0">
      <span :class="LABEL">声音</span>
      <div class="flex h-28px items-center">
        <n-switch
          :value="data.sound ?? true"
          size="small"
          :disabled="disabled"
          aria-label="声音"
          @update:value="(value: boolean) => patch({ sound: value })"
        />
      </div>
    </div>
  </div>
</template>
