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

/**
 * 钢笔锚点：(x, y) + 出方向手柄偏移 (hx, hy)；入方向手柄偏移 (ix, iy) 缺省 = 出手柄的镜像（对称），
 * 给了 = 断开对称（Alt 拖手柄）。没有手柄 = 尖角。
 */
export interface PenNode extends Pt {
  hx?: number
  hy?: number
  ix?: number
  iy?: number
}

export type ShapeMode = 'add' | 'sub'

export interface SelectionShape {
  id: number
  /** 钢笔 / 自由（套索）/ 矩形选框 / 椭圆选框 */
  kind: 'pen' | 'lasso' | 'rect' | 'ellipse'
  mode: ShapeMode
  /** 闭合多边形（原图像素坐标，首尾不重复） */
  poly: Pt[]
  /** 钢笔的锚点（闭合路径；可再编辑，改完按它重算 poly） */
  nodes?: PenNode[]
}

const hasHandle = (n: PenNode) => !!(n.hx || n.hy || n.ix || n.iy)

/** 出手柄控制点（绝对坐标） */
export function outHandle(n: PenNode): Pt {
  return { x: n.x + (n.hx ?? 0), y: n.y + (n.hy ?? 0) }
}
/** 入手柄控制点（绝对坐标）：没给 ix / iy 时是出手柄的镜像 */
export function inHandle(n: PenNode): Pt {
  if (n.ix !== undefined || n.iy !== undefined) return { x: n.x + (n.ix ?? 0), y: n.y + (n.iy ?? 0) }
  return { x: n.x - (n.hx ?? 0), y: n.y - (n.hy ?? 0) }
}

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
    out.push(...flattenCubic(a, outHandle(a), inHandle(b), b, tol))
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

// ---------------- 选框（矩形 / 椭圆，2026-11-11） ----------------

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * 选框拖动 → 矩形（x0 ≤ x1、y0 ≤ y1）：square = 正方形 / 正圆（Shift，取两边较长者）；center = 以起点为中心（Alt）。
 */
export function marqueeRect(start: Pt, cur: Pt, opts: { square?: boolean; center?: boolean } = {}): Rect {
  let dx = cur.x - start.x
  let dy = cur.y - start.y
  if (opts.square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx < 0 ? -1 : 1) * m
    dy = (dy < 0 ? -1 : 1) * m
  }
  if (opts.center) return { x0: start.x - Math.abs(dx), y0: start.y - Math.abs(dy), x1: start.x + Math.abs(dx), y1: start.y + Math.abs(dy) }
  return {
    x0: Math.min(start.x, start.x + dx),
    y0: Math.min(start.y, start.y + dy),
    x1: Math.max(start.x, start.x + dx),
    y1: Math.max(start.y, start.y + dy),
  }
}

/** 矩形 → 闭合多边形（顺时针 4 点） */
export function rectPolygon(r: Rect): Pt[] {
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ]
}

/** 内切椭圆 → 闭合多边形：边数按弦高误差 ≤ tol 取（16–360） */
export function ellipsePolygon(r: Rect, tol = 0.5): Pt[] {
  const rx = (r.x1 - r.x0) / 2
  const ry = (r.y1 - r.y0) / 2
  const cx = r.x0 + rx
  const cy = r.y0 + ry
  const R = Math.max(rx, ry, 1e-6)
  // 弦高 = R(1 − cos(π/n)) ≤ tol
  const n = Math.min(360, Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - Math.min(R, tol) / R)))))
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) })
  }
  return out
}

// ---------------- 钢笔路径编辑 ----------------

/** 三次贝塞尔上 t 处的点 */
export function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const e = t * t * t
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y }
}

/**
 * 闭合钢笔路径上离 p 最近的段与参数 t（段 i = 锚点 i → i+1）：每段采样 48 点粗找、再在邻域二分细化。
 * 返回 dist = 最近距离。
 */
export function nearestOnPen(nodes: readonly PenNode[], p: Pt): { seg: number; t: number; dist: number } {
  let best = { seg: -1, t: 0, dist: Infinity }
  const n = nodes.length
  for (let i = 0; i < n; i++) {
    const a = nodes[i]!
    const b = nodes[(i + 1) % n]!
    const c1 = outHandle(a)
    const c2 = inHandle(b)
    const at = (t: number) => cubicAt(a, c1, c2, b, t)
    const N = 48
    let bt = 0
    let bd = Infinity
    for (let k = 0; k <= N; k++) {
      const q = at(k / N)
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bd) {
        bd = d
        bt = k / N
      }
    }
    let lo = Math.max(0, bt - 1 / N)
    let hi = Math.min(1, bt + 1 / N)
    for (let k = 0; k < 20; k++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      const d1 = Math.hypot(at(m1).x - p.x, at(m1).y - p.y)
      const d2 = Math.hypot(at(m2).x - p.x, at(m2).y - p.y)
      if (d1 < d2) hi = m2
      else lo = m1
    }
    const t = (lo + hi) / 2
    const q = at(t)
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < best.dist) best = { seg: i, t, dist: d }
  }
  return best
}

