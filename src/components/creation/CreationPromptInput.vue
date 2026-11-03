<script setup lang="ts">
/**
 * 创作页提示词 / 补充说明输入框（原型 OperatePanel `.op-prompt__field` ml 版）：
 * 白底 1px line 描边、圆角 6、内边距 12，常驻四边内影（inset 0 0 16px .12 + 顶 1px .05）；
 * 框最小高 220（视口 <1440 时 320），文字在 textarea 里自己滚，不再拖拽改高。
 * 框内底行高 24、上外边距 6，右侧「已输入 / 上限」计数（11/16、等宽数字）。
 *
 * <p>传了 label 就渲染 ll-label 标签行（label for 关联）；不传时页面自己写分组标题，
 * 须给 ariaLabel 作为无障碍名称。聚焦不改描边：保留内影，外加 3px 藤紫光晕（α.14，原型输入框焦点环）。
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
      class="flex flex-col box-border min-h-[220px] max-[1439px]:min-h-[320px] p-12px rounded-6px border border-solid border-line shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)] [transition:box-shadow_110ms] motion-reduce:transition-none focus-within:shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05),0_0_0_3px_rgba(135,95,154,0.14)]"
      :class="disabled ? 'bg-surface3 cursor-not-allowed' : 'bg-white'"
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
        class="block flex-1 w-full min-h-0 box-border m-0 resize-none overflow-y-auto overscroll-contain [field-sizing:fixed] border-none bg-transparent pt-8px px-0 pb-0 text-13px leading-20px text-ink outline-none placeholder:text-placeholder disabled:(cursor-not-allowed text-placeholder)"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
      <div class="flex-none flex items-center justify-end gap-8px h-24px mt-6px">
        <span
          :id="countId"
          class="text-11px leading-16px tabular-nums select-none"
          :class="length >= maxLength ? 'text-warning' : 'text-placeholder'"
          :aria-live="length >= maxLength ? 'polite' : undefined"
          >{{ length >= maxLength ? '已达字数上限 · ' : '' }}{{ length }} / {{ maxLength }}</span
        >
      </div>
    </div>
  </div>
</template>
