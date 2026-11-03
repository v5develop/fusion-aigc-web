<script setup lang="ts">
import { ref } from 'vue'
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
  <!-- 筛选下拉组（原型 `.sx-input`，规范 §4.1）：高 34、内边距 0 10、1px control 描边、r4、白底 + 内凹输入影；
       hover 描边加深，键盘聚焦 violet 描边 + 3px 焦点环。下拉面板与触发器等宽 -->
  <div class="grid" :style="{ gridTemplateColumns: `repeat(${col}, minmax(0, 1fr))`, gap }">
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
          role="button"
          tabindex="0"
          aria-haspopup="menu"
          :aria-label="`${item.placeholder ?? ''}：${selectedLabel(item.field, item.options) || '未选择'}`"
          class="group flex items-center gap-4px h-34px px-10px box-border rounded-sm border border-solid border-control bg-white shadow-inset-input cursor-pointer outline-none transition-[border-color,box-shadow] duration-fast ease-sx motion-reduce:transition-none hover:border-control-hover focus-visible:(border-violet shadow-focus)"
          :style="item.style"
          @keydown.enter.prevent="($event.currentTarget as HTMLElement).click()"
          @keydown.space.prevent="($event.currentTarget as HTMLElement).click()"
        >
          <span
            class="flex-1 min-w-0 truncate text-13px leading-20px"
            :class="selectedLabel(item.field, item.options) ? 'text-ink' : 'text-placeholder'"
          >
            {{ selectedLabel(item.field, item.options) || item.placeholder || '' }}
          </span>
          <span
            v-if="
              (item.clearable === undefined ? clearable : item.clearable) && selectedLabel(item.field, item.options)
            "
            role="button"
            tabindex="0"
            :aria-label="`清除${item.placeholder ?? ''}`"
            class="flex-none grid place-items-center w-16px h-16px rounded-full text-placeholder cursor-pointer hover:text-ink-2 sx-focus"
            @click="(e: Event) => onClear(item.field, item.options, e)"
            @keydown.enter.stop.prevent="(e: Event) => onClear(item.field, item.options, e)"
          >
            <svg class="w-14px h-14px" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="7" fill="currentColor" />
              <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" class="stroke-white" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </span>
          <svg
            class="flex-none w-12px h-12px text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </n-dropdown>
    </template>
  </div>
</template>