/**
 * 在段 seg 的 t 处插入锚点（de Casteljau 分割，曲线形状不变）：两端锚点的相邻手柄按分割结果改写（断开对称），
 * 新锚点的入 / 出手柄是分割出的两侧控制点。直线段插入的是尖角点。
 */
export function insertPenNode(nodes: readonly PenNode[], seg: number, t: number): PenNode[] {
  const n = nodes.length
  if (seg < 0 || seg >= n) return nodes.slice()
  const a = nodes[seg]!
  const bi = (seg + 1) % n
  const b = nodes[bi]!
  const straight = !hasHandle(a) && !hasHandle(b)
  const list = nodes.map((x) => ({ ...x }))
  if (straight) {
    list.splice(seg + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    return list
  }
  const p0 = a
  const p1 = outHandle(a)
  const p2 = inHandle(b)
  const p3 = b
  const lerp = (u: Pt, v: Pt) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t })
  const q0 = lerp(p0, p1)
  const q1 = lerp(p1, p2)
  const q2 = lerp(p2, p3)
  const r0 = lerp(q0, q1)
  const r1 = lerp(q1, q2)
  const m = lerp(r0, r1)
  // a 的出手柄 → q0；b 的入手柄 → q2（两端都显式写入，保留原来另一侧手柄）
  const A = list[seg]!
  const aIn = inHandle(a)
  A.hx = q0.x - a.x
  A.hy = q0.y - a.y
  A.ix = aIn.x - a.x
  A.iy = aIn.y - a.y
  const B = list[bi]!
  const bOut = outHandle(b)
  B.ix = q2.x - b.x
  B.iy = q2.y - b.y
  B.hx = bOut.x - b.x
  B.hy = bOut.y - b.y
  const mid: PenNode = { x: m.x, y: m.y, hx: r1.x - m.x, hy: r1.y - m.y, ix: r0.x - m.x, iy: r0.y - m.y }
  list.splice(seg + 1, 0, mid)
  return list
}

/**
 * 拖手柄：which = 'out' / 'in'，to = 手柄新位置（绝对坐标）。breakSym（Alt）= 只动这一侧（断开对称）；
 * 否则另一侧按镜像跟着动（对称点保持对称；已断开的点另一侧保持原长度、方向取反）。
 */
export function movePenHandle(node: PenNode, which: 'out' | 'in', to: Pt, breakSym: boolean): PenNode {
  const dx = to.x - node.x
  const dy = to.y - node.y
  const symmetric = node.ix === undefined && node.iy === undefined
  if (breakSym) {
    const o = outHandle(node)
    const i = inHandle(node)
    return which === 'out'
      ? { x: node.x, y: node.y, hx: dx, hy: dy, ix: i.x - node.x, iy: i.y - node.y }
      : { x: node.x, y: node.y, hx: o.x - node.x, hy: o.y - node.y, ix: dx, iy: dy }
  }
  if (symmetric) return which === 'out' ? { x: node.x, y: node.y, hx: dx, hy: dy } : { x: node.x, y: node.y, hx: -dx, hy: -dy }
  // 已断开：另一侧保持长度、方向与拖动侧相反（共线）
  const other = which === 'out' ? inHandle(node) : outHandle(node)
  const len = Math.hypot(other.x - node.x, other.y - node.y)
  const d = Math.hypot(dx, dy) || 1
  const ox = (-dx / d) * len
  const oy = (-dy / d) * len
  return which === 'out' ? { x: node.x, y: node.y, hx: dx, hy: dy, ix: ox, iy: oy } : { x: node.x, y: node.y, hx: ox, hy: oy, ix: dx, iy: dy }
}

// ---------------- 选区轮廓（「轮廓」查看方式：行军蚁） ----------------

/**
 * 蒙版在阈值处的等值线（marching squares，像素中心为格点），连成折线返回（网格坐标，闭合的首尾相同）。
 * 只用于显示：鞍点按格心平均值消歧；结果按 eps 精简（默认 0.35 像素）。
 */
