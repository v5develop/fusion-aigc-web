<script setup lang="ts">
/**
 * 创作页模型选择（原型 ModelSelect 模型浮层）：模型是**列表行**（名称 + 能力标签），不是分段胶囊。
 *
 * <p>行高 44、内边距 0 10、gap 10、r6，行间 gap 2；hover 底 #f3f4f5；选中 = violet-line + 白→#f8f3fc 渐变 + 短影，
 * 名称 13/18（选中 violet-ink 600），标签 11/16 muted（选中 #8a6d99）。在底部设置行（CreationSettingsRow）的
 * 「模型」弹层里用 hide-label，选中后收起弹层。只管展示：传值、默认值、回填校验都留在页面。
 */
import { inject, useId } from 'vue'
import type { CreationOption } from '../Creation/types'

const {
  modelValue,
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

const labelId = `creation-model-${useId()}`
/** 在设置弹层里：选中即收起（原型 ModelSelect choose → close） */
const closePopover = inject<(() => void) | null>('creation-settings-close', null)

function pick(opt: CreationOption<string>) {
  if (disabled || opt.disabled) return
  emit('update:modelValue', opt.value)
  closePopover?.()
}
</script>

<template>
  <div>
    <div :id="labelId" :class="hideLabel ? 'sr-only' : 'll-label'">{{ label }}</div>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-disabled="disabled || undefined"
      class="flex flex-col gap-2px"
    >
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        role="radio"
        :aria-checked="modelValue === opt.value"
        :disabled="disabled || opt.disabled"
        class="flex items-center justify-between gap-10px h-44px box-border px-10px rounded-6px border border-solid text-left cursor-pointer [transition:background_110ms,border-color_110ms] motion-reduce:transition-none sx-focus disabled:(opacity-45 cursor-not-allowed)"
        :class="
          modelValue === opt.value
            ? 'border-violet-line bg-[linear-gradient(180deg,#ffffff_0%,#f8f3fc_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
            : 'border-transparent bg-transparent enabled:hover:bg-surface3'
        "
        @click="pick(opt)"
      >
        <span
          class="min-w-0 truncate text-13px leading-18px"
          :class="modelValue === opt.value ? 'font-600 text-violet-ink' : 'font-500 text-ink'"
          >{{ opt.label }}</span
        >
        <span
          v-if="opt.description"
          class="flex-none text-11px leading-16px whitespace-nowrap"
          :class="modelValue === opt.value ? 'text-[#8a6d99]' : 'text-muted'"
          >{{ opt.description }}</span
        >
      </button>
    </div>
  </div>
</template>
