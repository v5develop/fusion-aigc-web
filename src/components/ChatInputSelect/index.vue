<script setup lang="ts">
import { computed, watch } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { getOptionIcon, type IconCategory } from './icons.ts'
import {
  DROPDOWN_THEME_OVERRIDES,
  dropdownMenuProps,
  dropdownNodeProps,
  renderDropdownLabel,
} from '@/utils/dropdown.ts'

interface IOption {
  label: string
  value: string | number
}

const { options, title, iconCategory, panelWidth } = defineProps<{
  options: IOption[]
  title?: string
  iconCategory?: IconCategory
  panelWidth?: number
}>()
const value = defineModel<string | number>('value', { required: true })

const currentOption = computed(() => options.find((o) => o.value === value.value))
const iconFor = (option: IOption) => getOptionIcon(iconCategory, option)

// 设计稿中比例/时长面板为 156px，创作类型/模型/分辨率为 194px
const menuProps = computed(() =>
  dropdownMenuProps(
    panelWidth ?? (iconCategory === 'ratio' || iconCategory === 'duration' ? 156 : 194),
  ),
)
const nodeProps = dropdownNodeProps(() => value.value)

const dropdownOptions = computed<DropdownOption[]>(() => {
  const mapped = options.map((o) => ({ label: o.label, key: o.value }))
  if (title) {
    return [
      {
        type: 'group' as const,
        label: title,
        key: `_group_${title}`,
        children: mapped,
      },
    ]
  }
  return mapped
})

watch(
  () => options,
  (newOptions) => {
    if (newOptions.length > 0 && !newOptions.some((o) => o.value === value.value)) {
      value.value = newOptions[0]!.value
    }
  },
)

function renderLabel(option: DropdownOption) {
  if (option.type === 'group') return option.label as string

  const opt = options.find((o) => o.value === option.key)
  if (!opt) return option.label as string

  return renderDropdownLabel({
    label: opt.label,
    iconSvg: iconFor(opt),
    selected: value.value === option.key,
  })
}
</script>

<template>
  <n-dropdown
    v-if="options.length"
    :options="dropdownOptions"
    placement="bottom-start"
    trigger="click"
    :menu-props="menuProps"
    :node-props="nodeProps"
    :theme-overrides="DROPDOWN_THEME_OVERRIDES"
    :render-label="renderLabel"
    @select="(key: string | number) => (value = key)"
  >
    <div class="chat-select">
      <div class="trigger">
        <span class="label">{{ currentOption?.label || '请选择' }}</span>
        <svg
          class="arrow"
          width="16"
          height="16"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="rgba(0,0,0,0.25)"
            stroke-width=".8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </div>
  </n-dropdown>
  <div v-else class="chat-select">
    <div class="trigger">
      <span class="label">请选择</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.chat-select {
  display: inline-flex;
  flex-shrink: 0;

  .trigger {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;

    .label {
      font-size: 12px;
      color: #3a3a3a;
      line-height: 20px;
      white-space: nowrap;
    }

    .arrow {
      flex-shrink: 0;
    }
  }
}
</style>
