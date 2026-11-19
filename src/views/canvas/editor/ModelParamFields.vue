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
import ModelPickerRow from './ModelPickerRow.vue'

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
/** 画质档：xhigh / max 是 GPT Image 2.5 / 2.6 在 high 之上的档（后端目录追加在末尾），按档位从高到低展示 */
const QUALITY_LABELS: Record<string, string> = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '极致' }
const QUALITY_RANK = ['max', 'xhigh', 'high', 'medium', 'low']
const qualityRank = (value: string) => {
  const i = QUALITY_RANK.indexOf(value)
  return i < 0 ? QUALITY_RANK.length : i
}
const qualityOptions = computed(() => {
  const list = currentModel.value?.qualities?.length ? currentModel.value.qualities : ['low', 'medium', 'high']
  return [...list]
    .sort((a, b) => qualityRank(a) - qualityRank(b))
    .map((value) => ({ label: QUALITY_LABELS[value] ?? value, value }))
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

/**
 * 列数：图片的比例 / 分辨率 / 质量 / 数量排在同一行（有几项排几列，最多 4），不让「质量」单独掉到第二行像错位；
 * 视频项多（时长 / 声音），保持 3 列两行。
 */
const columns = computed(() => {
  if (isVideo.value) return 3
  const cells = 2 + (capabilities.value.quality ? 1 : 0) + (capabilities.value.count ? 1 : 0)
  return Math.min(4, cells)
})
const GRID_COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }
const SPAN_ALL: Record<number, string> = { 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4' }

/** 小标签：11px muted（与控制台同款，读屏也靠它命名） */
const LABEL = 'block mb-2px text-muted text-11px leading-16px'
</script>

<template>
  <div
    class="grid gap-x-6px gap-y-6px nodrag nopan nowheel"
    :class="GRID_COLS[columns]"
    role="group"
    aria-label="生成参数"
    data-node-params
    @pointerdown.stop="store.selectNode(nodeId)"
    @dblclick.stop
  >
    <!-- 模型行：整行宽，排在比例 / 分辨率之上（选择逻辑与控制台共用 store.changeModel） -->
    <div class="min-w-0" :class="SPAN_ALL[columns]">
      <ModelPickerRow :node-id="nodeId" :data="data" :disabled="disabled" />
    </div>
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
    <div v-if="capabilities.quality" class="min-w-0">
      <span :class="LABEL" title="画质越高越清晰，点数越多">质量</span>
      <n-select
        :value="data.quality"
        size="small"
        :disabled="disabled"
        :options="qualityOptions"
        title="画质越高越清晰，点数越多"
        :consistent-menu-width="false"
        @update:value="(value: string) => patch({ quality: value })"
      />
    </div>
    <!--
      数量：图片排在质量之后（同一行），视频排第二行。上限为 1 时也画成与下拉同高、同描边圆角的只读框（禁用态），
      不再是一行纯文字——否则四格框体高度 / 基线对不齐。标签统一只写「数量」，上限放进悬停提示，免得标签被截断。
    -->
    <div v-if="capabilities.count" class="min-w-0">
      <span :class="LABEL">数量</span>
      <n-tooltip placement="top">
        <template #trigger>
          <div class="min-w-0">
            <n-input
              v-if="countMax <= 1"
              value="1 张"
              size="small"
              disabled
              :input-props="{ 'aria-label': '数量：固定 1 张' }"
            />
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
        </template>
        {{ countMax <= 1 ? '该模型每次固定生成 1 张' : `每次最多生成 ${countMax} 张` }}
      </n-tooltip>
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
