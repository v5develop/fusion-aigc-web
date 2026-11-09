<script setup lang="ts">
/**
 * 三个工作台共用的生图参数：生图模型 / 目标分辨率 / 画幅比例 / 张数（张数可选）。
 *
 * <p>外观交给共用的 CreationSettingsRow（原型底部「模型 通用 ▾ | 图片设置 3:4 · 1K · 1 张 ▾」两枚等宽按钮），
 * 两个弹层里分别放 CreationModelPicker 与 CreationImageSettings（与工具页、工作流页同一套胶囊）；
 * 这里只放工作室的选项与字段映射。展示名与传值分离：通用 / GPT Image 2.6 / GPT Image 2.5 / Nano Banana 2.1 Dev / Seedream 5.5，
 * 传值 通用 / GPT / GPT25Dev / Banana / Seedream（GPT25Dev = GPT Image 2.5 Sunburst Developer，按张计费）。tryon / pose 比例支持「自动」（空 = 按输入图比例取最近档，保留为可选档），
 * 三页默认都从 3:4 起（原型默认「3:4 · 1K · 1 张」）；imagegen 无自动档。没绑 v-model:count 就不出张数行（姿态复刻没有张数）。
 */
import { computed } from 'vue'
import CreationSettingsRow from '@/components/creation/CreationSettingsRow.vue'
import CreationModelPicker from '@/components/creation/CreationModelPicker.vue'
import CreationImageSettings from '@/components/creation/CreationImageSettings.vue'
import {
  creationSettingsSummary,
  type CreationSettingsConfig,
  type CreationSettingsRowItem,
  type CreationSettingsValue,
} from '@/components/creation/types'
import { MODEL_OPTIONS, RESOLUTION_OPTIONS, ASPECT_RATIO_OPTIONS, COUNT_OPTIONS } from '../../constants.ts'

const { autoRatio = false, countLabel, countHint, disabled = false } = defineProps<{
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

const ratioOptions = autoRatio ? [{ label: '自动', value: '' }, ...ASPECT_RATIO_OPTIONS] : ASPECT_RATIO_OPTIONS

const fields = computed<CreationSettingsConfig>(() => ({
  resolution: { options: RESOLUTION_OPTIONS },
  aspectRatio: { options: ratioOptions },
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
    value: MODEL_OPTIONS.find((o) => o.value === model.value)?.label ?? model.value,
  },
  { key: 'image', icon: 'gear', label: '图片设置', value: creationSettingsSummary(fields.value, settings.value) },
])
</script>

<template>
  <CreationSettingsRow :items="rowItems" :disabled="disabled">
    <template #model>
      <CreationModelPicker v-model="model" :options="MODEL_OPTIONS" hide-label />
    </template>
    <template #image>
      <CreationImageSettings v-model="settings" :fields="fields" />
    </template>
  </CreationSettingsRow>
</template>
