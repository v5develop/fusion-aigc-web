import { h, type VNodeChild } from 'vue'
import type { DropdownOption } from 'naive-ui'
import type { DropdownMenuProps } from 'naive-ui/es/dropdown/src/interface'

/**
 * 下拉面板的统一配置，对齐设计稿「PC桌面端-下拉弹窗」
 * https://mastergo.com/file/189362363334838?page_id=939%3A023775&layer_id=965%3A41997
 * 结构性样式见 @/assets/dropdown.less
 */

// 设计稿「路径 247」：4.5×8 的勾，AI智慧紫/AI强调色
const CHECK_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.12 7.42L6.3 10.6L11.96 4.94" stroke="#8E66F9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export const DROPDOWN_THEME_OVERRIDES = {
  color: '#FFFFFF',
  padding: '8px 4px',
  borderRadius: '8px',
  optionHeightMedium: '40px',
  fontSizeMedium: '14px',
  optionTextColor: '#3A3A3A',
  optionTextColorHover: '#3A3A3A',
  optionTextColorActive: '#3A3A3A',
  optionColorHover: '#F5F6F8',
  groupHeaderTextColor: '#8F8F8F',
}

/** 面板宽度：设计稿中比例/时长为 156px，其余为 194px */
export function dropdownMenuProps(width?: number): DropdownMenuProps {
  return () => ({
    class: 'fusion-dropdown',
    style: width ? `width: ${width}px;` : undefined,
  })
}

/**
 * 选中行底色（#F5F6F8）通过整行 class 下发，naive 的 dropdown 本身没有选中态。
 * 注意：naive 会用 nodeProps 的 class 覆盖掉它自己的 n-dropdown-option，
 * 而它的选项样式都嵌套在该类名下，所以这里必须手动带上。
 */
export function dropdownNodeProps(getSelectedKey: () => string | number | undefined | null) {
  return (option: DropdownOption) => ({
    class:
      option.key === getSelectedKey()
        ? 'n-dropdown-option fusion-dropdown-option--selected'
        : 'n-dropdown-option',
  })
}

/** 选项行：16px 图标 + 8px 间距 + 文字，选中时右侧补勾 */
export function renderDropdownLabel(params: {
  label: string
  iconSvg?: string
  selected?: boolean
}): VNodeChild {
  const { label, iconSvg, selected } = params

  return h('div', { class: 'fusion-dropdown-row' }, [
    iconSvg ? h('span', { class: 'fusion-dropdown-row__icon', innerHTML: iconSvg }) : null,
    h('span', { class: 'fusion-dropdown-row__label' }, label),
    selected ? h('span', { class: 'fusion-dropdown-row__check', innerHTML: CHECK_SVG }) : null,
  ])
}
