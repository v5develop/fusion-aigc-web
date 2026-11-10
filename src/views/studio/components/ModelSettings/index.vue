<script setup lang="ts">
/**
 * 三个工作台共用的生图参数：生图模型 / 目标分辨率 / 画幅比例 / 张数（张数可选）。
 *
 * <p>外观交给共用的 CreationSettingsRow（原型底部「模型 通用 ▾ | 图片设置 3:4 · 1K · 1 张 ▾」两枚等宽按钮），
 * 两个弹层里分别放 CreationModelPicker 与 CreationImageSettings（与工具页、工作流页同一套胶囊）；
 * 这里只放工作室的选项与字段映射。展示名与传值分离：通用 / GPT Image 2.6 / GPT Image 2.5 / Nano Banana 2.1 / Seedream 5.5，
 * 传值 通用 / GPT / GPT25 / Banana / Seedream（GPT25 对用户显示 GPT Image 2.5，按张计费；旧档位值经 normalizeModelTier 归一）。tryon / pose 比例支持「自动」（空 = 按输入图比例取最近档，保留为可选档），
 * 三页默认都从 3:4 起（原型默认「3:4 · 1K · 1 张」）；imagegen 无自动档。没绑 v-model:count 就不出张数行（姿态复刻没有张数）。
 */
import { computed, watch } from 'vue'
import CreationSettingsRow from '@/components/creation/CreationSettingsRow.vue'
import CreationModelPicker from '@/components/creation/CreationModelPicker.vue'
import CreationImageSettings from '@/components/creation/CreationImageSettings.vue'
import {
  creationSettingsSummary,
  type CreationSettingsConfig,
  type CreationSettingsRowItem,
  type CreationSettingsValue,
} from '@/components/creation/types'
import { MODEL_OPTIONS, displayModelLabel, RESOLUTION_OPTIONS, ASPECT_RATIO_OPTIONS, COUNT_OPTIONS } from '../../constants.ts'
import type { StudioKind } from '@/api/studioTypes.ts'
import { useStudioModels } from './useStudioModels.ts'
import { normalizeModelTier } from '@/utils/modelLabel'

const { autoRatio = false, countLabel, countHint, disabled = false, kind } = defineProps<{
  /** 取模型档能力用的 kind；不传按 autoRatio 推断（有「自动」档 = tryon / pose，否则 imagegen） */
  kind?: StudioKind
  /** 提交中锁定两枚设置钮 */
  disabled?: boolean
  /** true 时比例含「自动」档（value ''，tryon / pose 用） */
  autoRatio?: boolean
  /** 张数行标签（商拍为「每位模特生成张数」）；不传用默认「生成张数」 */
  countLabel?: string
  /** 张数行下方的说明（商拍：「按模特算：每位模特各出这么多张」）；不传不显示 */
  countHint?: string
}>()

const model = defineModel<string>('model', { required: true })
const resolution = defineModel<string>('resolution', { required: true })
const aspectRatio = defineModel<string>('aspectRatio', { required: true })
const count = defineModel<number>('count')

// ---- 按模型档收窄选项（GET /studio/models；拿不到用 constants 写死的全集） ----
const caps = useStudioModels(kind ?? (autoRatio ? 'tryon' : 'imagegen'))
// 父组件回填了旧档位值（草稿 / 重新编辑）：就地改成现行值，下拉选中正确、下次提交发新值
watch(
  model,
  (v) => {
    const next = normalizeModelTier(v)
    if (next !== v) model.value = next
  },
  { immediate: true },
)
/** 模型列表：后端给了就用后端的展示名与顺序（不可用的档隐藏，当前选中的保留）；说明沿用前端文案 */
const modelOptions = computed(() => {
  if (!caps.value) return MODEL_OPTIONS
  return caps.value
    .filter((c) => c.available || c.code === model.value)
    .map((c) => ({
      label: displayModelLabel(c.label),
      value: c.code,
      description: MODEL_OPTIONS.find((o) => o.value === c.code)?.description ?? c.notes.join('；'),
    }))
})
const currentCap = computed(() => caps.value?.find((c) => c.code === model.value))
/** 只留后端声明支持的项；过滤后为空（口径对不上）时退回全集 */
function narrow<T extends { value: string }>(all: T[], allowed: string[] | undefined): T[] {
  if (!allowed) return all
  const out = all.filter((o) => allowed.includes(o.value))
  return out.length ? out : all
}
const resolutionOptions = computed(() => narrow(RESOLUTION_OPTIONS, currentCap.value?.resolutions))
const ratioOptions = computed(() => {
  const base = narrow(ASPECT_RATIO_OPTIONS, currentCap.value?.aspect_ratios)
  return autoRatio && (currentCap.value?.auto_aspect ?? true) ? [{ label: '自动', value: '' }, ...base] : base
})
// 换模型（或能力刚拉到）后，当前分辨率 / 比例不在新模型的可选项里：自动落到第一个可选项
watch(
  [resolutionOptions, ratioOptions],
  ([res, ratios]) => {
    const firstRes = res[0]
    if (firstRes && !res.some((o) => o.value === resolution.value)) resolution.value = firstRes.value
    const firstRatio = ratios[0]
    if (firstRatio && !ratios.some((o) => o.value === aspectRatio.value)) aspectRatio.value = firstRatio.value
  },
  { immediate: true },
)

const fields = computed<CreationSettingsConfig>(() => ({
  resolution: { options: resolutionOptions.value },
  aspectRatio: { options: ratioOptions.value },
  ...(count.value !== undefined ? { count: { options: COUNT_OPTIONS, label: countLabel, hint: countHint } } : {}),
}))

const settings = computed<CreationSettingsValue>({
  get: () => ({ resolution: resolution.value, aspectRatio: aspectRatio.value, count: count.value }),
  set: (v) => {
    resolution.value = String(v.resolution ?? '')
    aspectRatio.value = String(v.aspectRatio ?? '')
    if (count.value !== undefined && typeof v.count === 'number') count.value = v.count
  },
})

const rowItems = computed<CreationSettingsRowItem[]>(() => [
  {
    key: 'model',
    icon: 'sparkle',
    label: '模型',
    ariaLabel: '生成模型',
    value: modelOptions.value.find((o) => o.value === model.value)?.label ?? model.value,
  },
  { key: 'image', icon: 'gear', label: '图片设置', value: creationSettingsSummary(fields.value, settings.value) },
])
</script>

<template>
  <CreationSettingsRow :items="rowItems" :disabled="disabled">
    <template #model>
      <CreationModelPicker v-model="model" :options="modelOptions" hide-label />
    </template>
    <template #image>
      <CreationImageSettings v-model="settings" :fields="fields" />
    </template>
  </CreationSettingsRow>
</template>
