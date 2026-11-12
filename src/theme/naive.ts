/**
 * Naive UI 全局主题覆盖 —— 对齐原型 v3（xiaoqi-tools-5183 src/theme/v3.ts）。
 *
 * <p>藤紫 #875F9A 主色 / 页面 #F5F6F7 / 线 #E5E7EB / 标题 #1F2329 / 正文 #4B5563 /
 * 控件圆角 4 / 卡片、弹层 8 / 基础字号 13 / 按钮 30、34、42（半径 8 / 8 / 10）/ 输入、选择 34 / 输入焦点 3px 藤紫外环。
 * 数值出处见 docs/design/ui-design-spec.md §1、§4.1、§7.1。
 *
 * <p>Naive 只接纯色：主按钮的藤紫渐变不在这里，需要渐变的地方用 uno 的 `sx-btn-primary`。
 *
 * <p>浅色 / 深色：App.vue 按 themePrefs 的生效主题传 {@link naiveBaseTheme} + {@link naiveThemeOverrides}，
 * 切换时 n-config-provider 响应式重算；色值与 uno 工具类同出 src/theme/tokens.ts。
 */
import { computed } from 'vue'
import { darkTheme, type ConfigProviderProps, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import { textScaleTheme } from '@/utils/textPrefs.ts'
import { activeTheme } from '@/utils/themePrefs.ts'
import { effects, palettes, type ThemeName } from './tokens.ts'

const fontFamily =
  "'Smartisan Compact', 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"

/**
 * 按主题取色。Naive 会拿这些值做混色（hover 透明度、波纹、禁用态），所以必须是真色值而不是 CSS 变量；
 * 两套色板与 uno 工具类同出 src/theme/tokens.ts。浅色时每个值与改造前的 C 表逐一相同。
 */
function colorsOf(theme: ThemeName) {
  const p = palettes[theme]
  return {
    violet: p.violet,
    violetTop: p['violet-top'],
    violetBottom: p['violet-bottom'],
    violetDeep: p['violet-deep'],
    violetPress: p['violet-press'],
    violetBorder: p['violet-border'],
    violetSoft: p['violet-soft'],
    violetSoft2: p['violet-soft-2'],
    violetLine: p['violet-line'],
    ink: p.ink,
    ink2: p['ink-2'],
    muted: p.muted,
    placeholder: p.placeholder,
    line: p.line,
    control: p.control,
    controlHover: p['control-hover'],
    controlPress: p['control-press'],
    page: p.page,
    surface2: p.surface2,
    surface3: p.surface3,
    sunken: p.sunken,
    success: p.success,
    warning: p.warning,
    danger: p.danger,
    /** 卡面（浅色 #fff） */
    white: p.surface,
    /** 浮层面：浅色同卡面 #fff，深色高一档 */
    overlay: p.overlay,
    onAccent: p['on-accent'],
  }
}

/** 浅色时的语义色三态（原值）；深色按 fill 档重新配 */
const stateColors = {
  light: {
    successHover: '#3E8E6A',
    successPressed: '#2C684A',
    warningHover: '#A87525',
    warningPressed: '#7E5519',
    errorHover: '#C1524C',
    errorPressed: '#9B3935',
    violetHover: '#8A639F',
  },
  dark: {
    successHover: '#4a9b76',
    successPressed: '#357557',
    warningHover: '#b8883f',
    warningPressed: '#8d652a',
    errorHover: '#c45b55',
    errorPressed: '#9d433f',
    violetHover: '#a586b7',
  },
} as const

function buildOverrides(theme: ThemeName): GlobalThemeOverrides {
  const C = colorsOf(theme)
  const S = stateColors[theme]
  const E = effects[theme]
  /** 输入焦点环：3px、藤紫 .14（原型 v3.ts:44，sx-scoped.css:657）；深色 .30 */
  const focusRing = E['shadow-focus']
  const insetInput = E['shadow-inset-input']
  const popShadow = E['shadow-pop']
  const dark = theme === 'dark'
  return {
    common: {
      primaryColor: C.violet,
      primaryColorHover: S.violetHover,
      primaryColorPressed: C.violetPress,
      primaryColorSuppl: C.violetBottom,
      infoColor: C.violet,
      infoColorHover: S.violetHover,
      infoColorPressed: C.violetPress,
      infoColorSuppl: C.violetBottom,
      successColor: C.success,
      successColorHover: S.successHover,
      successColorPressed: S.successPressed,
      successColorSuppl: S.successHover,
      warningColor: C.warning,
      warningColorHover: S.warningHover,
      warningColorPressed: S.warningPressed,
      warningColorSuppl: S.warningHover,
      errorColor: C.danger,
      errorColorHover: S.errorHover,
      errorColorPressed: S.errorPressed,
      errorColorSuppl: S.errorHover,
      bodyColor: C.page,
      cardColor: C.white,
      popoverColor: C.overlay,
      modalColor: C.overlay,
      tableColor: C.white,
      inputColor: C.white,
      actionColor: C.surface3,
      textColorBase: C.ink,
      textColor1: C.ink,
      textColor2: C.ink2,
      textColor3: C.muted,
      placeholderColor: C.placeholder,
      dividerColor: C.line,
      borderColor: C.line,
      borderRadius: '4px',
      fontFamily,
      fontFamilyMono: "'SFMono-Regular', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
      fontSize: '13px',
      fontSizeMini: '11px',
      fontSizeTiny: '11px',
      fontSizeSmall: '12px',
      fontSizeMedium: '13px',
      fontSizeLarge: '14px',
      fontSizeHuge: '16px',
      lineHeight: '1.55',
      fontWeight: '400',
      fontWeightStrong: '600',
      scrollbarColor: dark ? E['scrollbar-thumb'] : 'rgba(31,35,41,.18)',
      scrollbarColorHover: dark ? E['scrollbar-thumb-hover'] : 'rgba(31,35,41,.32)',
      scrollbarWidth: '10px',
      scrollbarHeight: '10px',
      scrollbarBorderRadius: '999px',
    },
    Button: {
      borderRadiusSmall: '8px',
      borderRadiusMedium: '8px',
      borderRadiusLarge: '10px',
      heightSmall: '30px',
      heightMedium: '34px',
      heightLarge: '42px',
      paddingSmall: '0 12px',
      paddingMedium: '0 14px',
      paddingLarge: '0 18px',
      fontSizeSmall: '12px',
      fontSizeMedium: '13px',
      fontSizeLarge: '14px',
      fontWeight: '500',
      colorPrimary: C.violetBottom,
      colorHoverPrimary: C.violetTop,
      colorPressedPrimary: C.violetPress,
      colorFocusPrimary: C.violetTop,
      borderPrimary: `1px solid ${C.violetBorder}`,
      borderHoverPrimary: `1px solid ${C.violetBorder}`,
      borderPressedPrimary: `1px solid ${C.violetPress}`,
      borderFocusPrimary: `1px solid ${C.violetBorder}`,
      textColorPrimary: C.onAccent,
      textColorHoverPrimary: C.onAccent,
      textColorPressedPrimary: C.onAccent,
      textColorFocusPrimary: C.onAccent,
      color: C.white,
      colorHover: C.surface2,
      colorPressed: C.surface3,
      colorFocus: C.white,
      border: `1px solid ${C.control}`,
      borderHover: `1px solid ${C.controlHover}`,
      borderPressed: `1px solid ${C.controlPress}`,
      borderFocus: `1px solid ${C.control}`,
      textColor: C.ink2,
      textColorHover: C.ink,
      textColorPressed: C.ink,
      textColorFocus: C.ink,
    },
    Input: {
      color: C.white,
      colorFocus: C.white,
      colorFocusError: C.white,
      colorFocusWarning: C.white,
      border: `1px solid ${C.control}`,
      borderHover: `1px solid ${C.controlHover}`,
      borderFocus: `1px solid ${C.violet}`,
      borderFocusError: `1px solid ${C.danger}`,
      borderHoverError: `1px solid ${C.danger}`,
      boxShadowFocus: focusRing,
      boxShadowFocusError: E['shadow-focus-danger'],
      placeholderColor: C.placeholder,
      textColor: C.ink,
      heightSmall: '30px',
      heightMedium: '34px',
      fontSizeMedium: '13px',
      paddingMedium: '0 10px',
      borderRadius: '4px',
    },
    InternalSelection: {
      color: C.white,
      colorActive: C.white,
      border: `1px solid ${C.control}`,
      borderHover: `1px solid ${C.controlHover}`,
      borderActive: `1px solid ${C.violet}`,
      borderFocus: `1px solid ${C.violet}`,
      boxShadowActive: focusRing,
      boxShadowFocus: focusRing,
      boxShadowHover: insetInput,
      caretColor: C.violet,
      borderRadius: '4px',
      heightSmall: '30px',
      heightMedium: '34px',
      fontSizeMedium: '13px',
      textColor: C.ink,
      placeholderColor: C.placeholder,
    },
    InternalSelectMenu: {
      // 原型 v3-theme.css:252-292：选项 36 高、容器 r10 + 内边距 6；选项圆角 6 在 base.css（Naive 与容器共用同一变量）
      optionHeightMedium: '36px',
      optionFontSizeMedium: '12px',
      optionTextColor: C.ink,
      optionTextColorActive: C.violetDeep,
      optionTextColorPressed: C.violetDeep,
      optionColorPending: C.surface3,
      optionColorActive: C.violetSoft,
      optionColorActivePending: C.violetSoft2,
      paddingMedium: '6px 0',
      borderRadius: '10px',
      color: C.overlay,
    },
    Tooltip: {
      // 原型 .sx-tooltip__bubble：白底、墨字、1px 线描边、短投影（深色：浮层面）
      color: C.overlay,
      textColor: C.ink2,
      borderRadius: '6px',
      padding: '4px 8px',
      boxShadow: `0 0 0 1px ${C.line}, ${dark ? '0 6px 14px rgba(0,0,0,.45)' : '0 4px 10px rgba(31,35,41,.10)'}`,
    },
    Pagination: {
      itemSizeMedium: '32px',
      itemMarginMedium: '0 0 0 8px',
      itemBorderRadius: '8px',
      itemFontSizeMedium: '13px',
      itemTextColorHover: C.violet,
      itemColorHover: C.surface3,
      itemColorActive: C.violetSoft,
      itemColorActiveHover: C.violetSoft2,
      itemBorderActive: `1px solid ${C.violetLine}`,
      itemTextColorActive: C.violetDeep,
    },
    Tag: {
      borderRadius: '3px',
      heightSmall: '20px',
      heightMedium: '22px',
      padding: '0 6px',
      color: C.surface2,
      colorBordered: C.surface2,
      textColor: C.ink2,
      border: `1px solid ${C.line}`,
      colorInfo: C.violetSoft,
      colorBorderedInfo: C.violetSoft,
      borderInfo: `1px solid ${C.violetLine}`,
      textColorInfo: C.violetDeep,
    },
    Card: {
      // 项目内没有非弹窗的 n-card（登录页的 login-card 只是类名），所以直接取弹窗档位 r18
      borderRadius: '18px',
      closeSize: '28px',
      closeIconSize: '16px',
      closeBorderRadius: '4px',
      closeColorHover: C.surface3,
      closeColorPressed: C.sunken,
      borderColor: C.line,
      paddingMedium: '14px',
      // 其余档位 Naive 写死 px（不随 common 推导），不列出来就不跟「字体显示」缩放；值取 Naive 默认，外观不变
      titleFontSizeSmall: '16px',
      titleFontSizeMedium: '14px',
      titleFontSizeLarge: '18px',
      titleFontSizeHuge: '18px',
      titleFontWeight: '600',
      color: C.white,
      colorModal: C.overlay,
    },
    Radio: {
      buttonColor: C.white,
      buttonColorActive: C.violetBottom,
      buttonBorderColor: C.control,
      buttonBorderColorActive: C.violetBorder,
      buttonTextColor: C.ink2,
      buttonTextColorActive: C.onAccent,
      buttonTextColorHover: C.ink,
      buttonBoxShadow: E['shadow-hairline'],
    },
    Checkbox: {
      borderRadius: '3px',
      sizeSmall: '14px',
      sizeMedium: '14px',
      color: C.white,
      border: `1px solid ${C.control}`,
      colorChecked: C.violet,
      borderChecked: `1px solid ${C.violet}`,
      checkMarkColor: C.onAccent,
      borderFocus: `1px solid ${C.violet}`,
      boxShadowFocus: dark ? '0 0 0 2px rgba(165,134,183,.35)' : '0 0 0 2px rgba(135,95,154,.2)',
      textColor: C.ink2,
      fontSizeSmall: '12px',
    },
    Switch: {
      railColor: dark ? C.control : C.sunken,
      railColorActive: C.violet,
      buttonColor: dark ? '#f1f1f4' : C.white,
    },
    InputNumber: {
      peers: {
        Input: {
          heightMedium: '34px',
          borderRadius: '4px',
          border: `1px solid ${C.control}`,
          borderHover: `1px solid ${C.controlHover}`,
          borderFocus: `1px solid ${C.violet}`,
          boxShadowFocus: focusRing,
        },
      },
    },
    Dropdown: {
      // 原型 v3-theme.css:243-290：r10 白卡 + 6 内边距 + 浮层影，行 36、字 12（§10 下限）、hover 取 surface-3
      color: C.overlay,
      borderRadius: '10px',
      padding: '6px',
      boxShadow: popShadow,
      optionHeightMedium: '36px',
      fontSizeMedium: '12px',
      optionTextColor: C.ink,
      optionTextColorHover: C.ink,
      optionTextColorActive: C.violetDeep,
      optionColorHover: C.surface3,
      optionColorActive: C.violetSoft,
      groupHeaderTextColor: C.muted,
    },
    Popover: {
      color: C.overlay,
      borderRadius: '10px',
      // Naive 的 Popover 主题没有 border 键：1px 线描边用 0 0 0 1px 的扩散影叠在浮层影之外
      boxShadow: `0 0 0 1px ${C.line}, ${popShadow}`,
      textColor: C.ink2,
    },
    Dialog: {
      // 材质对齐：弹窗档位 r18（原型 .wf-modal / op-set 同档）
      borderRadius: '18px',
      color: C.overlay,
      titleFontSize: '16px',
      titleTextColor: C.ink,
      textColor: C.ink2,
    },
    /*
     * 下面几项只为字号缩放：Naive 这些组件的字号在自身主题里写死 px（不从 common.fontSize* 推导），
     * 不在覆盖里出现就不经 textScaleTheme，用户调大字号时标题 / 正文不跟着变。值 = Naive 默认，1× 时外观不变。
     */
    Drawer: {
      titleFontSize: '18px',
    },
    Notification: {
      titleFontSize: '16px',
      metaFontSize: '12px',
      descriptionFontSize: '12px',
    },
    Tabs: {
      tabFontSizeSmall: '14px',
      tabFontSizeMedium: '14px',
      tabFontSizeLarge: '16px',
    },
    Form: {
      feedbackFontSizeSmall: '13px',
      feedbackFontSizeMedium: '14px',
      feedbackFontSizeLarge: '14px',
      labelFontSizeLeftSmall: '14px',
      labelFontSizeLeftMedium: '14px',
      labelFontSizeLeftLarge: '15px',
      labelFontSizeTopSmall: '13px',
      labelFontSizeTopMedium: '14px',
      labelFontSizeTopLarge: '14px',
    },
    Badge: {
      fontSize: '12px',
    },
    Modal: {
      color: C.overlay,
      boxShadow: popShadow,
    },
    Image: {
      // n-image 自带预览的工具条：对齐原型 MediaPreviewToolbar（深色半透明底、r8、白色图标）
      toolbarColor: 'rgba(0, 0, 0, .45)',
      toolbarIconColor: 'rgba(255, 255, 255, .92)',
      toolbarBorderRadius: '8px',
      toolbarBoxShadow: '0 4px 12px rgba(0, 0, 0, .18)',
    },
    Message: {
      // 材质对齐：按钮档位 r14；Toast 2.5s / 最多 3 条 / 顶部居中在 App.vue 的 message-provider 配置
      borderRadius: '14px',
      color: C.overlay,
      boxShadow: popShadow,
      textColor: C.ink2,
      fontSize: '13px',
    },
    DataTable: {
      borderRadius: '8px',
      borderColor: C.line,
      thColor: C.surface2,
      thTextColor: C.muted,
      tdColor: C.white,
      tdTextColor: C.ink2,
      thFontWeight: '600',
      fontSizeMedium: '13px',
    },
  }
}

/** 字号随「字体显示」档位缩放、字体可被偏好覆盖（见 src/utils/textPrefs.ts）；两套各算一次缓存起来 */
const cache: Partial<Record<ThemeName, GlobalThemeOverrides>> = {}
export function naiveThemeOverrides(theme: ThemeName): GlobalThemeOverrides {
  return (cache[theme] ??= textScaleTheme(buildOverrides(theme)))
}

/** Naive 的基础主题：深色用官方 darkTheme 打底（未覆盖到的组件也有合理的深色），浅色用默认（null） */
export function naiveBaseTheme(theme: ThemeName): GlobalTheme | null {
  return theme === 'dark' ? darkTheme : null
}

/**
 * 给 createDiscreteApi 的 configProviderProps：离散挂载的 message / dialog / modal 不在 App.vue 的
 * n-config-provider 之下，不传就永远是 Naive 默认浅色（深色页里弹出白卡）。随「外观」响应式切换。
 */
export const discreteConfigProviderProps = computed<ConfigProviderProps>(() => ({
  theme: naiveBaseTheme(activeTheme.value),
  themeOverrides: naiveThemeOverrides(activeTheme.value),
}))