export function maskContours(mask: Uint8Array, width: number, height: number, threshold = 128, eps = 0.35): Pt[][] {
  const W = width
  const H = height
  if (W < 1 || H < 1) return []
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]!)
  // 在 (−1..W) × (−1..H) 的格子上跑，四周补 0 让轮廓闭合；格点 (x, y) 位于像素中心 (x + 0.5, y + 0.5)
  const segs: number[] = []
  const interp = (a: number, b: number) => {
    const d = b - a
    return d === 0 ? 0.5 : Math.min(1, Math.max(0, (threshold - a) / d))
  }
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = v(x, y)
      const tr = v(x + 1, y)
      const br = v(x + 1, y + 1)
      const bl = v(x, y + 1)
      const code = (tl >= threshold ? 8 : 0) | (tr >= threshold ? 4 : 0) | (br >= threshold ? 2 : 0) | (bl >= threshold ? 1 : 0)
      if (code === 0 || code === 15) continue
      const cx = x + 0.5
      const cy = y + 0.5
      const top = [cx + interp(tl, tr), cy]
      const right = [cx + 1, cy + interp(tr, br)]
      const bottom = [cx + interp(bl, br), cy + 1]
      const left = [cx, cy + interp(tl, bl)]
      const add = (p: number[], q: number[]) => segs.push(p[0]!, p[1]!, q[0]!, q[1]!)
      switch (code) {
        case 1:
        case 14:
          add(left, bottom)
          break
        case 2:
        case 13:
          add(bottom, right)
          break
        case 3:
        case 12:
          add(left, right)
          break
        case 4:
        case 11:
          add(top, right)
          break
        case 6:
        case 9:
          add(top, bottom)
          break
        case 7:
        case 8:
          add(left, top)
          break
        case 5:
        case 10: {
          const center = (tl + tr + br + bl) / 4 >= threshold
          if ((code === 5) === center) {
            add(left, top)
            add(bottom, right)
          } else {
            add(left, bottom)
            add(top, right)
          }
          break
        }
      }
    }
  }
  // 端点拼接：按端点坐标（量化到 1/1024）建索引，贪心串成折线
  const key = (x: number, y: number) => `${Math.round(x * 1024)},${Math.round(y * 1024)}`
  const n = segs.length / 4
  const used = new Uint8Array(n)
  const at = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    for (const e of [0, 1]) {
      const k = key(segs[i * 4 + e * 2]!, segs[i * 4 + e * 2 + 1]!)
      const list = at.get(k)
      if (list) list.push(i)
      else at.set(k, [i])
    }
  }
  const lines: Pt[][] = []
  const takeFrom = (x: number, y: number): [number, number, number] | null => {
    const list = at.get(key(x, y))
    if (!list) return null
    for (const i of list) {
      if (used[i]) continue
      used[i] = 1
      const ax = segs[i * 4]!
      const ay = segs[i * 4 + 1]!
      const bx = segs[i * 4 + 2]!
      const by = segs[i * 4 + 3]!
      return key(ax, ay) === key(x, y) ? [bx, by, i] : [ax, ay, i]
    }
    return null
  }
  for (let i = 0; i < n; i++) {
    if (used[i]) continue
    used[i] = 1
    const line: Pt[] = [
      { x: segs[i * 4]!, y: segs[i * 4 + 1]! },
      { x: segs[i * 4 + 2]!, y: segs[i * 4 + 3]! },
    ]
    for (;;) {
      const last = line[line.length - 1]!
      const nx = takeFrom(last.x, last.y)
      if (!nx) break
      line.push({ x: nx[0], y: nx[1] })
    }
    for (;;) {
      const first = line[0]!
      const nx = takeFrom(first.x, first.y)
      if (!nx) break
      line.unshift({ x: nx[0], y: nx[1] })
    }
    if (line.length >= 2) lines.push(eps > 0 && line.length > 3 ? simplifyPath(line, eps) : line)
  }
  return lines
}

/** 折线组 → SVG path（坐标乘 sx / sy；保留 1 位小数） */
export function contoursToPath(lines: readonly Pt[][], sx = 1, sy = sx): string {
  const f = (n: number) => Math.round(n * 10) / 10
  let d = ''
  for (const l of lines) {
    if (l.length < 2) continue
    d += `M${f(l[0]!.x * sx)} ${f(l[0]!.y * sy)}`
    for (let i = 1; i < l.length; i++) d += `L${f(l[i]!.x * sx)} ${f(l[i]!.y * sy)}`
  }
  return d
}
