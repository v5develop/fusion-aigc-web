/**
 * 阴影跟主题走的构建期改写（vite.config.ts 的 PostCSS 插件 + uno.config.ts 的 postprocess 共用）。
 *
 * <p>全站手写的投影有几百处（`shadow-[0_1px_2px_rgba(31,35,41,0.05)]`、Less 里的 `box-shadow`），
 * 浅色下是「墨色投影 + 白色顶光」。深色下墨色投影压在深底上看不见，白色顶光则变成刺眼的亮线。
 * 逐处改源码既啰嗦又容易漏，所以只在 box-shadow 值里做两种替换：
 * - 墨色 / 黑色投影 `rgba(31,35,41,a)`、`rgba(16,24,40,a)`、`rgba(15,23,42,a)`、`rgba(0,0,0,a)`
 *   → `rgb(var(--xq-shadow-rgb) / calc(a * var(--xq-shadow-k)))`（深色 = 纯黑、加深 2.4 倍，超过 1 浏览器自动截断）；
 * - 白色顶光 `#fff` / `#ffffff` / `white` / `rgba(255,255,255,a)`
 *   → `rgb(var(--xq-hl-rgb) / calc(a * var(--xq-hl-k)))`（深色只留 5%）。
 * 浅色下两个系数都是 1、颜色三元组就是原色，渲染结果与改写前逐像素一致。
 *
 * <p>不碰品牌色投影（藤紫按钮的 rgba(90,60,110,…)）与已经写成 var() 的值；变量与系数定义见 src/theme/tokens.ts。
 */

const NUM = String.raw`(\d*\.?\d+%?)`
const INK_RGBA = new RegExp(
  String.raw`rgba?\(\s*(?:31\s*,\s*35\s*,\s*41|16\s*,\s*24\s*,\s*40|15\s*,\s*23\s*,\s*42|0\s*,\s*0\s*,\s*0)\s*,\s*${NUM}\s*\)`,
  'gi',
)
const INK_RGB_SLASH = new RegExp(String.raw`rgba?\(\s*(?:31 35 41|16 24 40|15 23 42|0 0 0)\s*\/\s*${NUM}\s*\)`, 'gi')
const WHITE_RGBA = new RegExp(String.raw`rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*${NUM}\s*\)`, 'gi')
const WHITE_RGB_SLASH = new RegExp(String.raw`rgba?\(\s*255 255 255\s*\/\s*${NUM}\s*\)`, 'gi')
const WHITE_WORD = /(^|[\s,(])(#fff(?:fff)?|white)(?=$|[\s,)])/gi
/** 压缩后的 8 位 hex（#0000000a 之类）：只在 uno 生成的值里可能出现 */
const INK_HEX8 = /#(1f2329|101828|000000)([0-9a-f]{2})\b/gi
const WHITE_HEX8 = /#ffffff([0-9a-f]{2})\b/gi

function alphaOf(raw: string): string {
  return raw.endsWith('%') ? String(Number(raw.slice(0, -1)) / 100) : raw
}
const ink = (a: string) => `rgb(var(--xq-shadow-rgb) / calc(${alphaOf(a)} * var(--xq-shadow-k)))`
const hl = (a: string) => `rgb(var(--xq-hl-rgb) / calc(${alphaOf(a)} * var(--xq-hl-k)))`
const hexAlpha = (h: string) => String(Math.round((Number.parseInt(h, 16) / 255) * 1000) / 1000)

/** 是否是要改写的阴影属性（含 uno 的 --un-shadow 与 Naive 的 --n-box-shadow 这类变量） */
export function isShadowProp(prop: string): boolean {
  const p = prop.toLowerCase()
  return p === 'box-shadow' || p === '--un-shadow' || p === '--un-inset-shadow' || /^--n-[\w-]*box-shadow$/.test(p)
}

export function rewriteShadow(value: string): string {
  if (!value || value.includes('--xq-')) return value
  return value
    .replace(INK_RGBA, (_, a: string) => ink(a))
    .replace(INK_RGB_SLASH, (_, a: string) => ink(a))
    .replace(WHITE_RGBA, (_, a: string) => hl(a))
    .replace(WHITE_RGB_SLASH, (_, a: string) => hl(a))
    .replace(INK_HEX8, (_, _c: string, a: string) => ink(hexAlpha(a)))
    .replace(WHITE_HEX8, (_, a: string) => hl(hexAlpha(a)))
    .replace(WHITE_WORD, (_, pre: string) => `${pre}${hl('1')}`)
}
