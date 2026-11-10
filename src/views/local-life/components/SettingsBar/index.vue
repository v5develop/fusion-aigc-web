<script setup lang="ts">
/**
 * 本地生活底部设置行（原型商拍换装 / 工作室操作区底部「模型 ▾ | 生成设置 ▾」两颗药丸）。
 *
 * <p>外观、弹层全部交给共用的 CreationSettingsRow（44 高、r6、两列等宽，OperatePanel `.tool-op__settings`）；
 * 「模型」弹层是 CreationModelPicker 的列表行（原型 ModelSelect），「生成设置」弹层里每个字段一条分段控件
 * （CreationOptionPills）。只改展示：字段名与取值原样写回页面的 data，传参、默认值、联动都留在页面。
 */
import { computed } from 'vue'
import CreationSettingsRow from '@/components/Creation/CreationSettingsRow.vue'
import CreationOptionPills from '@/components/Creation/CreationOptionPills.vue'
import CreationModelPicker from '@/components/Creation/CreationModelPicker.vue'
import type { CreationOption, CreationOptionValue, CreationSettingsRowItem } from '@/components/Creation/types'

type Opt = { label: string; value: CreationOptionValue }

const {
  fields = [],
  modelOptions,
  modelField = 'model',
  settingsLabel = '生成设置',
} = defineProps<{
  /** 「生成设置」弹层里的字段（data 的键 + 标签 + 选项）；选项为空的字段不出 */
  fields?: { field: string; label: string; options: readonly Opt[] }[]
  /** 模型选项；不传或为空不出「模型」这一项 */
  modelOptions?: readonly Opt[]
  /** 模型在 data 里的键 */
  modelField?: string
  settingsLabel?: string
}>()

const data = defineModel<Record<string, any>>('data', { required: true })

const models = computed<CreationOption<string>[]>(() =>
  (modelOptions ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
)
const visibleFields = computed(() => fields.filter((f) => f.options.length))

const labelOf = (opts: readonly Opt[], value: unknown) => opts.find((o) => o.value === value)?.label ?? ''

const items = computed<CreationSettingsRowItem[]>(() => {
  const list: CreationSettingsRowItem[] = []
  if (models.value.length) {
    list.push({
      key: 'model',
      icon: 'sparkle',
      label: '模型',
      value: labelOf(models.value, data.value[modelField]) || '未选择',
      ariaLabel: '生成模型',
    })
  }
  if (visibleFields.value.length) {
    list.push({
      key: 'settings',
      icon: 'gear',
      label: settingsLabel,
      value:
        visibleFields.value
          .map((f) => labelOf(f.options, data.value[f.field]))
          .filter(Boolean)
          .join(' · ') || '默认',
    })
  }
  return list
})

function setField(field: string, value: CreationOptionValue) {
  data.value[field] = value
}
</script>

<template>
  <CreationSettingsRow v-if="items.length" :items="items">
    <template #model>
      <CreationModelPicker
        :model-value="String(data[modelField] ?? '')"
        :options="models"
        label="生成模型"
        hide-label
        @update:model-value="setField(modelField, $event)"
      />
    </template>
    <template #settings>
      <div class="flex flex-col">
        <CreationOptionPills
          v-for="f in visibleFields"
          :key="f.field"
          :model-value="data[f.field] ?? undefined"
          :options="f.options.map((o) => ({ label: o.label, value: o.value }))"
          :label="f.label"
          @update:model-value="setField(f.field, $event)"
        />
      </div>
    </template>
  </CreationSettingsRow>
</template>
