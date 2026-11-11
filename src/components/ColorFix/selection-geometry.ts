/**
 * 智能选区的几何纯函数（不碰 DOM，便于单测）：钢笔路径 → 折线（三次贝塞尔展平）、套索路径平滑 / 精简、
 * 多边形抗锯齿栅格化（非零环绕、4 条子扫描线 + 横向精确覆盖）、选区合成（并集 / 差集）、命中测试。
 *
 * <p>坐标约定：调用方传什么坐标系就在什么坐标系里算；栅格化前由调用方把多边形换算到目标网格（{@link scalePolygon}）。
 * 蒙版一律是 0–255 的 Uint8Array（行优先，width × height）。
 */

export interface Pt {
  x: number
  y: number
}

/** 钢笔锚点：(x, y) + 出方向手柄偏移（入手柄 = 镜像）；没有手柄 = 尖角 */
export interface PenNode extends Pt {
  hx?: number
  hy?: number
}

export type ShapeMode = 'add' | 'sub'

export interface SelectionShape {
  id: number
  kind: 'pen' | 'lasso'
  mode: ShapeMode
  /** 闭合多边形（原图像素坐标，首尾不重复） */
  poly: Pt[]
}

const hasHandle = (n: PenNode) => !!(n.hx || n.hy)

/**
 * 三次贝塞尔均匀展平：段数按「二阶差分」误差界 3d/(4n²) ≤ tol 取，结果不含起点、含终点。
 * tol = 允许的最大偏差（与坐标同单位）。
 */
export function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol = 0.5): Pt[] {
  const d = Math.max(
    Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
    Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
  )
  const n = Math.min(128, Math.max(1, Math.ceil(Math.sqrt((3 * d) / (4 * Math.max(1e-6, tol))))))
  const out: Pt[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const e = t * t * t
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y })
  }
  return out
}

/** 钢笔锚点 → 折线；closed = 末点连回首点。两端都没手柄的段是直线 */
export function penToPolyline(nodes: PenNode[], closed: boolean, tol = 0.5): Pt[] {
  if (!nodes.length) return []
  const out: Pt[] = [{ x: nodes[0]!.x, y: nodes[0]!.y }]
  const segs = closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < segs; i++) {
    const a = nodes[i]!
    const b = nodes[(i + 1) % nodes.length]!
    if (!hasHandle(a) && !hasHandle(b)) {
      out.push({ x: b.x, y: b.y })
      continue
    }
    const c1 = { x: a.x + (a.hx ?? 0), y: a.y + (a.hy ?? 0) }
    const c2 = { x: b.x - (b.hx ?? 0), y: b.y - (b.hy ?? 0) }
    out.push(...flattenCubic(a, c1, c2, b, tol))
  }
  // 闭合时最后一段落回首点，去掉重复
  if (closed && out.length > 1) {
    const f = out[0]!
    const l = out[out.length - 1]!
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop()
  }
  return out
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Ramer–Douglas–Peucker 精简（开折线，保留首尾）；eps = 允许偏差 */
export function simplifyPath(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let best = -1
    let dmax = eps
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i]!, pts[s]!, pts[e]!)
      if (d > dmax) {
        dmax = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([s, best], [best, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Chaikin 切角平滑（闭合多边形），每轮点数翻倍 */
export function smoothClosed(pts: Pt[], iterations = 2): Pt[] {
  let cur = pts
  for (let k = 0; k < iterations && cur.length >= 3; k++) {
    const next: Pt[] = []
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]!
      const b = cur[(i + 1) % cur.length]!
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y })
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y })
    }
    cur = next
  }
  return cur
}

/** 套索原始轨迹 → 闭合平滑多边形：先按 eps 精简去手抖，再 Chaikin 两轮 */
export function lassoToPolygon(raw: Pt[], eps: number): Pt[] {
  if (raw.length < 3) return []
  const simple = simplifyPath(raw, eps)
  return simple.length >= 3 ? smoothClosed(simple, 2) : []
}

/** 多边形有向面积（鞋带公式），绝对值 = 面积 */
export function polygonArea(poly: Pt[]): number {
  let s = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    s += (poly[j]!.x + poly[i]!.x) * (poly[j]!.y - poly[i]!.y)
  return s / 2
}

/** 非零环绕判定点是否在多边形内（自交的套索按「绕到就算」） */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let wn = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!
    const b = poly[i]!
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) wn++
    } else if (b.y <= p.y && cross < 0) wn--
  }
  return wn !== 0
}

/** 点到闭合多边形边线的最近距离（选中描边用） */
export function distToPolygonEdge(p: Pt, poly: Pt[]): number {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(p, poly[j]!, poly[i]!))
  return d
}

export function scalePolygon(poly: Pt[], sx: number, sy = sx): Pt[] {
  return poly.map((p) => ({ x: p.x * sx, y: p.y * sy }))
}

