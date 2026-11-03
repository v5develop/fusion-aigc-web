<script setup lang="ts">
/**
 * 创作页模型选择：标签 + 胶囊单选（与 CreationImageSettings 同一套胶囊）。
 *
 * <p>只管展示：传值、默认值、回填校验都留在页面。在底部设置行（CreationSettingsRow）的「模型」弹层里用 hide-label。
 */
import CreationOptionPills from './CreationOptionPills.vue'
import type { CreationOption } from './types'

const {
  options,
  label = '生图模型',
  disabled = false,
  hideLabel = false,
} = defineProps<{
  modelValue: string
  options: CreationOption<string>[]
  label?: string
  disabled?: boolean
  /** 标签只给读屏（底部设置行弹层已有标题时用） */
  hideLabel?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <CreationOptionPills
    :model-value="modelValue"
    :options="options"
    :label="label"
    :disabled="disabled"
    :hide-label="hideLabel"
    @update:model-value="emit('update:modelValue', String($event))"
  />
</template>
