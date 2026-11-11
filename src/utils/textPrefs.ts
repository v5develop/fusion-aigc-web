/**
 * 「字体显示」偏好：字号档位 + 字体，按账号存本机，启动时在挂载前套上（无闪烁）。
 *
 * <p><b>为什么是「字号乘数」而不是整页 zoom / 根 rem</b>：
 * - 全站字号几乎都是 px（UnoCSS `text-13px`、Less `font-size: 14px`），改根字号不起作用；
 * - CSS `zoom` 会改坐标系：画布（Vue Flow 的 screenToFlowCoordinate）、BarSlider、
 *   遮罩画笔 / 框选、MediaLightbox 平移缩放、ResizeObserver 布局、按 getBoundingClientRect 定位的浮层
 *   都要逐个校正，而且 Chromium 128 前后 zoom 下的 rect / offset 语义还不一样（Electron 客户端内核版本不定）。
 * - 乘数只改字号，不动任何盒子尺寸与坐标，所以上面那些指针 / 测量代码零改动。
 *
 * <p>落地方式：构建期 PostCSS（vite.config.ts 的 textScalePostcss）把所有 `font-size: Npx|Nrem`
 * 改写成 `calc(Npx * var(--xq-fs, 1))`，站点字体栈改写成 `var(--xq-font-family, 原字体栈)`；
 * Naive 的 CSS-in-JS 不经过 PostCSS，主题里的 fontSize* 由 {@link textScaleTheme} 改成同样的 calc 串。
 * 运行时只往 `<html>` 上写两个 CSS 变量，任何子树可以把 `--xq-fs` 重置回 1 自行豁免（画布节点区就是这样做的）。
 *
 * <p>只用本机 / 系统字体，不下载任何网络字体。后端暂无用户偏好接口，跨设备同步需要后端加字段。
 * 本模块不发请求，只依赖 auth-session（纯 localStorage / JWT 解码），可被 main.ts 等底层模块依赖；
 * auth-session 反过来不 import 本模块（它用字面量前缀），避免循环。
 */
import { ref } from 'vue'
import { identityOf } from '@/utils/auth-session.ts'

export type TextScale = 'sm' | 'md' | 'lg' | 'xl'
/** default 站点字体栈 / system 系统界面字体 / readable 更易读 / rounded 圆体 / local 用户选的本机字体（family 字段） */
export type TextFont = 'default' | 'system' | 'readable' | 'rounded' | 'local'

export interface TextPrefs {
  scale: TextScale
  font: TextFont
  /** font === 'local' 时的字体族名（来自本机字体列表） */
  family: string
}

export const TEXT_SCALES: { value: TextScale; label: string; factor: number }[] = [
  { value: 'sm', label: '小', factor: 0.92 },
  { value: 'md', label: '标准', factor: 1 },
  { value: 'lg', label: '大', factor: 1.1 },
  { value: 'xl', label: '特大', factor: 1.2 },
]

/** 站点字体栈（与 base.css / uno.config.ts / theme/naive.ts 同一份） */
export const SITE_FONT_STACK =
  "'Smartisan Compact', 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"

/** 系统界面字体：各平台的 UI 字体，中文落到系统自带黑体 */
const SYSTEM_FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

/** 更易读：字面大、笔画清楚的系统黑体优先（配合 base.css 里的加宽字距） */
const READABLE_FONT_STACK =
  "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Segoe UI', Roboto, sans-serif"

/** 圆体：只列本机可能自带的圆体（ui-rounded 在 macOS/iOS 给拉丁字母圆体），中文缺圆体时回落站点字体栈 */
export const ROUNDED_CJK_FAMILIES = ['Yuanti SC', '圆体-简', 'Yuanti TC', 'YouYuan', '幼圆']
const ROUNDED_FONT_STACK =
  "ui-rounded, 'SF Pro Rounded', 'Yuanti SC', '圆体-简', 'Yuanti TC', 'YouYuan', '幼圆', " +
  "'Hiragino Maru Gothic ProN', 'M PLUS Rounded 1c', 'Varela Round', 'Nunito', " +
  SITE_FONT_STACK

export const DEFAULT_TEXT_PREFS: Readonly<TextPrefs> = { scale: 'md', font: 'default', family: '' }

const KEY_PREFIX = 'xq-text-prefs'
/** auth-session 换号清缓存时保留这类 key：它们本身按账号分开存，不会串号 */
export const TEXT_PREFS_KEY_PREFIX = `${KEY_PREFIX}:`

const FAMILY_MAX = 120

export function scaleFactor(scale: TextScale): number {
  return TEXT_SCALES.find((s) => s.value === scale)?.factor ?? 1
}

/** 字体族名转成 CSS 字符串字面量（双引号包裹、转义反斜杠与引号、去掉控制字符） */
export function quoteFamily(family: string): string {
  const clean = family.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, FAMILY_MAX)
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 当前偏好对应的整条字体栈；default 返回空串 = 不覆盖，走各处原写的站点字体栈 */
export function fontStackOf(p: Pick<TextPrefs, 'font' | 'family'>): string {
  switch (p.font) {
    case 'system':
      return SYSTEM_FONT_STACK
    case 'readable':
      return READABLE_FONT_STACK
    case 'rounded':
      return ROUNDED_FONT_STACK
    case 'local':
      // 选中的本机字体放第一位，站点字体栈兜底（缺字时回落）
      return p.family ? `${quoteFamily(p.family)}, ${SITE_FONT_STACK}` : ''
    default:
      return ''
  }
}

