/** 校色套件的公共类型（ColorFixPanel 与 useResultColorFix 共用） */

/** 选区方式：整图 / 自动识别 / 手动涂抹 / 点选（本机 SAM 分割，见 pointSegment.ts） */
export type ColorFixRegionMode = 'whole' | 'auto' | 'paint' | 'point'

/** 自动识别的目标（POST /api/v1/studio/masks 的 target） */
export type ColorFixAutoTarget = 'garment' | 'product' | 'person' | 'background'

/** 服装细分部位（POST /api/v1/studio/masks 的 parts，只对 target=garment 有效） */
export type ColorFixGarmentPart = 'tops' | 'coat' | 'pants' | 'skirt' | 'shoes' | 'bag' | 'hat'

/** 部位固定顺序（与服务端一致：缓存键 / 返回顺序都按它） */
export const COLORFIX_GARMENT_PARTS: readonly ColorFixGarmentPart[] = ['tops', 'coat', 'pants', 'skirt', 'shoes', 'bag', 'hat']

export const COLORFIX_PART_LABELS: Record<ColorFixGarmentPart, string> = {
  tops: '上衣',
  coat: '外套',
  pants: '下装',
  skirt: '裙装',
  shoes: '鞋',
  bag: '包',
  hat: '帽',
}

/** 任意部位列表 → 去重、去掉不认识的、按固定顺序 */
export function colorFixPartsSanitize(raw: unknown): ColorFixGarmentPart[] {
  if (!Array.isArray(raw)) return []
  const want = new Set(raw.filter((p): p is string => typeof p === 'string').map((p) => p.trim().toLowerCase()))
  return COLORFIX_GARMENT_PARTS.filter((p) => want.has(p))
}

/** 两组部位是否相同（都已 sanitize：按固定顺序比） */
export function colorFixPartsEqual(a: readonly ColorFixGarmentPart[] | undefined, b: readonly ColorFixGarmentPart[] | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((p, i) => p === y[i])
}

/** 局部调色选区：只在 mode ≠ whole 时 invert / feather 才生效 */
export interface ColorFixRegion {
  mode: ColorFixRegionMode
  target: ColorFixAutoTarget
  /** 只调这些服装部位（target=garment 且服务端支持细分时生效）；空 / 缺省 = 全部服装 */
  parts?: ColorFixGarmentPart[]
  /** 反选：调选区外 */
  invert: boolean
  /** 边缘柔化 0–20（长边 1000px 基准，见 utils/colorfix ColorFixMaskOptions） */
  feather: number
}

export const COLORFIX_REGION_DEFAULT: ColorFixRegion = { mode: 'whole', target: 'garment', invert: false, feather: 4 }

export const COLORFIX_REGION_LABELS: Record<ColorFixRegionMode, string> = {
  whole: '整图',
  auto: '自动识别',
  paint: '手动涂抹',
  point: '点选',
}

export const COLORFIX_TARGET_LABELS: Record<ColorFixAutoTarget, string> = {
  garment: '服装',
  product: '商品',
  person: '人物',
  background: '背景',
}

/** 任意来源的选区设置 → 合法值（缺字段按默认补） */
export function colorFixRegionSanitize(raw: unknown): ColorFixRegion | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const mode = o.mode === 'auto' || o.mode === 'paint' || o.mode === 'point' || o.mode === 'whole' ? o.mode : 'whole'
  const target = typeof o.target === 'string' && o.target in COLORFIX_TARGET_LABELS ? (o.target as ColorFixAutoTarget) : 'garment'
  const feather = typeof o.feather === 'number' && Number.isFinite(o.feather) ? Math.min(20, Math.max(0, Math.round(o.feather))) : COLORFIX_REGION_DEFAULT.feather
  const parts = colorFixPartsSanitize(o.parts)
  return { mode, target, invert: o.invert === true, feather, ...(parts.length ? { parts } : {}) }
}
