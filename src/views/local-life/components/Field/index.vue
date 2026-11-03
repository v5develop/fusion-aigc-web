<script setup lang="ts">
/**
 * 卡内字段（原型 ToolParamField：`flex-col gap-1.5` + sx-label）：
 * 标签 11/16·500 ink-2（ui-design-spec §8.2 sx-label），标签与控件间距 6；右侧 #extra 放字段级说明或动作。
 */
import { useId } from 'vue'

const { label, required = false } = defineProps<{ label: string; required?: boolean }>()

defineSlots<{ default: (props: { labelId: string }) => unknown; extra?: () => unknown }>()

const labelId = `ll-field-${useId()}`
</script>

<template>
  <div class="flex flex-col gap-6px min-w-0" role="group" :aria-labelledby="labelId">
    <div class="flex items-center justify-between gap-8px min-h-16px">
      <span :id="labelId" class="text-11px font-500 leading-16px text-ink-2"
        >{{ label }}<span v-if="required" class="ml-2px text-danger" aria-hidden="true">*</span></span
      >
      <slot name="extra" />
    </div>
    <slot :label-id="labelId" />
  </div>
</template>
