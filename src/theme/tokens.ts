/**
 * 语义色令牌 —— 浅色 / 深色两套，全站颜色的唯一来源。
 *
 * <p>两处消费，改一处全站跟着变：
 * - `uno.config.ts`：preflight 把两套值写成 CSS 变量（`--xq-<name>` 原值 + `--xq-<name>-rgb` 三元组），
 *   theme.colors 全部指向变量，`text-ink-2` / `bg-surface2` / `border-line` 这类工具类随主题自动切换；
 * - `src/theme/naive.ts`：Naive 的 CSS-in-JS 要拿真色值做混色，按当前主题取同一份表生成 themeOverrides。
 * 对比度口径：文字 ≥ 4.5、UI 元素（描边 / 焦点 / 图标）≥ 3（改色后按 WCAG 相对亮度公式复核）。
 *
 * <p>手写的 Less / scoped CSS 直接写 `var(--xq-ink)`；要透明度时写 `rgb(var(--xq-ink-rgb) / 0.5)`。
 *
 * <p><b>浅色 = 改造前的样子，一个色值都不变</b>（数值出处：uno.config.ts 原色板、theme/naive.ts 原 C 表、
 * docs/design/ui-design-spec.md）。深色是新设计，口径见下方 {@link dark} 注释。
 *
 * <p>作用域：浅色挂在 `:root` 与任何 `[data-theme='light']` 上，深色挂在 `[data-theme='dark']` 上——
 * 所以子树可以单独锁定主题（设置页的预览卡、始终深色的校色全屏）。
 */

export type ThemeName = 'light' | 'dark'

/** 令牌键：两套必须同键（类型上由 satisfies 约束） */
export type ColorToken = keyof typeof light

