<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { DropdownOption } from 'naive-ui'
import {
  DROPDOWN_THEME_OVERRIDES,
  dropdownMenuProps,
  dropdownNodeProps,
  renderDropdownLabel,
} from '@/utils/dropdown.ts'

interface IProps {
  list: {
    field: string
    options: { label: string; value: string | number }[]
    placeholder?: string
    clearable?: boolean
    style?: string | Record<string, any>
    [propName: string]: any
  }[]
  col?: number
  gap?: string
  clearable?: boolean
}

const { list, col = 2, gap = '8px', clearable = false } = defineProps<IProps>()
const data = defineModel<Record<string, any>>('data', { required: true })

function toDropdownOptions(opts: { label: string; value: string | number }[]): DropdownOption[] {
  return opts.map((o) => ({ label: o.label, key: o.value }))
}

function selectedLabel(field: string, opts: { label: string; value: string | number }[]): string {
  const val = data.value[field]
  return opts.find((o) => o.value === val)?.label ?? ''
}

function onSelect(field: string, key: string | number) {
  data.value[field] = key
}

function onClear(field: string, opts: { label: string; value: string | number }[], e: Event) {
  e.stopPropagation()
  data.value[field] = undefined
}

// 下拉面板与触发器等宽。触发器是 grid 项、宽度随容器变化，
// 只能在展开时实测，不能取固定值。
const triggerEls: HTMLElement[] = []
const menuWidths = ref<(number | undefined)[]>([])

function setTriggerRef(el: Element | ComponentPublicInstance | null, i: number) {
  if (el instanceof HTMLElement) triggerEls[i] = el
}

function onShow(show: boolean, i: number) {
  if (show) menuWidths.value[i] = triggerEls[i]?.offsetWidth
}

function renderLabel(field: string, option: DropdownOption) {
  return renderDropdownLabel({
    label: option.label as string,
    selected: data.value[field] === option.key,
  })
}
</script>

<template>
  <div class="container" :style="{ '--col': col, '--gap': gap }">
    <template v-for="(item, i) in list" :key="i">
      <n-dropdown
        :options="toDropdownOptions(item.options)"
        placement="bottom-start"
        trigger="click"
        :menu-props="dropdownMenuProps(menuWidths[i])"
        :node-props="dropdownNodeProps(() => data[item.field])"
        :theme-overrides="DROPDOWN_THEME_OVERRIDES"
        :render-label="(option: DropdownOption) => renderLabel(item.field, option)"
        @update:show="(show: boolean) => onShow(show, i)"
        @select="(key: string | number) => onSelect(item.field, key)"
      >
        <div
          :ref="(el) => setTriggerRef(el, i)"
          class="trigger"
          :style="item.style"
          :class="{ placeholder: !selectedLabel(item.field, item.options) }"
        >
          <span class="trigger-label">
            {{ selectedLabel(item.field, item.options) || item.placeholder || '' }}
          </span>
          <span
            v-if="(item.clearable === undefined ? clearable : item.clearable) && selectedLabel(item.field, item.options)"
            class="trigger-clear"
            @click="(e: Event) => onClear(item.field, item.options, e)"
          />
          <span class="trigger-arrow" />
        </div>
      </n-dropdown>
    </template>
  </div>
</template>

<style scoped lang="less">
.container {
  display: grid;
  grid-template-columns: repeat(var(--col), 1fr);
  gap: var(--gap);
}

.trigger {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  background-color: #f5f6f8;
  border-radius: 3px;
  cursor: pointer;

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
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid #b0b0b0;
    transition: transform 0.2s;
  }
}
</style>
