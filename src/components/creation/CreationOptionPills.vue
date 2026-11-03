<script setup lang="ts">
/**
 * 创作页共用的「标签 + 胶囊单选」一行：模型选择与图片设置都用它，保证标签字号、胶囊高度、圆角、焦点环一致。
 *
 * <p>胶囊沿用 uno.config 的 ll-pill / ll-pill-active（白底细描边，选中柔紫底内凹），
 * 语义为 radiogroup + radio，键盘 Tab 可达，focus-visible 出藤紫焦点环。
 */
import { inject, useId } from 'vue'
import type { CreationOption, CreationOptionValue } from './types'

const {
  options,
  label,
  required = false,
  disabled = false,
  hideLabel = false,
} = defineProps<{
  modelValue: CreationOptionValue | undefined
  options: CreationOption[]
  label: string
  required?: boolean
  disabled?: boolean
  /** 标签只给读屏（放进已有标题的弹层时用，如底部设置行的「模型」弹层） */
  hideLabel?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: CreationOptionValue] }>()

const labelId = `creation-pills-${useId()}`
/** 设置弹层内：标签与分段控件同一行（原型「目标分辨率」） */
const inSettings = inject<boolean>('creation-settings-popover', false)

function pick(opt: CreationOption) {
  if (disabled || opt.disabled) return
  emit('update:modelValue', opt.value)
}
</script>

<template>
  <!-- 设置弹层内：分段控件（标签在左，选项组为一个灰底圆角条，选中项白底描边） -->
  <div v-if="inSettings" class="flex items-center gap-12px">
    <div :id="labelId" :class="hideLabel ? 'sr-only' : 'flex-none text-13px leading-18px text-ink-2'">
      <span>{{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></span>
    </div>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-disabled="disabled || undefined"
      class="flex flex-1 min-w-0 p-3px gap-2px rounded-8px bg-surface2 border border-solid border-line"
    >
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        role="radio"
        :aria-checked="modelValue === opt.value"
        :disabled="disabled || opt.disabled"
        class="flex-1 h-30px rounded-6px border border-solid text-13px font-500 cursor-pointer outline-none transition-[background-color,border-color,color,box-shadow] duration-110 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-50 cursor-not-allowed)"
        :class="
          modelValue === opt.value
            ? 'bg-white border-line text-ink shadow-[0_1px_2px_rgba(31,35,41,0.08)]'
            : 'bg-transparent border-transparent text-muted hover:text-ink-2'
        "
        @click="pick(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
  <div v-else>
    <div :id="labelId" :class="hideLabel ? 'sr-only' : 'll-label'">
      <span>{{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></span>
    </div>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-disabled="disabled || undefined"
      class="flex flex-wrap gap-6px"
    >
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        role="radio"
        :aria-checked="modelValue === opt.value"
        :disabled="disabled || opt.disabled"
        class="ll-pill outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-50 cursor-not-allowed)"
        :class="modelValue === opt.value ? 'll-pill-active' : ''"
        @click="pick(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>