const light = {
  /* ---- 面：页面底 / 基础卡面 / 浮起卡 / 浮层 / 内凹 ---- */
  page: '#f5f6f7',
  surface: '#ffffff',
  surface2: '#f7f8f9',
  surface3: '#f3f4f5',
  sunken: '#eff1f3',
  raised: '#ffffff',
  overlay: '#ffffff',
  'ghost-press': '#e9ecef',
  /* 轻拟物按钮 / 设置条的白 → 近白渐变（sx-grad-plate），上传槽底 */
  'plate-top': '#ffffff',
  'plate-bottom': '#fbfcfc',
  /** 白边浮片的描边：浅色仍是白（不改样子），深色要与卡面拉开，否则边看不见 */
  'plate-edge': '#ffffff',
  'upload-bottom': '#f9fafb',
  'upload-hover-bottom': '#fbf7fd',
  /** 选中行内凹渐变的下端（sx-grad-sunk：surface3 → 它） */
  'sunk-bottom': '#fafbfc',
  /** 白瓷材质渐变下端（sx-soft-bg：surface → 它） */
  'soft-bottom': '#f8f9fa',

  /* ---- 线 ---- */
  line: '#e5e7eb',
  'line-soft': '#eff1f3',
  'line-strong': '#d9dde2',
  control: '#c9cfd6',
  'control-hover': '#aeb6bf',
  'control-press': '#b9c0c8',
  'raised-line': '#cecece',
  'raised-hover': '#bdbdbd',
  'shell-line': '#e2e2e2',
  engrave: '#efefef',
  'soft-line': '#c9cdd0',
  'soft-line-focus': '#b9bfc4',

  /* ---- 文字 ---- */
  ink: '#1f2329',
  'ink-2': '#4b5563',
  muted: '#5f6673',
  placeholder: '#6e7681',
  /** 压在实色（藤紫 / 危险）按钮上的字：两套都是白 */
  'on-accent': '#ffffff',

  /* ---- 藤紫 ---- */
  violet: '#875f9a',
  /** 文字用的藤紫（`text-violet`）：浅色与 violet 同值，深色提亮到 ≥ 4.5 */
  'violet-fg': '#875f9a',
  /**
   * 压白字的实色藤紫底（小徽标 / 计数角标 / 选中分段 / 勾选框，`bg-violet-solid` + `text-white` / `text-on-accent`）：
   * 白字 ≥ 4.5（浅色 5.08，与 violet 同值）。violet 本身在深色提亮给描边 / 开关用（白字只有 3.81），所以带字的实色底一律用它。
   * 描边 / 焦点 / 进度条等不带字的仍用 violet。
   */
  'violet-solid': '#875f9a',
  'violet-top': '#8a639f',
  'violet-bottom': '#7a548c',
  'violet-deep': '#6b487c',
  'violet-press': '#5f3f6f',
  /** 文字用的按下 / 悬停深藤紫（text-violet-press）：浅色同 violet-press，深色反而提亮（深底上「更强调」= 更亮） */
  'violet-press-fg': '#5f3f6f',
  'violet-press-border': '#5c3d6b',
  'violet-border': '#6a487b',
  'violet-soft': '#f3edf8',
  'violet-soft-2': '#ede3f2',
  'violet-line': '#d9c7e3',
  'violet-ink': '#6b487c',
  'violet-tint': '#f8f3fc',
  'violet-tint-hover': '#f1e8f9',
  'violet-tint-top': '#fdfbff',
  'violet-hover-top': '#9a6fae',
  'violet-hover-bottom': '#875c9a',
  'violet-disabled': '#cbb9d5',
  /** 页签选中底（sx-pilltab-on） */
  'violet-pill': '#f1ecf3',
  /** 图标底渐变（sx-grad-icon） */
  'violet-icon-a': '#f6effa',
  'violet-icon-b': '#efe6f5',
  /** 白瓷色调钮（sx-soft-btn-tint）的描边与渐变下端 */
  'violet-soft-line': '#e3d3ee',
  'violet-soft-tint': '#fbf8fd',

  /* ---- 语义（低饱和；fill = 实色 / 描边，fg = 文字） ---- */
  danger: '#b4433e',
  'danger-fg': '#b4433e',
  'danger-top': '#c1524c',
  'danger-soft': '#fdf1f0',
  'danger-soft-top': '#fff7f6',
  'danger-line': '#ecc9c6',
  'danger-hover-fg': '#c1524c',
  /** 白瓷危险钮（sx-soft-btn-danger） */
  'danger-strong': '#c24545',
  'danger-strong-hover': '#b03a3a',
  'danger-soft-line': '#f0c9c7',
  'danger-soft-line-hover': '#e7b4b2',
  success: '#34795a',
  'success-fg': '#34795a',
  'success-soft': '#f0f8f4',
  'success-line': '#c7e3d5',
  warning: '#94651f',
  'warning-fg': '#94651f',
  'warning-soft': '#fbf4e8',
  'warning-line': '#ead8b9',
  'info-soft': '#f5eff8',
  'alert-info': '#654876',
  'alert-danger': '#8f4b47',
  'alert-warning': '#7d5a20',

  /* ---- 画布端口 ---- */
  'port-image': '#3f7f96',
  'port-video': '#b45650',
  'port-prompt': '#3e8e6a',
  'port-audio': '#875f9a',

  /* ---- 功能色 ---- */
  /** 键盘焦点环（outline） */
  focus: '#875f9a',
  /** 骨架屏两档 */
  'skeleton-a': '#eff1f3',
  'skeleton-b': '#f7f8f9',
  /** 透明图底的棋盘格两档（图片本身不动，只是背后的格子随主题） */
  'checker-a': '#ffffff',
  'checker-b': '#eceef0',
  /** 画布点阵 */
  'canvas-dot': '#c3c6cb',
} as const

/**
 * 深色：不是纯黑。中性面带极淡的蓝紫冷调（H≈235°，S≈10%），与藤紫同一色温，不发灰不发脏。
 * - 面分五档，越「高」越亮（深色里阴影看不见，层级靠亮度台阶 + 1px 细线表达）：
 *   page #0f1014 → surface #16171c → raised #1a1b21 → overlay #1e1f26，内凹 sunken 比 page 还低一档。
 * - 文字不用纯白：ink #e7e8ec（防眩光），ink-2 / muted / placeholder 逐级降，均对 surface ≥ 4.5。
 * - 藤紫去饱和、提亮：文字用 violet-fg #c3a6d4，描边 / 开关用 violet #9677aa（对面 4.7、白字 3.8），焦点环 #b597c7；
 *   实色按钮仍是品牌藤紫渐变（#8a659d → #77568a，白字 ≥ 5:1），一眼还是小岐的紫，但不发荧光。
 * - 语义色同理：fill 中等明度、fg 提亮、soft 是 4–8% 的色调底。
 */
