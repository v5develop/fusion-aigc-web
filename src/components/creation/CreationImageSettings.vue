<script setup lang="ts">
/**
 * 创作页图片设置：目标分辨率 / 画幅比例 / 生成张数，按配置出现（没配的字段不渲染）。
 *
 * <p>每个字段一行「标签 + 胶囊单选」，三处页面同一标签字号、胶囊高度与圆角。
 * 标签默认取多数写法，页面特有叫法（如「每位模特生成张数」）通过配置的 label 传入。
 * 只改展示：v-model 是页面那几个字段的对象，回写时整体替换，页面自行映射回自己的字段名。
 */
import { computed } from 'vue'
import CreationOptionPills from './CreationOptionPills.vue'
import {
  CREATION_SETTING_LABELS,
  type CreationOptionValue,
  type CreationSettingKey,
  type CreationSettingsConfig,
  type CreationSettingsValue,
} from './types'

const {
  modelValue,
  fields,
  disabled = false,
} = defineProps<{
  modelValue: CreationSettingsValue
  /** 要显示的字段与各自选项；顺序固定为 分辨率 → 比例 → 张数 */
  fields: CreationSettingsConfig
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: CreationSettingsValue] }>()

const ORDER: CreationSettingKey[] = ['resolution', 'aspectRatio', 'count']
const rows = computed(() =>
  ORDER.flatMap((key) => {
    const f = fields[key]
    return f ? [{ key, ...f, label: f.label ?? CREATION_SETTING_LABELS[key] }] : []
  }),
)

function update(key: CreationSettingKey, value: CreationOptionValue) {
  emit('update:modelValue', { ...modelValue, [key]: value })
}
</script>

<template>
  <div class="flex flex-col gap-12px">
    <CreationOptionPills
      v-for="row in rows"
      :key="row.key"
      :model-value="modelValue[row.key]"
      :options="row.options"
      :label="row.label"
      :required="row.required"
      :disabled="disabled"
      @update:model-value="update(row.key, $event)"
    />
  </div>
</template>
