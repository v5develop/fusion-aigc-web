<script setup lang="ts">
/**
 * 创作页图片设置：目标分辨率 / 画幅比例 / 生成张数，按配置出现（没配的字段不渲染）。
 *
 * <p>每个字段一行「标签 + 胶囊单选」，三处页面同一标签字号、胶囊高度与圆角。
 * 标签默认取多数写法，页面特有叫法（如「每位模特生成张数」）通过配置的 label 传入。
 * 只改展示：v-model 是页面那几个字段的对象，回写时整体替换，页面自行映射回自己的字段名。
 *
 * <p>张数按原型（tool/NumberStepper）改成「− 输入框 +」：选项是连续整数（1–9 / min–max）时出步进器，
 * 上下限取选项首尾，可直接输入，失焦 / 回车时夹到范围内；选项不连续（如 1、2、4）仍用胶囊。
 * 回写的仍是选项里的那个数字，请求体不变。
 */
import { computed, inject, ref, useId, watch } from 'vue'
import CreationOptionPills from './CreationOptionPills.vue'
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

/** 输入框草稿：打字时只改草稿，失焦 / 回车才夹到范围内回写 */
const draft = ref('')
watch(
  countValue,
  (v) => {
    draft.value = v === undefined ? '' : String(v)
  },
  { immediate: true },
)

function commitCount(next: number) {
  const range = countRange.value
  if (!range) return
  const clamped = Math.min(range.max, Math.max(range.min, Math.round(next)))
  draft.value = String(clamped)
  if (clamped !== countValue.value) update('count', clamped)
}

function stepCount(delta: number) {
  if (disabled || !countRange.value) return
  commitCount((countValue.value ?? countRange.value.min) + delta)
}

function onDraftInput(e: Event) {
  draft.value = (e.target as HTMLInputElement).value.replace(/\D/g, '')
}

function endEdit() {
  const parsed = Number.parseInt(draft.value, 10)
  if (Number.isFinite(parsed)) commitCount(parsed)
  else draft.value = countValue.value === undefined ? '' : String(countValue.value)
}

function cancelEdit(e: KeyboardEvent) {
  draft.value = countValue.value === undefined ? '' : String(countValue.value)
  ;(e.target as HTMLInputElement).blur()
}

const atMin = computed(
  () => disabled || !countRange.value || (countValue.value !== undefined && countValue.value <= countRange.value.min),
)
const atMax = computed(
  () => disabled || !countRange.value || (countValue.value !== undefined && countValue.value >= countRange.value.max),
)

const stepBtnClass =
  'grid place-items-center w-30px p-0 border-0 bg-transparent text-ink-2 cursor-pointer outline-none [transition:background_110ms,color_110ms] motion-reduce:transition-none hover:enabled:(bg-surface3 text-ink) active:enabled:(bg-[#edeff1] shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)]) focus-visible:(outline-2 outline-solid outline-violet outline-offset-[-2px]) disabled:(text-placeholder cursor-not-allowed)'
</script>

<template>
  <div class="flex flex-col" :class="inSettings ? 'gap-0' : 'gap-12px'">
    <template v-for="row in rows" :key="row.key">
      <!-- 张数步进器（原型 NumberStepper）：− 输入框 +，到上下限时对应按钮禁用 -->
      <div
        v-if="row.key === 'count' && countRange"
        :class="
          inSettings
            ? 'flex flex-col gap-6px min-h-48px box-border py-8px @[320px]:(flex-row items-center gap-10px)'
            : ''
        "
      >
        <div
          :id="countLabelId"
          :class="inSettings ? 'flex-none text-12px leading-18px text-ink-2 @[320px]:w-64px' : 'll-label'"
        >
          <span>{{ row.label }}<span v-if="row.required" class="text-danger" aria-hidden="true"> *</span></span>
        </div>
        <div
          role="group"
          :aria-labelledby="countLabelId"
          class="inline-flex self-start items-stretch h-34px box-border rounded-4px border border-solid border-line shadow-[inset_0_1px_2px_rgba(31,35,41,0.06)]"
          :class="disabled ? 'bg-surface3 opacity-60' : 'bg-white'"
        >
          <button
            type="button"
            :class="[stepBtnClass, 'rounded-l-4px']"
            :disabled="atMin"
            :aria-label="`减少${row.label}`"
            @click="stepCount(-1)"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            </svg>
          </button>
          <span class="w-1px my-7px bg-line" aria-hidden="true" />
          <input
            :value="draft"
            type="text"
            inputmode="numeric"
            :aria-label="`${row.label}（${countRange.min}–${countRange.max}）`"
            :disabled="disabled"
            class="w-64px min-w-0 box-border px-10px border-0 bg-transparent text-ink text-12px text-center leading-32px tabular-nums outline-none focus:shadow-[inset_0_0_0_1px_#d9c7e3] disabled:cursor-not-allowed"
            @input="onDraftInput"
            @blur="endEdit"
            @keydown.enter.prevent="endEdit"
            @keydown.esc.prevent="cancelEdit"
          />
          <span class="w-1px my-7px bg-line" aria-hidden="true" />
          <button
            type="button"
            :class="[stepBtnClass, 'rounded-r-4px']"
            :disabled="atMax"
            :aria-label="`增加${row.label}`"
            @click="stepCount(1)"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 5h6M5 2v6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
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
    </template>
  </div>
</template>
