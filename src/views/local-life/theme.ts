// @unocss-include
import { computed } from 'vue'
import type { GlobalThemeOverrides } from 'naive-ui'
import { textScaleTheme } from '@/utils/textPrefs.ts'
import { activeTheme } from '@/utils/themePrefs.ts'
import { palettes, type ThemeName } from '@/theme/tokens.ts'

/**
 * 本地生活表单材质（挂在页面根节点上，作用于其中的 naive 控件），对齐电商功能页的控件语汇：
 * - 输入 / 文本域：常驻内凹输入影（同 sx-input / Textarea 的 shadow-inset-input），焦点仍走主题的藤紫描边 + 3px 外环；
 * - 选择触发器：白 → #fbfcfc 渐变 + 顶部内高光（同设置行触发条 sx-field-btn 的 sx-grad-plate + shadow-plate）；
 * - 主按钮：藤紫渐变 + 内高光 + 短投影（同 sx-btn-primary），hover 换亮一档渐变；
 * - 次按钮：白渐变 + 内高光 + 1px 落影（同 sx-btn）；
 * - 字数计数：11px、等宽数字（同 PromptAssist 计数）。
 *
 * <p>naive 只接纯色 token，渐变与常驻内影只能从外层选择器给；这里用 UnoCSS 任意变体 `[&_.x]:` 落在模板上，
 * 不写 Less/CSS。本文件是 .ts，靠首行 @unocss-include 纳入扫描；.ts 里变体分组不生效，故逐条展开。
 */
export const llFormSkin = [
  '[&_.n-input:not(.n-input--disabled)]:shadow-inset-input',
  '[&_.n-input-word-count]:text-11px',
  '[&_.n-input-word-count]:tabular-nums',
  '[&_.n-base-selection:not(.n-base-selection--disabled)_.n-base-selection-label]:sx-grad-plate',
  '[&_.n-base-selection:not(.n-base-selection--disabled)_.n-base-selection-label]:shadow-plate',
  '[&_.n-button--primary-type:not(.n-button--ghost):not(.n-button--disabled)]:sx-grad-primary',
  '[&_.n-button--primary-type:not(.n-button--ghost):not(.n-button--disabled)]:shadow-btn',
  '[&_.n-button--primary-type:not(.n-button--ghost):not(.n-button--disabled):hover]:from-violet-hover-top',
  '[&_.n-button--primary-type:not(.n-button--ghost):not(.n-button--disabled):hover]:to-violet-hover-bottom',
  '[&_.n-button--default-type:not(.n-button--disabled)]:sx-grad-plate',
  '[&_.n-button--default-type:not(.n-button--disabled)]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)]',
  '[&_.n-button--default-type:not(.n-button--disabled):hover]:to-surface2',
].join(' ')

/**
 * 本地生活模块的 naive-ui 藤紫主题。
 *
 * <p>对齐小岐AI 官方「新锤子风 · 藤紫」#875f9a（老页面的全局亮紫 #8e66f9 不动，
 * 本地生活页用 abstract NConfigProvider 局部覆盖）。
 *
 * <p>必须显式给 Button textColor*：全局 App.vue 的 common.baseColor 是 'red'，
 * naive 会拿它推导彩色底上的文字色，藤紫按钮会被配出红字。
 */
const baseLlTheme = (theme: ThemeName): GlobalThemeOverrides => ({
  // 浅色原值；深色用去饱和提亮的藤紫（同 tokens.ts 的 violet / violet-press），否则深色页里局部又被拉回浅色主色
  common:
    theme === 'dark'
      ? {
          primaryColor: palettes.dark.violet,
          primaryColorHover: '#a586b7',
          primaryColorPressed: palettes.dark['violet-press'],
          primaryColorSuppl: '#a586b7',
        }
      : {
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
    textColorDisabled: palettes[theme].placeholder,
  },
  /*
   * 输入、选择统一 34 高 / 13px / r4（docs/design/ui-design-spec.md §4.1）。
   * 本地生活表单大量写了 size="small"（naive 默认 28 高、12px），这里把 small 档也拉到同一规格，
   * 与全局 medium 档一致；焦点环（藤紫描边 + 3px 外环）、描边、占位色继承全局 theme/naive.ts。
   */
  Input: {
    // 字数计数与 PromptAssist 同色（placeholder 灰），不用 naive 默认的浅灰
    countTextColor: palettes[theme].placeholder,
    heightSmall: '34px',
    fontSizeSmall: '13px',
    paddingSmall: '0 10px',
    borderRadius: '4px',
  },
  InternalSelection: {
    heightSmall: '34px',
    fontSizeSmall: '13px',
    paddingSingle: '0 26px 0 10px',
    paddingMultiple: '3px 26px 0 10px',
    borderRadius: '4px',
  },
  InternalSelectMenu: {
    optionHeightSmall: '34px',
    optionFontSizeSmall: '13px',
  },
  InputNumber: {
    peers: {
      Input: {
        heightSmall: '34px',
        fontSizeSmall: '13px',
        borderRadius: '4px',
      },
    },
  },
})

/** 字号随「字体显示」档位缩放（见 src/utils/textPrefs.ts）；两套各算一次 */
const llThemes: Record<ThemeName, GlobalThemeOverrides> = {
  light: textScaleTheme(baseLlTheme('light')),
  dark: textScaleTheme(baseLlTheme('dark')),
}

/** 随「外观」切换（模板里直接 :theme-overrides="llTheme"，computed 自动解包） */
export const llTheme = computed(() => llThemes[activeTheme.value])
