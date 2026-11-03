/**
 * 局部重绘（POST /api/v1/tools/ai-inpaint）的区域换算。
 *
 * <p>界面上每张图框一个矩形，存成 0–1 比例的 {left, top, right, bottom}；出网时换成 Java
 * `CoreToolSubmissionRequest.InpaintImage.bbox`：恰好 4 个比例点，顺序固定左上、右上、右下、左下
 * （少一个或多一个 Java 直接拒；bbox 丢了会变成全图重绘，所以每张图都必须框选后才放行提交）。
 */

/** 一张图上的重绘区域，四边都是 0–1 的比例（左上角为原点，x 向右、y 向下） */
export interface InpaintBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** 按图片地址存各自的区域（换图 / 删图后对不上的区域自然作废） */
export type InpaintBoxes = Record<string, InpaintBox>

export interface RatioPoint {
  x: number
  y: number
}

/** Java 侧单张上限 2（契约 images 1–2 项） */
export const INPAINT_MAX_IMAGES = 2

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
/** 4 位小数足够定位到万分之一，也避免浮点尾巴进请求体 */
const round4 = (n: number) => Math.round(clamp01(n) * 10000) / 10000

/** 两个对角点 → 规整的矩形（任意拖拽方向都成立） */
export function boxFromCorners(a: RatioPoint, b: RatioPoint): InpaintBox {
  return {
    left: clamp01(Math.min(a.x, b.x)),
    top: clamp01(Math.min(a.y, b.y)),
    right: clamp01(Math.max(a.x, b.x)),
    bottom: clamp01(Math.max(a.y, b.y)),
  }
}

/** 矩形 → Java bbox：左上、右上、右下、左下 */
export function boxToBbox(box: InpaintBox): RatioPoint[] {
  const l = round4(box.left)
  const t = round4(box.top)
  const r = round4(box.right)
  const b = round4(box.bottom)
  return [
    { x: l, y: t },
    { x: r, y: t },
    { x: r, y: b },
    { x: l, y: b },
  ]
}

/** Java bbox → 矩形（重新编辑回填）；不是恰好 4 个合法比例点、或面积为 0 时返回 undefined */
export function bboxToBox(v: unknown): InpaintBox | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined
  const points: RatioPoint[] = []
  for (const p of v) {
    if (!p || typeof p !== 'object') return undefined
    const { x, y } = p as Record<string, unknown>
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined
    if (x < 0 || x > 1 || y < 0 || y > 1) return undefined
    points.push({ x, y })
  }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
  return box.right > box.left && box.bottom > box.top ? box : undefined
}

/** 请求体 images：按上传顺序，每张图带上自己的 bbox（没框选的图不该走到这里，见 inpaintMissingReason） */
export function inpaintImages(urls: readonly string[], boxes: InpaintBoxes) {
  return urls.flatMap((url) => {
    const box = boxes[url]
    return box ? [{ url, bbox: boxToBbox(box) }] : []
  })
}

/** 还不能提交的原因；全部框好返回空串 */
export function inpaintMissingReason(urls: readonly string[], boxes: InpaintBoxes): string {
  if (!urls.length) return ''
  const missing = urls.findIndex((url) => !boxes[url])
  if (missing < 0) return ''
  return urls.length > 1 ? `请在第 ${missing + 1} 张图上框出要重绘的区域` : '请在图上框出要重绘的区域'
}

/** 重新编辑：原始提交体的 images → { 地址列表, 各自区域 }；认不出的项忽略 */
export function restoredInpaint(v: unknown): { urls: string[]; boxes: InpaintBoxes } {
  const urls: string[] = []
  const boxes: InpaintBoxes = {}
  if (!Array.isArray(v)) return { urls, boxes }
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const { url, bbox } = raw as Record<string, unknown>
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || urls.includes(url)) continue
    urls.push(url)
    const box = bboxToBox(bbox)
    if (box) boxes[url] = box
    if (urls.length >= INPAINT_MAX_IMAGES) break
  }
  return { urls, boxes }
}
