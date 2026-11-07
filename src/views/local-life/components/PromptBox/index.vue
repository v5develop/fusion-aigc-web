<script setup lang="ts">
/**
 * 本地生活大输入框（原型 OperatePanel `.op-prompt__field` ml 版 + StudioTextCard 底部动作行）。
 *
 * <p>外观逐值取自原型：1px line 描边、r6、白底、内边距 12（OperatePanel.vue:720-726、761-771）；
 * 常驻四边内影 `inset 0 0 10px rgba(31,35,41,.085), inset 0 1px 0 rgba(31,35,41,.04)`（:778-780），
 * 聚焦加深为 `inset 0 0 16px rgba(31,35,41,.12), inset 0 1px 0 rgba(31,35,41,.05)`（:782-785）并加 3px 藤紫光晕（.14）。
 * 文字 13/20、上内边距 8、不可拖拽（:786-808）；框内底行高 28、gap 8（:812-819）：
 * 左侧 #actions 放 AI帮写 / 选择AI文案，右下角是「已输入 / 上限」计数（11/16、等宽数字）。
 * 框最小高：lg 220（ml 版 :722）、md 160（:763）、sm 112。
 */
import { computed, useId } from 'vue'

const {
  maxLength,
  placeholder = '',
  size = 'md',
  label,
  disabled = false,
} = defineProps<{
  maxLength?: number
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  /** 无障碍名称（卡头标题） */
  label: string
  disabled?: boolean
}>()

defineSlots<{ actions?: () => unknown }>()

const model = defineModel<string>({ default: '' })

const countId = `ll-prompt-${useId()}`
const length = computed(() => (model.value ?? '').length)
const atLimit = computed(() => !!maxLength && length.value >= maxLength)
const MIN_H = { sm: 'min-h-112px', md: 'min-h-160px', lg: 'min-h-220px' } as const
</script>

<template>
  <div
    class="flex flex-col box-border p-12px rounded-md border border-solid border-line shadow-[inset_0_0_10px_rgba(31,35,41,0.085),inset_0_1px_0_rgba(31,35,41,0.04)] [transition:box-shadow_110ms,border-color_110ms] motion-reduce:transition-none focus-within:border-violet focus-within:shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05),0_0_0_3px_rgba(135,95,154,0.14)]"
    :class="[MIN_H[size], disabled ? 'bg-surface3 cursor-not-allowed' : 'bg-white']"
  >
    <textarea
      v-model="model"
      :maxlength="maxLength"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="label"
      :aria-describedby="countId"
      class="block flex-1 w-full min-h-0 box-border m-0 pt-8px px-0 pb-0 resize-none overflow-y-auto overscroll-contain border-none bg-transparent [font-family:inherit] text-13px leading-20px text-ink outline-none placeholder:text-placeholder disabled:(cursor-not-allowed text-placeholder)"
    />
    <div class="flex-none flex items-center gap-8px h-28px mt-6px">
      <slot name="actions" />
      <span
        :id="countId"
        class="ml-auto text-11px leading-16px tabular-nums select-none"
        :class="atLimit ? 'text-warning' : 'text-placeholder'"
        :aria-live="atLimit ? 'polite' : undefined"
        >{{ maxLength ? `${length} / ${maxLength}` : `${length} 字` }}</span
      >
    </div>
  </div>
</template>
