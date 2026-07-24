// 图片模块标准尺寸 ←→ 宽高比标签。
// gcd 约分对部分尺寸得不到设计期望值（如 832×1216 约分为 13:19，实际要 2:3），
// 故用精确映射兜底，未命中的非标准尺寸再退回 gcd 约分。

/** 图片比例选项：value 为 "宽,高" 像素、label 为宽高比。作为尺寸↔比例的单一数据源。 */
export const imageRatioOps = [
  { label: '1:1', value: '1024,1024' },
  { label: '2:3', value: '832,1216' },
  { label: '3:2', value: '1216,832' },
  { label: '3:4', value: '864,1152' },
  { label: '4:3', value: '1152,864' },
  { label: '9:16', value: '720,1280' },
  { label: '16:9', value: '1280,720' },
]

const SIZE_TO_RATIO: Record<string, string> = Object.fromEntries(
  imageRatioOps.map((o) => [o.value, o.label]),
)

function gcd(a: number, b: number): number {
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

/** 宽高 → 画幅比例标签：优先精确映射，否则按 gcd 约分；无尺寸返回 ''。 */
export function ratioLabel(w?: number, h?: number): string {
  if (!w || !h) return ''
  const exact = SIZE_TO_RATIO[`${w},${h}`]
  if (exact) return exact
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

/**
 * 素材真实宽高比 → CSS aspect-ratio 值（如 "16 / 9"）。
 * 优先用 width/height 数值，其次解析 ratio 字符串（"W:H"，兼容全角冒号），都没有则回退。
 * 用于让展示容器按素材真实比例排布，避免裁剪/变形。
 */
/**
 * 素材是否为竖屏：优先像素尺寸，其次解析 ratio/aspectRatio 字符串（"W:H"，兼容全角冒号），
 * 最后回退到请求入参 params.aspectRatio。用于决定视频在 16:9 容器内用 contain 还是 cover。
 */
export function isPortraitMedia(item: any, fallbackParams?: any): boolean {
  const w = Number(item?.width)
  const h = Number(item?.height)
  if (w > 0 && h > 0) return h > w
  const ratioStr = String(item?.ratio ?? item?.aspectRatio ?? fallbackParams?.aspectRatio ?? '')
  const m = /^(\d+)\s*[:：]\s*(\d+)$/.exec(ratioStr)
  if (m && +m[1]! > 0 && +m[2]! > 0) return +m[2]! > +m[1]!
  return false
}

export function mediaAspectRatio(item: any, fallback = '1 / 1'): string {
  const w = Number(item?.width)
  const h = Number(item?.height)
  if (w > 0 && h > 0) return `${w} / ${h}`
  // ratio（素材实际）/ aspectRatio（视频请求入参）均为 "W:H" 字符串，兼容全角冒号
  const m = /^(\d+)\s*[:：]\s*(\d+)$/.exec(String(item?.ratio ?? item?.aspectRatio ?? ''))
  if (m && +m[1]! > 0 && +m[2]! > 0) return `${m[1]} / ${m[2]}`
  return fallback
}
