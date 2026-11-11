import { h, type VNodeChild } from 'vue'
import type { DropdownOption } from 'naive-ui'
import type { DropdownMenuProps } from 'naive-ui/es/dropdown/src/interface'
import { textScaleTheme } from '@/utils/textPrefs.ts'

/**
 * 下拉面板的统一配置，对齐设计稿「PC桌面端-下拉弹窗」
 * https://mastergo.com/file/189362363334838?page_id=939%3A023775&layer_id=965%3A41997
 * 结构性样式见 @/assets/dropdown.less
 */

// 设计稿「路径 247」：4.5×8 的勾，颜色取 .fusion-dropdown-row__check 的 color（浅色 AI强调紫 #8E66F9，深色藤紫文字档）
const CHECK_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.12 7.42L6.3 10.6L11.96 4.94" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export const DROPDOWN_THEME_OVERRIDES = textScaleTheme({
  // 与全局 Dropdown 主题（theme/naive.ts）同一套令牌；行高 40 / 字 14 是这些面板自己的命中尺寸，保持不变。
  // 颜色写 CSS 变量：这几个键 Naive 原样落进 --n-* 变量、不做混色，跟着 <html data-theme> 切换，不用响应式重建
  color: 'var(--xq-overlay)',
  padding: '8px 4px',
  borderRadius: '10px',
  boxShadow: 'var(--xq-shadow-pop)',
  optionHeightMedium: '40px',
  fontSizeMedium: '14px',
  optionTextColor: 'var(--xq-ink)',
  optionTextColorHover: 'var(--xq-ink)',
  optionTextColorActive: 'var(--xq-ink)',
  optionColorHover: 'var(--xq-surface3)',
  groupHeaderTextColor: 'var(--xq-muted)',
})

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
    class: option.key === getSelectedKey() ? 'n-dropdown-option fusion-dropdown-option--selected' : 'n-dropdown-option',
  })
}

/** 选项行：16px 图标 + 8px 间距 + 文字，选中时右侧补勾 */
export function renderDropdownLabel(params: { label: string; iconSvg?: string; selected?: boolean }): VNodeChild {
  const { label, iconSvg, selected } = params

  return h('div', { class: 'fusion-dropdown-row' }, [
    iconSvg ? h('span', { class: 'fusion-dropdown-row__icon', innerHTML: iconSvg }) : null,
    h('span', { class: 'fusion-dropdown-row__label' }, label),
    selected ? h('span', { class: 'fusion-dropdown-row__check', innerHTML: CHECK_SVG }) : null,
  ])
}
