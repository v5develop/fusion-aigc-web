<script setup lang="ts">
/**
 * 创作页提示词 / 补充说明输入框（原型商拍换装同款）：白底细描边框，框内上方是无边多行文本，
 * 框内左下角一行「已输入 / 上限」计数（原型「0 / 3000」）。
 *
 * <p>传了 label 就渲染 ll-label 标签行（label for 关联）；不传时页面自己写分组标题，
 * 须给 ariaLabel 作为无障碍名称。外框圆角 8、line 描边；文本聚焦时外框藤紫描边 + 2px 光晕（focus-within）。
 */
import { computed, useId } from 'vue'

const {
  modelValue = '',
  maxLength = 3000,
  placeholder = '',
  rows = 4,
  label = '',
  required = false,
  ariaLabel,
  disabled = false,
  id,
} = defineProps<{
  modelValue?: string
  maxLength?: number
  placeholder?: string
  rows?: number
  label?: string
  required?: boolean
  ariaLabel?: string
  disabled?: boolean
  /** textarea 的 id；不传自动生成 */
  id?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const autoId = `creation-prompt-${useId()}`
const fieldId = computed(() => id || autoId)
const countId = computed(() => `${fieldId.value}-count`)
const length = computed(() => (modelValue ?? '').length)
</script>

<template>
  <div>
    <div v-if="label" class="ll-label">
      <label :for="fieldId">{{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></label>
    </div>
    <div
      class="flex flex-col rounded-8px border border-solid border-line transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none focus-within:(border-violet shadow-[0_0_0_2px_rgba(135,95,154,0.18)])"
      :class="disabled ? 'bg-surface2 cursor-not-allowed' : 'bg-white'"
    >
      <textarea
        :id="fieldId"
        :value="modelValue ?? ''"
        :rows="rows"
        :maxlength="maxLength"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="label ? undefined : ariaLabel"
        :aria-describedby="countId"
        class="block w-full box-border m-0 resize-y border-none bg-transparent px-12px pt-10px pb-4px text-13px leading-20px text-ink outline-none placeholder:text-placeholder disabled:cursor-not-allowed"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
      <span :id="countId" class="block px-12px pb-8px text-11px leading-16px text-placeholder select-none"
        >{{ length }} / {{ maxLength }}</span
      >
    </div>
  </div>
</template>
