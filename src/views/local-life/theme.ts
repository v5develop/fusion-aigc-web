import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * 本地生活模块的 naive-ui 藤紫主题。
 *
 * <p>对齐小岐AI 官方「新锤子风 · 藤紫」#875f9a（老页面的全局亮紫 #8e66f9 不动，
 * 本地生活页用 abstract NConfigProvider 局部覆盖）。
 *
 * <p>必须显式给 Button textColor*：全局 App.vue 的 common.baseColor 是 'red'，
 * naive 会拿它推导彩色底上的文字色，藤紫按钮会被配出红字。
 */
export const llTheme: GlobalThemeOverrides = {
  common: {
    primaryColor: '#875f9a',
    primaryColorHover: '#9a6fae',
    primaryColorPressed: '#5f3f6f',
    primaryColorSuppl: '#9a6fae',
  },
  Button: {
    textColorPrimary: '#ffffff',
    textColorHoverPrimary: '#ffffff',
    textColorPressedPrimary: '#ffffff',
    textColorFocusPrimary: '#ffffff',
    // 全局 baseColor: 'red' 会把 disabled 态的配对文字也染红
    textColorDisabled: '#6e7681',
  },
}