/** 子扫描线条数（纵向抗锯齿）；横向按跨度精确算覆盖 */
const SUB = 4

/**
 * 抗锯齿栅格化一个闭合多边形（非零环绕），结果与 out 逐像素取最大写回（多个形状天然取并集）。
 * 像素 (x, y) 覆盖 [x, x+1) × [y, y+1)；多边形坐标须已换算到这张网格。
 */
export function rasterizePolygon(poly: Pt[], width: number, height: number, out: Uint8Array): void {
  if (poly.length < 3 || width <= 0 || height <= 0) return
  let minY = Infinity
  let maxY = -Infinity
  for (const p of poly) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const y0 = Math.max(0, Math.floor(minY))
  const y1 = Math.min(height - 1, Math.ceil(maxY))
  if (y1 < y0) return
  // 边表：只留非水平边，按 ymin 排序后用活动边扫
  const edges: { ya: number; yb: number; x: number; dxdy: number; dir: number }[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!
    const b = poly[i]!
    if (a.y === b.y) continue
    const dir = b.y > a.y ? 1 : -1
    const top = dir > 0 ? a : b
    const bot = dir > 0 ? b : a
    edges.push({ ya: top.y, yb: bot.y, x: top.x, dxdy: (bot.x - top.x) / (bot.y - top.y), dir })
  }
  edges.sort((p, q) => p.ya - q.ya)
  const acc = new Float32Array(width)
  const xs: { x: number; dir: number }[] = []
  let next = 0
  const active: typeof edges = []
  for (let y = y0; y <= y1; y++) {
    acc.fill(0)
    let touched = false
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB
      while (next < edges.length && edges[next]!.ya <= sy) active.push(edges[next++]!)
      xs.length = 0
      for (let k = active.length - 1; k >= 0; k--) {
        const e = active[k]!
        if (e.yb <= sy) {
          active.splice(k, 1)
          continue
        }
        if (e.ya <= sy) xs.push({ x: e.x + (sy - e.ya) * e.dxdy, dir: e.dir })
      }
      if (xs.length < 2) continue
      xs.sort((p, q) => p.x - q.x)
      let wn = 0
      for (let k = 0; k < xs.length - 1; k++) {
        wn += xs[k]!.dir
        if (wn === 0) continue
        const xa = Math.max(0, xs[k]!.x)
        const xb = Math.min(width, xs[k + 1]!.x)
        if (xb <= xa) continue
        touched = true
        const ia = Math.floor(xa)
        const ib = Math.min(width - 1, Math.ceil(xb) - 1)
        if (ia === ib) {
          acc[ia]! += xb - xa
          continue
        }
        acc[ia]! += ia + 1 - xa
        for (let ix = ia + 1; ix < ib; ix++) acc[ix]! += 1
        acc[ib]! += xb - ib
      }
    }
    if (!touched) continue
    const row = y * width
    for (let x = 0; x < width; x++) {
      const a = acc[x]!
      if (a <= 0) continue
      const v = Math.min(255, Math.round((a / SUB) * 255))
      if (v > out[row + x]!) out[row + x] = v
    }
  }
}

/**
 * 合成最终选区：(base ∪ add) − sub，逐像素 max(base, add) × (1 − sub)。
 * base（AI 点选蒙版）可为 null；三者须同网格。
 */
export function combineMasks(
  size: number,
  base: Uint8Array | null,
  add: Uint8Array | null,
  sub: Uint8Array | null,
  out = new Uint8Array(size),
): Uint8Array {
  for (let i = 0; i < size; i++) {
    let v = Math.max(base ? base[i]! : 0, add ? add[i]! : 0)
    if (sub && v) v = Math.round((v * (255 - sub[i]!)) / 255)
    out[i] = v
  }
  return out
}

/** 一组形状（原图坐标）按 add / sub 栅格化到 width × height 网格（sx/sy = 网格 / 原图） */
export function rasterizeShapes(
  shapes: readonly SelectionShape[],
  width: number,
  height: number,
  sx: number,
  sy: number,
): { add: Uint8Array | null; sub: Uint8Array | null } {
  let add: Uint8Array | null = null
  let sub: Uint8Array | null = null
  for (const s of shapes) {
    const target =
      s.mode === 'add' ? (add ??= new Uint8Array(width * height)) : (sub ??= new Uint8Array(width * height))
    rasterizePolygon(scalePolygon(s.poly, sx, sy), width, height, target)
  }
  return { add, sub }
}

/** 蒙版里有没有「算选中」的像素（≥ 50%） */
export function maskHasSelection(mask: Uint8Array | null): boolean {
  if (!mask) return false
  for (let i = 0; i < mask.length; i++) if (mask[i]! >= 128) return true
  return false
}
