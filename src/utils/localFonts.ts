/**
 * 本机已安装字体的列举，供「字体显示」里的字体下拉用。全程只用系统字体，不下载任何网络字体。
 *
 * <p>两条路：
 * 1. Local Font Access API（`window.queryLocalFonts()`，Chromium 103+ / Electron）：需要用户手势 +
 *    `local-fonts` 权限，能拿到完整列表。只在用户点「读取本机字体」时调用。
 * 2. 不支持 / 被拒 / 在不允许的 iframe 里：用常见系统字体清单，逐个做宽度探测，只留本机确实装了的。
 */

export interface LocalFontOption {
  /** CSS 字体族名 */
  family: string
  /** 展示名：清单里有中文名的用中文名，否则同 family */
  label: string
  /** 名字看起来是中文字体（排序靠前用） */
  cjk: boolean
  /** 名字看起来是圆体（下拉里打「圆体」标） */
  rounded: boolean
}

export type LocalFontsSource = 'api' | 'fallback'

export interface LocalFontsResult {
  source: LocalFontsSource
  fonts: LocalFontOption[]
  /** 走了兜底时的原因，给界面一句提示 */
  notice?: string
}

/** 常见系统字体（CSS 族名 + 中文展示名） */
const CURATED: { family: string; label?: string }[] = [
  // Windows
  { family: 'Microsoft YaHei', label: '微软雅黑' },
  { family: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { family: 'DengXian', label: '等线' },
  { family: 'SimSun', label: '宋体' },
  { family: 'NSimSun', label: '新宋体' },
  { family: 'SimHei', label: '黑体' },
  { family: 'KaiTi', label: '楷体' },
  { family: 'FangSong', label: '仿宋' },
  { family: 'Microsoft JhengHei', label: '微软正黑体' },
  { family: 'YouYuan', label: '幼圆' },
  { family: 'Segoe UI' },
  { family: 'Arial' },
  { family: 'Calibri' },
  { family: 'Tahoma' },
  { family: 'Verdana' },
  // macOS
  { family: 'PingFang SC', label: '苹方' },
  { family: 'Hiragino Sans GB', label: '冬青黑体' },
  { family: 'STHeiti', label: '华文黑体' },
  { family: 'STSong', label: '华文宋体' },
  { family: 'STKaiti', label: '华文楷体' },
  { family: 'Songti SC', label: '宋体-简' },
  { family: 'Kaiti SC', label: '楷体-简' },
  { family: 'Yuanti SC', label: '圆体-简' },
  { family: 'Lantinghei SC', label: '兰亭黑-简' },
  { family: 'Yuanti TC', label: '圆体-繁' },
  { family: 'Hiragino Maru Gothic ProN', label: 'ヒラギノ丸ゴ（圆体）' },
  { family: 'SF Pro Rounded' },
  { family: 'Helvetica Neue' },
  { family: 'SF Pro Text' },
  { family: 'SF Pro Display' },
  { family: 'Avenir Next' },
  // Linux / 常见自装
  { family: 'Noto Sans CJK SC', label: 'Noto Sans CJK SC（思源黑体）' },
  { family: 'Noto Serif CJK SC', label: 'Noto Serif CJK SC（思源宋体）' },
  { family: 'Source Han Sans SC', label: '思源黑体' },
  { family: 'Source Han Serif SC', label: '思源宋体' },
  { family: 'WenQuanYi Micro Hei', label: '文泉驿微米黑' },
  { family: 'WenQuanYi Zen Hei', label: '文泉驿正黑' },
  { family: 'HarmonyOS Sans SC', label: 'HarmonyOS Sans' },
  { family: 'MiSans' },
  { family: 'Alibaba PuHuiTi', label: '阿里巴巴普惠体' },
  { family: 'LXGW WenKai', label: '霞鹜文楷' },
  { family: 'Sarasa Gothic SC', label: '更纱黑体' },
  { family: 'Ubuntu' },
  { family: 'Cantarell' },
  { family: 'DejaVu Sans' },
  { family: 'Roboto' },
]

const CJK_NAME =
  /[㐀-鿿]|\b(SC|TC|CN|GB|CJK|JP|KR)\b|YaHei|JhengHei|DengXian|Sim(Sun|Hei)|NSimSun|KaiTi|FangSong|PingFang|Hiragino|STHeiti|STSong|STKaiti|STXihei|STFangsong|Songti|Kaiti|Heiti|Yuanti|Lantinghei|Source Han|WenQuanYi|HarmonyOS|MiSans|PuHuiTi|LXGW|Sarasa/i

function isCjkName(name: string): boolean {
  return CJK_NAME.test(name)
}

const ROUNDED_NAME = /圆|圓|Yuan|Round|Maru/i

export function isRoundedName(name: string): boolean {
  return ROUNDED_NAME.test(name)
}

function sortFonts(list: LocalFontOption[]): LocalFontOption[] {
  return list.sort((a, b) => {
    if (a.cjk !== b.cjk) return a.cjk ? -1 : 1
    return a.label.localeCompare(b.label, 'zh-Hans-CN')
  })
}

/* ---------------- 兜底：宽度探测 ---------------- */

const PROBE_TEXT = 'mmmmmmmmmwwwwwwwwwlli 永和九年 0123456789'
const BASES = ['monospace', 'serif', 'sans-serif'] as const

/**
 * 字体是否装在本机：拿「目标字体, 基准族」与纯基准族各量一次，任一基准下宽度不同即视为已安装。
 * 不用 document.fonts.check：它对未注册的本机字体在多数实现里一律返回 true，判不出来。
 */
function makeProbe(): (family: string) => boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return () => false
  const measure = (font: string) => {
    ctx.font = font
    const m = ctx.measureText(PROBE_TEXT)
    return `${m.width.toFixed(2)}|${(m.actualBoundingBoxAscent ?? 0).toFixed(2)}|${(m.actualBoundingBoxDescent ?? 0).toFixed(2)}`
  }
  const base = Object.fromEntries(BASES.map((b) => [b, measure(`72px ${b}`)])) as Record<string, string>
  return (family: string) => {
    const q = `"${family.replace(/"/g, '\\"')}"`
    return BASES.some((b) => measure(`72px ${q}, ${b}`) !== base[b])
  }
}