function normalize(raw: unknown): TextPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TextPrefs>
  const scale = TEXT_SCALES.some((s) => s.value === r.scale) ? (r.scale as TextScale) : DEFAULT_TEXT_PREFS.scale
  const family = typeof r.family === 'string' ? r.family.trim().slice(0, FAMILY_MAX) : ''
  let font: TextFont = (['default', 'system', 'readable', 'rounded', 'local'] as const).includes(r.font as TextFont)
    ? (r.font as TextFont)
    : 'default'
  if (font === 'local' && !family) font = 'default'
  return { scale, font, family: font === 'local' ? family : '' }
}

/* ---------------- 账号身份（同 asset-recent：取自 accessToken 的 JWT 指纹，与 auth-session 换号检测同一份解码） ---------------- */

/** 当前账号的存储 key；未登录（取不到身份）时为空串 = 不读不写，用默认 */
function storageKey(): string {
  try {
    const token = localStorage.getItem('fusion_accessToken')
    const who = (token && identityOf(token)) || ''
    return who ? `${TEXT_PREFS_KEY_PREFIX}${who}` : ''
  } catch {
    return ''
  }
}

function readStored(key: string): TextPrefs {
  if (!key) return { ...DEFAULT_TEXT_PREFS }
  try {
    const raw = localStorage.getItem(key)
    return normalize(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_TEXT_PREFS }
  }
}

/* ---------------- 运行时状态与应用 ---------------- */

/** 当前生效的偏好（设置页直接绑这个） */
export const textPrefs = ref<TextPrefs>({ ...DEFAULT_TEXT_PREFS })
let currentKey = ''

/** 把偏好写到 <html>：--xq-fs 字号乘数、--xq-font-family 字体栈、data-xq-font 供 base.css 加字距 */
function apply(p: TextPrefs) {
  const root = document.documentElement
  const factor = scaleFactor(p.scale)
  if (factor === 1) root.style.removeProperty('--xq-fs')
  else root.style.setProperty('--xq-fs', String(factor))

  const stack = fontStackOf(p)
  if (stack) root.style.setProperty('--xq-font-family', stack)
  else root.style.removeProperty('--xq-font-family')

  if (p.font === 'default') root.removeAttribute('data-xq-font')
  else root.setAttribute('data-xq-font', p.font)
}

/**
 * 按当前账号读本机缓存并套用。main.ts 挂载前调用一次（首屏无闪烁），
 * 之后每次路由切换调用：登录 / 宿主换号后 token 变了，这里会跟着换成新账号的偏好。
 */
export function syncTextPrefsWithAccount() {
  const key = storageKey()
  if (key === currentKey && key) return
  currentKey = key
  textPrefs.value = readStored(key)
  apply(textPrefs.value)
}

/** 修改偏好：立即生效 + 写本机缓存 */
export function setTextPrefs(patch: Partial<TextPrefs>) {
  const next = normalize({ ...textPrefs.value, ...patch })
  textPrefs.value = next
  apply(next)
  if (!currentKey) return
  try {
    const isDefault = next.scale === DEFAULT_TEXT_PREFS.scale && next.font === DEFAULT_TEXT_PREFS.font && !next.family
    if (isDefault) localStorage.removeItem(currentKey)
    else localStorage.setItem(currentKey, JSON.stringify(next))
  } catch {
    /* 隐私模式 / 配额：本次会话内仍然生效，只是下次打开回到默认 */
  }
}

export function resetTextPrefs() {
  setTextPrefs({ ...DEFAULT_TEXT_PREFS })
}

/**
 * 别的标签页改了偏好 / 换了账号：同步过来。storage 事件不在写入方标签页触发，
 * 这里也只读不写，所以不会在标签页之间来回弹。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || (currentKey && e.key === currentKey)) {
      currentKey = ''
      syncTextPrefsWithAccount()
    } else if (e.key === 'fusion_accessToken') {
      // 另一个标签页登录 / 换号：同账号时 sync 直接返回
      syncTextPrefsWithAccount()
    }
  })
}

/* ---------------- Naive 主题 ---------------- */

const PX_OR_REM = /^(-?\d*\.?\d+)(px|rem)$/

/**
 * 把 Naive 主题覆盖里的 fontSize* 改成随乘数缩放的 calc 串，fontFamily 改成可被偏好覆盖的变量。
 * Naive 的样式是运行时 CSS-in-JS，不经过 PostCSS，只能在主题对象上做同样的改写。
 * 用 CSS 变量而不是 JS 乘好的数：主题对象保持静态，且子树把 --xq-fs 重置为 1 时 Naive 控件也跟着豁免。
 */
export function textScaleTheme<T extends object>(theme: T): T {
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      if (/fontsize/i.test(key) && PX_OR_REM.test(v.trim())) return `calc(${v.trim()} * var(--xq-fs, 1))`
      if (key === 'fontFamily') return `var(--xq-font-family, ${v})`
      return v
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, unknown> = {}
      for (const [k, child] of Object.entries(v)) out[k] = walk(child, k)
      return out
    }
    return v
  }
  return walk(theme, '') as T
}
