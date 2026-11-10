<script setup lang="ts">
/**
 * 创作页图片设置：目标分辨率 / 画幅比例 / 生成张数，按配置出现（没配的字段不渲染）。
 *
 * <p>每个字段一行「标签 + 胶囊单选」，三处页面同一标签字号、胶囊高度与圆角。
 * 标签默认取多数写法，页面特有叫法（如「每位模特生成张数」）通过配置的 label 传入。
 * 只改展示：v-model 是页面那几个字段的对象，回写时整体替换，页面自行映射回自己的字段名。
 *
 * <p>张数按原型（tool/NumberStepper）改成「值 | − | +」（共用 NumberStepper）：选项是连续整数（1–9 / min–max）时出步进器，
 * 上下限取选项首尾，可直接输入，失焦 / 回车时夹到范围内；选项不连续（如 1、2、4）仍用胶囊。
 * 回写的仍是选项里的那个数字，请求体不变。
 */
import { computed, inject, useId, watch } from 'vue'
import CreationOptionPills from './CreationOptionPills.vue'
import NumberStepper from './NumberStepper.vue'
import {
  CREATION_SETTING_LABELS,
  type CreationOption,
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

/** 设置弹层内每行自带 8 的上下内边距（原型设置行最小高 48），行间不再加间距 */
const inSettings = inject<boolean>('creation-settings-popover', false)

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

/** 张数选项是连续整数（且没有禁用项）时给出范围，否则 null（退回胶囊） */
function stepperRange(options: CreationOption[]): { min: number; max: number } | null {
  if (!options.length) return null
  const ok = options.every(
    (o, i) =>
      !o.disabled &&
      typeof o.value === 'number' &&
      Number.isInteger(o.value) &&
      (i === 0 || o.value === (options[i - 1]!.value as number) + 1),
  )
  return ok ? { min: options[0]!.value as number, max: options[options.length - 1]!.value as number } : null
}

const countRange = computed(() => (fields.count ? stepperRange(fields.count.options) : null))
const countValue = computed(() => (typeof modelValue.count === 'number' ? modelValue.count : undefined))
const countLabelId = `creation-count-${useId()}`

/**
 * 页面没给张数（undefined）或给了范围外的值：把默认（范围内最近的值，缺省取下限）写进模型，
 * 步进器只显示模型里真有的数，提交体与界面一致
 */
watch(
  [countRange, () => modelValue.count],
  ([range, raw]) => {
    if (!range) return
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : range.min
    const next = Math.min(range.max, Math.max(range.min, Math.round(n)))
    if (next !== raw) update('count', next)
  },
  { immediate: true },
)

function commitCount(next: number) {
  const range = countRange.value
  if (!range) return
  const clamped = Math.min(range.max, Math.max(range.min, Math.round(next)))
  if (clamped !== countValue.value) update('count', clamped)
}

</script>

<template>
  <div class="flex flex-col" :class="inSettings ? 'gap-0' : 'gap-12px'">
    <template v-for="row in rows" :key="row.key">
      <!-- 张数步进器（共用 NumberStepper：值 | − | +，到上下限时对应按钮禁用）；弹层里同原型：标签在左、步进器在右 -->
      <div
        v-if="row.key === 'count' && countRange"
        :class="
          inSettings
            ? 'flex items-center justify-between gap-12px min-h-48px box-border py-8px'
            : ''
        "
      >
        <div
          :id="countLabelId"
          :class="inSettings ? 'flex-none text-12px font-500 leading-18px text-ink-2' : 'll-label'"
        >
          <span>{{ row.label }}<span v-if="row.required" class="text-danger" aria-hidden="true"> *</span></span>
        </div>
        <NumberStepper
          :model-value="countValue ?? countRange.min"
          :min="countRange.min"
          :max="countRange.max"
          :aria-label="row.label"
          :disabled="disabled"
          @update:model-value="commitCount"
        />
      </div>
      <CreationOptionPills
        v-else
        :model-value="modelValue[row.key]"
        :options="row.options"
        :label="row.label"
        :required="row.required"
        :disabled="disabled"
        @update:model-value="update(row.key, $event)"
      />
      <p
        v-if="row.key === 'count' && countRange && row.hint"
        class="m-0 text-11px leading-15px text-muted"
        :class="inSettings ? '-mt-4px pb-8px' : '-mt-8px'"
      >
        {{ row.hint }}
      </p>
    </template>
  </div>
</template>