const dark = {
  page: '#0f1014',
  surface: '#16171c',
  surface2: '#1a1b21',
  surface3: '#22232a',
  sunken: '#111216',
  raised: '#1a1b21',
  overlay: '#1e1f26',
  'ghost-press': '#2a2b33',
  'plate-top': '#1d1e24',
  'plate-bottom': '#191a1f',
  'plate-edge': '#373a44',
  'upload-bottom': '#18191e',
  'upload-hover-bottom': '#201c26',
  'sunk-bottom': '#18191e',
  'soft-bottom': '#18191e',

  line: '#2b2d35',
  'line-soft': '#212228',
  'line-strong': '#373a44',
  control: '#3c3f49',
  'control-hover': '#50545f',
  'control-press': '#464a54',
  'raised-line': '#30323b',
  'raised-hover': '#42454f',
  'shell-line': '#24262d',
  engrave: '#1e1f25',
  'soft-line': '#363943',
  'soft-line-focus': '#50545f',

  ink: '#e7e8ec',
  'ink-2': '#b9bdc7',
  muted: '#9499a5',
  placeholder: '#858b97',
  'on-accent': '#ffffff',

  violet: '#9677aa',
  'violet-fg': '#c3a6d4',
  /** 比 violet 略深：白字 4.82；对 surface 3.71 / overlay 3.41，底块在深色面上仍可辨 */
  'violet-solid': '#856699',
  'violet-top': '#8a659d',
  'violet-bottom': '#77568a',
  'violet-deep': '#c9b0d9',
  'violet-press': '#664879',
  'violet-press-fg': '#dcc9e8',
  'violet-press-border': '#5a3f6a',
  'violet-border': '#5e4470',
  'violet-soft': '#292230',
  'violet-soft-2': '#31283a',
  'violet-line': '#574768',
  'violet-ink': '#cbb3da',
  'violet-tint': '#221d28',
  'violet-tint-hover': '#2a2331',
  'violet-tint-top': '#26202d',
  'violet-hover-top': '#9673a9',
  'violet-hover-bottom': '#836196',
  'violet-disabled': '#463b50',
  'violet-pill': '#2b2433',
  'violet-icon-a': '#2a2331',
  'violet-icon-b': '#241e2b',
  'violet-soft-line': '#4a3d58',
  'violet-soft-tint': '#231e29',

  danger: '#b8504b',
  'danger-fg': '#ee918b',
  'danger-top': '#c45b55',
  'danger-soft': '#2c1b1c',
  'danger-soft-top': '#301d1e',
  'danger-line': '#5b3230',
  'danger-hover-fg': '#f3a59f',
  'danger-strong': '#ee918b',
  'danger-strong-hover': '#f3a59f',
  'danger-soft-line': '#5b3230',
  'danger-soft-line-hover': '#74403d',
  success: '#3f8b68',
  'success-fg': '#73c79e',
  'success-soft': '#14251e',
  'success-line': '#264f3c',
  warning: '#a77a34',
  'warning-fg': '#e1b671',
  'warning-soft': '#2a2216',
  'warning-line': '#574424',
  'info-soft': '#241f2a',
  'alert-info': '#cfb8de',
  'alert-danger': '#eea8a3',
  'alert-warning': '#e4c083',

  'port-image': '#62a7bf',
  'port-video': '#d4807a',
  'port-prompt': '#62b791',
  'port-audio': '#a586b7',

  focus: '#b597c7',
  'skeleton-a': '#1d1e24',
  'skeleton-b': '#25262e',
  'checker-a': '#1c1d22',
  'checker-b': '#26272d',
  'canvas-dot': '#33353d',
} as const satisfies Record<ColorToken, string>

export const palettes: Record<ThemeName, Record<ColorToken, string>> = { light, dark }

/**
 * 非纯色令牌（阴影、遮罩、滚动条、选区、焦点外环）：两套直接写成 CSS 值。
 * 浅色值逐字照搬原 uno boxShadow 表；深色把投影换成「黑色加深 + 极淡顶光」，靠亮度台阶与描边表达层级。
 */
