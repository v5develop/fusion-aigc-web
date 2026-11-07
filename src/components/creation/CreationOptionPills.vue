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
  <!--
    设置弹层内（原型 SettingsPopover 设置行）：最小高 48、内边距 8 0、纵向 gap 6；弹层宽 ≥320 时横排，标签列 64、gap 10。
    标签 12/18；分段轨道 内边距 3 / gap 2 / 1px line / r6 / #f3f4f5；选项高 30、内边距 0 9、r4、11px，
    选中 = violet-line + 白→#f8f3fc 渐变 + 短影 + violet-ink 600；过渡 300ms (.4,0,.2,1)。选项多于 5 个时按 5 列排。
  -->
  <div
    v-if="inSettings"
    class="flex flex-col gap-6px min-h-48px box-border py-8px @[320px]:(flex-row items-center gap-10px)"
  >
    <div :id="labelId" :class="hideLabel ? 'sr-only' : 'flex-none text-12px leading-18px text-ink-2 @[320px]:w-64px'">
      <span>{{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></span>
    </div>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-disabled="disabled || undefined"
      class="sx-squircle flex-1 min-w-0 p-3px gap-2px box-border rounded-8px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
      :class="options.length > 3 ? 'grid grid-cols-[repeat(auto-fit,minmax(64px,1fr))]' : 'flex flex-wrap'"
    >
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        role="radio"
        :aria-checked="modelValue === opt.value"
        :disabled="disabled || opt.disabled"
        class="flex-1 min-w-0 h-32px box-border px-6px rounded-4px border border-solid text-13px leading-none whitespace-nowrap cursor-pointer outline-none [transition:background_300ms_cubic-bezier(0.4,0,0.2,1),border-color_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1),box-shadow_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) active:shadow-[inset_0_1px_2px_rgba(80,55,95,0.16)] disabled:(opacity-45 cursor-not-allowed)"
        :class="
          modelValue === opt.value
            ? 'border-violet-line bg-[linear-gradient(180deg,#ffffff_0%,#f8f3fc_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
            : 'border-transparent bg-transparent font-400 text-muted hover:text-ink'
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
        class="ll-pill !min-h-32px !text-13px outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-50 cursor-not-allowed)"
        :class="modelValue === opt.value ? 'll-pill-active' : ''"
        @click="pick(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>