/** 本机是否装了中文圆体（「圆体」预设的预览提示用） */
export function hasCjkRoundedFont(families: string[]): boolean {
  const installed = makeProbe()
  return families.some((f) => installed(f))
}

export function detectCuratedFonts(): LocalFontOption[] {
  const installed = makeProbe()
  const out: LocalFontOption[] = []
  for (const f of CURATED) {
    if (!installed(f.family)) continue
    const label = f.label ?? f.family
    out.push({
      family: f.family,
      label,
      cjk: isCjkName(f.family) || !!f.label,
      rounded: isRoundedName(f.family) || isRoundedName(label),
    })
  }
  return sortFonts(out)
}

/* ---------------- Local Font Access API ---------------- */

interface FontDataLike {
  family: string
}
type QueryLocalFonts = () => Promise<FontDataLike[]>

export function supportsLocalFontAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function'
  )
}

const labelOf = new Map(CURATED.filter((f) => f.label).map((f) => [f.family.toLowerCase(), f.label as string]))

/**
 * 读本机字体：必须在点击等用户手势里调用。优先 API，失败 / 不支持时回落到清单探测，并给出原因。
 */
export async function loadLocalFonts(): Promise<LocalFontsResult> {
  if (!supportsLocalFontAccess()) {
    return {
      source: 'fallback',
      fonts: detectCuratedFonts(),
      notice: '当前浏览器不支持读取完整字体列表，已列出本机已安装的常见字体',
    }
  }
  try {
    const query = (window as unknown as { queryLocalFonts: QueryLocalFonts }).queryLocalFonts
    const data = await query()
    const seen = new Map<string, LocalFontOption>()
    for (const d of data) {
      const family = (d.family || '').trim()
      if (!family || family.startsWith('.')) continue // macOS 的 .SF NS 之类系统私有字体
      const key = family.toLowerCase()
      if (seen.has(key)) continue
      const label = labelOf.get(key) ?? family
      seen.set(key, { family, label, cjk: isCjkName(family), rounded: isRoundedName(family) || isRoundedName(label) })
    }
    if (!seen.size) {
      // 权限被拒时部分实现不抛错、只返回空数组
      return {
        source: 'fallback',
        fonts: detectCuratedFonts(),
        notice: '未获得读取字体的权限，已列出本机已安装的常见字体',
      }
    }
    return { source: 'api', fonts: sortFonts([...seen.values()]) }
  } catch (err) {
    const name = (err as { name?: string })?.name
    const notice =
      name === 'NotAllowedError' || name === 'SecurityError'
        ? '未获得读取字体的权限（可在浏览器网站设置里允许「字体」），已列出本机已安装的常见字体'
        : '读取本机字体失败，已列出本机已安装的常见字体'
    return { source: 'fallback', fonts: detectCuratedFonts(), notice }
  }
}