const effectsLight = {
  'shadow-card': 'inset 0 1px 0 #fff, inset 0 -1px 0 #eff1f3, 0 10px 16px rgba(0,0,0,0.04)',
  'shadow-card-v3': '0 1px 2px rgba(31,35,41,0.04), 0 8px 18px rgba(31,35,41,0.05)',
  'shadow-panel': '0 2px 4px -1px rgba(31,35,41,0.08), 0 10px 18px -10px rgba(31,35,41,0.22)',
  'shadow-pop': '0 12px 24px rgba(31,35,41,0.14), 0 2px 6px rgba(31,35,41,0.06)',
  'shadow-raised': '0 1px 2px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.06)',
  'shadow-raised-hover':
    '0 1px 2px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.06), 0 6px 16px rgba(16,24,40,0.09)',
  'shadow-btn': 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 1px rgba(90,60,110,0.18), 0 2px 4px rgba(90,60,110,0.18)',
  'shadow-btn-plate':
    'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(31,35,41,0.04), 0 1px 2px rgba(31,35,41,0.05)',
  'shadow-cast-r': '10px 0 16px -12px rgba(31,35,41,0.22)',
  'shadow-plate': 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(31,35,41,0.04)',
  'shadow-press': 'inset 0 1px 2px rgba(31,35,41,0.12), inset 0 0 0 1px rgba(31,35,41,0.03)',
  'shadow-press-accent': 'inset 0 1px 3px rgba(40,24,48,0.35)',
  'shadow-inset-input': 'inset 0 1px 2px rgba(31,35,41,0.055), inset 0 0 0 1px rgba(255,255,255,0.7)',
  'shadow-sunk': 'inset 0 1px 3px rgba(31,35,41,0.10), inset 0 -1px 0 #fff',
  'shadow-well': 'inset 0 0 16px rgba(31,35,41,0.12), inset 0 1px 0 rgba(31,35,41,0.05)',
  'shadow-focus': '0 0 0 3px rgba(135,95,154,0.14)',
  'shadow-focus-danger': '0 0 0 3px rgba(180,67,62,0.10)',
  'shadow-toast': '0 4px 10px rgba(31,35,41,0.10)',
  'shadow-preview': '0 12px 28px rgba(31,35,41,0.16), 0 2px 6px rgba(31,35,41,0.06)',
  'shadow-node': '0 2px 4px rgba(16,24,40,0.06), 0 16px 36px rgba(16,24,40,0.13)',
  'shadow-soft': '0 6px 16px rgba(31,35,41,0.08), inset 0 1px 0 #fff, inset 0 -3px 6px rgba(31,35,41,0.04)',
  'shadow-soft-hover': '0 2px 6px rgba(31,35,41,0.08), inset 0 1px 0 #fff',
  'shadow-soft-focus':
    'inset 0 2px 6px rgba(31,35,41,0.13), inset 0 1px 2px rgba(31,35,41,0.08), 0 6px 16px rgba(31,35,41,0.08)',
  'shadow-hairline': '0 1px 2px rgba(31,35,41,0.05)',
  'shadow-thumb': '0 1px 3px rgba(31,35,41,0.16)',
  'shadow-overlay-btn': '0 1px 3px rgba(31,35,41,0.18)',
  /** Modal / Drawer 遮罩 */
  scrim: 'rgba(31,35,41,0.32)',
  'scrollbar-thumb': 'rgba(0,0,0,0.18)',
  'scrollbar-thumb-hover': 'rgba(0,0,0,0.32)',
  /** 浅色沿用浏览器默认选区（不改原样子） */
  selection: 'Highlight',
  'selection-ink': 'HighlightText',
  /** 半透明白「玻璃」底（压在图上的按钮、悬浮工具条），深色换成深玻璃 */
  glass: 'rgba(255,255,255,0.88)',
  'glass-strong': 'rgba(255,255,255,0.96)',
  'glass-line': 'rgba(255,255,255,0.6)',
  /*
   * 构建期阴影改写的系数（vite.config.ts themeShadowPostcss / uno postprocess）：
   * 手写 box-shadow 里的墨色 rgba(31,35,41,a) → rgb(var(--xq-shadow-rgb) / calc(a * k))，
   * 白色顶光 rgba(255,255,255,a) / #fff → rgb(var(--xq-hl-rgb) / calc(a * k))。浅色 k = 1，原值不变。
   */
  'shadow-rgb': '31 35 41',
  'shadow-k': '1',
  'hl-rgb': '255 255 255',
  'hl-k': '1',
} as const

export type EffectToken = keyof typeof effectsLight

