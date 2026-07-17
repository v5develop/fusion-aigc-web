<script setup lang="ts">
import { computed, watch, h } from 'vue'
import type { DropdownOption } from 'naive-ui'
import { getOptionIcon, type IconCategory } from './icons.ts'

interface IOption {
  label: string
  value: string | number
  icon?: string
}

const { options, title, iconCategory } = defineProps<{
  options: IOption[]
  title?: string
  iconCategory?: IconCategory
}>()
const value = defineModel<string | number>('value', { required: true })

const currentOption = computed(() => options.find((o) => o.value === value.value))
const iconFor = (option: IOption) => getOptionIcon(iconCategory, option)

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

const CHECK_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="#8E66F9" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function renderLabel(option: DropdownOption) {
  if (option.type === 'group') return option.label as string

  const opt = options.find((o) => o.value === option.key)
  if (!opt) return option.label as string
  const svg = iconFor(opt)

  return h(
    'div',
    { class: 'cdd-opt-row' },
    [
      svg ? h('span', { class: 'cdd-opt-icon', innerHTML: svg }) : undefined,
      h('span', { class: 'cdd-opt-label' }, option.label as string),
      value.value === option.key
        ? h('span', { class: 'cdd-opt-check', innerHTML: CHECK_SVG })
        : undefined,
    ].filter(Boolean),
  )
}
</script>

<template>
  <n-dropdown
    v-if="options.length"
    :options="dropdownOptions"
    placement="bottom-start"
    trigger="click"
    :render-label="renderLabel"
    @select="(key: string | number) => (value = key)"
  >
    <div class="chat-select">
      <div class="trigger">
        <span v-if="currentOption && iconCategory" class="opt-icon" v-html="iconFor(currentOption)"></span>
        <i v-if="currentOption?.icon" :class="currentOption.icon" class="trigger-icon"></i>
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

    .trigger-icon {
      font-size: 14px;
      color: #3a3a3a;
    }

    .opt-icon {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      :deep(svg) {
        display: block;
        width: 16px;
        height: 16px;
      }
    }

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

<style lang="less">
.cdd-opt-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cdd-opt-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  svg {
    display: block;
    width: 16px;
    height: 16px;
  }
}

.cdd-opt-label {
  flex: 1;
}

.cdd-opt-check {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
  width: 16px;
  height: 16px;
  svg {
    display: block;
    width: 16px;
    height: 16px;
  }
}
</style>
