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