const effectsDark = {
  'shadow-card': 'inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 18px rgba(0,0,0,0.28)',
  'shadow-card-v3': '0 1px 2px rgba(0,0,0,0.30), 0 8px 18px rgba(0,0,0,0.26)',
  'shadow-panel': '0 2px 4px -1px rgba(0,0,0,0.40), 0 12px 22px -10px rgba(0,0,0,0.55)',
  'shadow-pop': '0 0 0 1px rgba(255,255,255,0.04), 0 14px 28px rgba(0,0,0,0.50), 0 2px 6px rgba(0,0,0,0.30)',
  'shadow-raised': '0 1px 2px rgba(0,0,0,0.32), 0 4px 12px rgba(0,0,0,0.24)',
  'shadow-raised-hover': '0 1px 2px rgba(0,0,0,0.32), 0 4px 12px rgba(0,0,0,0.28), 0 8px 18px rgba(0,0,0,0.30)',
  'shadow-btn': 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 1px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.30)',
  'shadow-btn-plate': 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.35)',
  'shadow-cast-r': '10px 0 16px -12px rgba(0,0,0,0.6)',
  'shadow-plate': 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.25)',
  'shadow-press': 'inset 0 1px 2px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(0,0,0,0.2)',
  'shadow-press-accent': 'inset 0 1px 3px rgba(0,0,0,0.45)',
  'shadow-inset-input': 'inset 0 1px 2px rgba(0,0,0,0.35)',
  'shadow-sunk': 'inset 0 1px 3px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.03)',
  'shadow-well': 'inset 0 0 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(0,0,0,0.3)',
  'shadow-focus': '0 0 0 3px rgba(165,134,183,0.30)',
  'shadow-focus-danger': '0 0 0 3px rgba(238,145,139,0.22)',
  'shadow-toast': '0 0 0 1px rgba(255,255,255,0.05), 0 6px 14px rgba(0,0,0,0.45)',
  'shadow-preview': '0 0 0 1px rgba(255,255,255,0.05), 0 14px 30px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3)',
  'shadow-node': '0 0 0 1px rgba(255,255,255,0.03), 0 2px 4px rgba(0,0,0,0.35), 0 16px 36px rgba(0,0,0,0.45)',
  'shadow-soft': '0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
  'shadow-soft-hover': '0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
  'shadow-soft-focus': 'inset 0 2px 6px rgba(0,0,0,0.5), inset 0 1px 2px rgba(0,0,0,0.35)',
  'shadow-hairline': '0 1px 2px rgba(0,0,0,0.3)',
  'shadow-thumb': '0 1px 3px rgba(0,0,0,0.5)',
  'shadow-overlay-btn': '0 1px 3px rgba(0,0,0,0.45)',
  scrim: 'rgba(0,0,0,0.56)',
  'scrollbar-thumb': 'rgba(255,255,255,0.16)',
  'scrollbar-thumb-hover': 'rgba(255,255,255,0.30)',
  selection: 'rgba(165,134,183,0.42)',
  'selection-ink': '#ffffff',
  glass: 'rgba(22,23,28,0.82)',
  'glass-strong': 'rgba(30,31,38,0.94)',
  'glass-line': 'rgba(255,255,255,0.10)',
  'shadow-rgb': '0 0 0',
  'shadow-k': '2.4',
  'hl-rgb': '255 255 255',
  'hl-k': '0.05',
} as const satisfies Record<EffectToken, string>

export const effects: Record<ThemeName, Record<EffectToken, string>> = { light: effectsLight, dark: effectsDark }

/* ---------------- CSS 变量生成 ---------------- */

export function hexToRgbTriplet(hex: string): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw.slice(0, 6)
  const n = Number.parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function varBlock(theme: ThemeName): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(palettes[theme])) {
    lines.push(`--xq-${k}:${v};`, `--xq-${k}-rgb:${hexToRgbTriplet(v)};`)
  }
  for (const [k, v] of Object.entries(effects[theme])) lines.push(`--xq-${k}:${v};`)
  return lines.join('')
}

/**
 * 两套变量的整段 CSS（uno preflight 注入，打进首个 CSS 文件，<head> 里加载，首屏前就绪）。
 * `color-scheme` 让原生控件、滚动条、表单自动填充底色跟着走。
 */
export function themeCss(): string {
  return (
    `:root,[data-theme='light']{${varBlock('light')}color-scheme:light;}` +
    `[data-theme='dark'],.xq-force-dark{${varBlock('dark')}color-scheme:dark;}`
  )
}

/** UnoCSS 色值：`rgb(var(--xq-ink-rgb) / %alpha)`，支持 `text-ink/50` 这类透明度写法 */
export function unoColor(token: ColorToken): string {
  return `rgb(var(--xq-${token}-rgb) / %alpha)`
}
