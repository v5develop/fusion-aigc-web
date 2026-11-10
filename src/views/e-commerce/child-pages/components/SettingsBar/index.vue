<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 电商功能页底部设置行（原型工具页参数行「模型 ▾ | 生成设置 ▾」，规范 §5.5 – §5.7）。
 *
 * <p>外观交给共用的 CreationSettingsRow（弹层宽 = 按钮宽、最大高 min(520, 视口 − 24)）；「生成设置」弹层里每个字段
 * 一条分段控件（CreationOptionPills），「模型」弹层用共用的 CreationModelPicker（原型 ModelSelect：模型是
 * 「名称 + 能力标签」的列表行，不是胶囊）。能力标签只取服务端模型目录里已有的数据（视频：分辨率 / 时长档）。
 * 只改展示：字段名与取值原样写回页面的 formData，传参、默认值、联动都留在页面。
 */
import { computed } from 'vue'
import CreationSettingsRow from '@/components/Creation/CreationSettingsRow.vue'
import CreationOptionPills from '@/components/Creation/CreationOptionPills.vue'
import CreationModelPicker from '@/components/Creation/CreationModelPicker.vue'
import type { CreationOption, CreationOptionValue, CreationSettingsRowItem } from '@/components/Creation/types'

/** 页面常量与服务端模型目录的选项形状不一（naive SelectOption 的 label 可以是函数），这里统一收窄 */
interface RawOption {
  label?: unknown
  value?: unknown
  disabled?: boolean
  /** 视频模型目录的分辨率 / 时长档（见 utils/modelCatalog）；图片模型没有 */
  resolutionOps?: readonly { label: string }[]
  durationOps?: readonly { label: string }[]
}

const {
  fields = [],
  modelOptions,
  modelField = 'modelCode',
} = defineProps<{
  /** 「生成设置」弹层里的字段（formData 的键 + 标签 + 选项）；为空不出这一项 */
  fields?: { field: string; label: string; options: readonly RawOption[] }[]
  /** 模型选项；不传不出「模型」这一项 */
  modelOptions?: readonly RawOption[]
  /** 模型在 formData 里的键 */
  modelField?: string
}>()

const data = defineModel<Record<string, any>>('data', { required: true })

const normalize = (opts: readonly RawOption[]): CreationOption[] =>
  opts.map((o) => ({
    // 设置字段（比例 / 分辨率 / 张数…）不是模型，不过模型名映射（数字档没有 label 时 modelLabelOf 会给空串）
    label: String(typeof o.label === 'string' ? o.label : (o.value ?? '')),
    value: o.value as CreationOptionValue,
    disabled: o.disabled,
  }))

const labelOf = (opts: CreationOption[], value: unknown) => opts.find((o) => o.value === value)?.label ?? ''

/** 模型行右侧的能力标签：服务端下发的分辨率档 · 时长档，原样拼接，不另写文案 */
const capabilityOf = (o: RawOption) =>
  [o.resolutionOps, o.durationOps]
    .map((list) => (list ?? []).map((x) => x.label).join(' / '))
    .filter(Boolean)
    .join(' · ') || undefined

const models = computed<CreationOption<string>[]>(() =>
  (modelOptions ?? []).map((o) => ({
    label: modelLabelOf(typeof o.label === 'string' ? o.label : String(o.value ?? '')),
    value: String(o.value ?? ''),
    disabled: o.disabled,
    description: capabilityOf(o),
  })),
)
const settingFields = computed(() => fields.map((f) => ({ ...f, options: normalize(f.options) })))

const items = computed<CreationSettingsRowItem[]>(() => {
  const list: CreationSettingsRowItem[] = []
  if (modelOptions) {
    list.push({
      key: 'model',
      icon: 'sparkle',
      label: '模型',
      value: labelOf(models.value, data.value[modelField]) || '未选择',
      ariaLabel: '生成模型',
    })
  }
  if (settingFields.value.length) {
    list.push({
      key: 'settings',
      icon: 'gear',
      label: '生成设置',
      value: settingFields.value
        .map((f) => labelOf(f.options, data.value[f.field]))
        .filter(Boolean)
        .join(' · '),
    })
  }
  return list
})

function setField(field: string, value: CreationOptionValue) {
  data.value[field] = value
}

function pickModel(value: string) {
  data.value[modelField] = value
}
</script>

<template>
  <CreationSettingsRow v-if="items.length" :items="items">
    <template #model>
      <CreationModelPicker
        v-if="models.length"
        :model-value="String(data[modelField] ?? '')"
        :options="models"
        label="生成模型"
        hide-label
        @update:model-value="pickModel"
      />
      <p v-else class="sx-hint m-0">模型列表加载中，请稍候再选</p>
    </template>
    <template #settings>
      <div class="flex flex-col gap-12px">
        <CreationOptionPills
          v-for="f in settingFields"
          :key="f.field"
          :model-value="data[f.field] ?? undefined"
          :options="f.options"
          :label="f.label"
          @update:model-value="setField(f.field, $event)"
        />
      </div>
    </template>
  </CreationSettingsRow>
</template>
