<script setup lang="ts">
import { computed, type Ref } from 'vue'
import type { DropdownOption } from 'naive-ui'
import type { IProps } from './constants.ts'
import { _platformOptions, _countryOptions, _languageOptions, _ratioOptions } from './constants.ts'
import {
  DROPDOWN_THEME_OVERRIDES,
  dropdownMenuProps,
  dropdownNodeProps,
  renderDropdownLabel,
} from '@/utils/dropdown.ts'

const {
  platformOptions = _platformOptions,
  countryOptions = _countryOptions,
  languageOptions = _languageOptions,
  ratioOptions = _ratioOptions,
} = defineProps<IProps>()

const platform = defineModel('platform', { required: true })
const country = defineModel('country', { required: true })
const language = defineModel('language', { required: true })
const ratio = defineModel('ratio', { required: true })
const productType = defineModel('productType')

interface IOption {
  label: string
  value: string | number
}

interface IField {
  model: Ref<any>
  options: IOption[]
  placeholder?: string
  clearable?: boolean
  full?: boolean
}

const fields = computed<IField[]>(() => {
  const list: IField[] = [
    { model: platform, options: platformOptions as unknown as IOption[] },
    { model: country, options: countryOptions as unknown as IOption[] },
    { model: language, options: languageOptions as unknown as IOption[] },
    { model: ratio, options: ratioOptions as unknown as IOption[] },
  ]
  if (productType.value !== undefined) {
    list.push({
      model: productType,
      options: ratioOptions as unknown as IOption[],
      placeholder: '商品类型（选填）',
      clearable: true,
      full: true,
    })
  }
  return list
})

const menuProps = dropdownMenuProps()

const toDropdownOptions = (opts: IOption[]): DropdownOption[] =>
  opts.map((o) => ({ label: o.label, key: o.value }))

const labelOf = (field: IField) =>
  field.options.find((o) => o.value === field.model.value)?.label ?? ''

function renderLabel(field: IField, option: DropdownOption) {
  return renderDropdownLabel({
    label: option.label as string,
    selected: field.model.value === option.key,
  })
}

function onClear(field: IField, e: Event) {
  e.stopPropagation()
  // 与此前 n-select clearable 行为一致：置 null 而非 undefined，否则该项会被 v-if 移除
  field.model.value = null
}
</script>

<template>
  <div class="container">
    <n-dropdown
      v-for="(field, i) in fields"
      :key="i"
      :options="toDropdownOptions(field.options)"
      placement="bottom-start"
      trigger="click"
      :menu-props="menuProps"
      :node-props="dropdownNodeProps(() => field.model.value)"
      :theme-overrides="DROPDOWN_THEME_OVERRIDES"
      :render-label="(option: DropdownOption) => renderLabel(field, option)"
      @select="(key: string | number) => (field.model.value = key)"
    >
      <div class="trigger" :class="{ full: field.full, placeholder: !labelOf(field) }">
        <span class="trigger-label">{{ labelOf(field) || field.placeholder || '' }}</span>
        <span
          v-if="field.clearable && labelOf(field)"
          class="trigger-clear"
          @click="(e: Event) => onClear(field, e)"
        />
        <span class="trigger-arrow" />
      </div>
    </n-dropdown>
  </div>
</template>

<style scoped lang="less">
.container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.trigger {
  display: flex;
  flex: 1;
  min-width: 40%;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  background-color: #f5f6f8;
  border-radius: 3px;
  cursor: pointer;

  &.full {
    flex-basis: 100%;
  }

  .trigger-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    color: #333;
  }

  &.placeholder .trigger-label {
    color: #c2c2c2;
  }

  .trigger-clear {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-right: 2px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23ccc'/%3E%3Cpath d='M5 5l6 6M11 5l-6 6' stroke='white' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-size: contain;
    cursor: pointer;
    &:hover {
      opacity: 0.7;
    }
  }

  .trigger-arrow {
    flex-shrink: 0;
    width: 0;
    height: 0;
    margin-left: 6px;
    border-top: 5px solid #b0b0b0;
    border-right: 4px solid transparent;
    border-left: 4px solid transparent;
  }
}
</style>
