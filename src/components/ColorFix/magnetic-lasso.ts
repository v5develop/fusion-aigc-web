/**
 * 磁性套索（自由工具「吸附边缘」）：live-wire / intelligent scissors（Mortensen & Barrett 1995）的纯函数部分。
 *
 * <ul>
 *   <li>{@link edgeCostMap}：工作网格（长边 ≤1024，与魔棒 / 点选同一网格）上的 OKLab → 边缘特征：
 *       梯度幅值（三通道 Sobel 合成结构张量，亮度 + 色度一起算，按 p99.5 归一到 0–1）、梯度方向（垂直方向单位向量，
 *       方向代价用）、Laplacian 过零（5×5 二项式平滑后的 4 邻域 Laplacian，按亮度算）。每张图算一次（Worker 里），缓存。</li>
 *   <li>{@link LiveWire}：从一个种子出发的增量 Dijkstra（Dial 桶队列，代价量化成 0–255 整数），限制在种子周围的窗口里；
 *       指针移动时只把波前推进到目标点为止，已展开的区域直接回溯，所以同一种子下多次查询几乎是 O(路径长)。
 *       局部代价 l(p,q) = 0.43·fZ(q) + 0.43·fD(p,q) + 0.14·fG(q)（经典权重），fG 横 / 竖步乘 1/√2。</li>
 *   <li>{@link snapTarget}：「宽度」= 指针附近多大范围内找最强边缘作终点；{@link coolStable} / {@link cooledIndex}：
 *       路径冷却（前缀连续多次不变的部分固化成新种子）；{@link smoothGridPath}：像素阶梯 → 轻平滑 + 精简。</li>
 * </ul>
 */
import { simplifyPath, type Pt } from './selection-geometry.ts'

/** 边缘特征图（网格坐标，行优先） */
export interface EdgeCostMap {
  width: number
  height: number
  /** 归一化梯度幅值 0–1 */
  grad: Float32Array
  /** 边缘方向单位向量 D(p) = 梯度顺时针转 90°；平坦处为 0 */
  dx: Float32Array
  dy: Float32Array
  /** Laplacian 过零 = 1 */
  zc: Uint8Array
}

/** 经典权重（Mortensen & Barrett）：过零 / 方向 / 梯度 */
export const MB_WEIGHTS = { z: 0.43, d: 0.43, g: 0.14 } as const
/** 过零点要求的最小梯度（平坦区的噪声过零不算边） */
const ZC_MIN_GRAD = 0.08

/** OKLab（rgbaToLab 输出，透明像素为 NaN）→ 边缘特征图 */
export function edgeCostMap(lab: Float32Array, w: number, h: number): EdgeCostMap {
  const n = w * h
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3]!
    if (L !== L) continue // NaN：透明，当黑
    ch[0][i] = L
    ch[1][i] = lab[i * 3 + 1]!
    ch[2][i] = lab[i * 3 + 2]!
  }
  // 先 3×3 二项式轻平滑（压 JPEG 噪点 / 细纹理，Sobel 本身只在一个方向上平滑）
  const scratch = new Float32Array(n)
  for (const a of ch) blur121(a, scratch, w, h)
  const G = new Float32Array(n)
  const dx = new Float32Array(n)
  const dy = new Float32Array(n)
  const gxs = [0, 0, 0]
  const gys = [0, 0, 0]
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w
    const y0 = y * w
    const yp = (y < h - 1 ? y + 1 : y) * w
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0
      const xp = x < w - 1 ? x + 1 : x
      let jxx = 0
      let jyy = 0
      let jxy = 0
      for (let c = 0; c < 3; c++) {
        const a = ch[c]!
        const gx = a[ym + xp]! + 2 * a[y0 + xp]! + a[yp + xp]! - a[ym + xm]! - 2 * a[y0 + xm]! - a[yp + xm]!
        const gy = a[yp + xm]! + 2 * a[yp + x]! + a[yp + xp]! - a[ym + xm]! - 2 * a[ym + x]! - a[ym + xp]!
        gxs[c] = gx
        gys[c] = gy
        jxx += gx * gx
        jyy += gy * gy
        jxy += gx * gy
      }
      const i = y0 + x
      const tr = jxx + jyy
      const disc = Math.sqrt((jxx - jyy) * (jxx - jyy) + 4 * jxy * jxy)
      const lam = (tr + disc) / 2
      if (lam <= 1e-10) continue
      G[i] = Math.sqrt(lam)
      // 主特征向量 = 梯度方向（符号不定）：按投影最大的通道定正负
      const th = 0.5 * Math.atan2(2 * jxy, jxx - jyy)
      let ux = Math.cos(th)
      let uy = Math.sin(th)
      let best = 0
      for (let c = 0; c < 3; c++) {
        const pr = ux * gxs[c]! + uy * gys[c]!
        if (Math.abs(pr) > Math.abs(best)) best = pr
      }
      if (best < 0) {
        ux = -ux
        uy = -uy
      }
      // D = 梯度顺时针转 90°（沿边方向）
      dx[i] = uy
      dy[i] = -ux
    }
  }
  // 归一：(G − 中位数) / (p99.5 − 中位数)，夹到 0–1。中位数 ≈ 噪声 / 纹理底，减掉它平坦区才真的「没有边」；
  // 上端用 p99.5 而不是最大值（最大值容易被个别噪点拉高）
  let max = 0
  for (let i = 0; i < n; i++) if (G[i]! > max) max = G[i]!
  const grad = new Float32Array(n)
  if (max > 0) {
    const BINS = 4096
    const hist = new Uint32Array(BINS)
    for (let i = 0; i < n; i++) hist[Math.min(BINS - 1, Math.floor((G[i]! / max) * BINS))]! += 1
    const at = (q: number) => {
      const want = n * q
      let acc = 0
      for (let b = 0; b < BINS; b++) {
        acc += hist[b]!
        if (acc >= want) return ((b + 1) / BINS) * max
      }
      return max
    }
    const lo = at(0.5)
    const span = Math.max(at(0.995) - lo, 1e-6)
    for (let i = 0; i < n; i++) grad[i] = Math.min(1, Math.max(0, (G[i]! - lo) / span))
  }
  // LoG：亮度 5×5 二项式（可分离）→ 4 邻域 Laplacian → 过零（取更接近 0 的一侧）
  const L = ch[0]
  const tmp = new Float32Array(n)
  const sm = new Float32Array(n)
  const K = [1, 4, 6, 4, 1]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = -2; k <= 2; k++) s += K[k + 2]! * L[y * w + Math.min(w - 1, Math.max(0, x + k))]!
      tmp[y * w + x] = s / 16
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = -2; k <= 2; k++) s += K[k + 2]! * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!
      sm[y * w + x] = s / 16
    }
  const lap = tmp
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const c = sm[i]!
      lap[i] =
        (x > 0 ? sm[i - 1]! : c) + (x < w - 1 ? sm[i + 1]! : c) + (y > 0 ? sm[i - w]! : c) + (y < h - 1 ? sm[i + w]! : c) - 4 * c
    }
  const zc = new Uint8Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = lap[i]!
      if (x < w - 1) {
        const b = lap[i + 1]!
        if (a * b < 0) zc[Math.abs(a) <= Math.abs(b) ? i : i + 1] = 1
      }
      if (y < h - 1) {
        const b = lap[i + w]!
        if (a * b < 0) zc[Math.abs(a) <= Math.abs(b) ? i : i + w] = 1
      }
    }
  for (let i = 0; i < n; i++) if (zc[i] && grad[i]! < ZC_MIN_GRAD) zc[i] = 0
  return { width: w, height: h, grad, dx, dy, zc }
}

/** 3×3 二项式（1-2-1 可分离）原地平滑，边缘复制 */
function blur121(a: Float32Array, tmp: Float32Array, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    const r = y * w
    for (let x = 0; x < w; x++)
      tmp[r + x] = (a[r + (x > 0 ? x - 1 : 0)]! + 2 * a[r + x]! + a[r + (x < w - 1 ? x + 1 : x)]!) / 4
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w
    const dn = (y < h - 1 ? y + 1 : y) * w
    const r = y * w
    for (let x = 0; x < w; x++) a[r + x] = (tmp[up + x]! + 2 * tmp[r + x]! + tmp[dn + x]!) / 4
  }
}

// ================= live-wire：增量 Dijkstra =================

/** 8 邻域：dx / dy / 是否对角 */
const NX = [1, 1, 0, -1, -1, -1, 0, 1]
const NY = [0, 1, 1, 1, 0, -1, -1, -1]
const NL = NX.map((x, k) => Math.hypot(x, NY[k]!))
/** acos 查表（[-1, 1] → [0, π]） */
const ACOS_N = 1024
const ACOS = new Float32Array(ACOS_N + 1)
for (let i = 0; i <= ACOS_N; i++) ACOS[i] = Math.acos((i / ACOS_N) * 2 - 1)
const acosLut = (v: number) => ACOS[Math.round((Math.min(1, Math.max(-1, v)) + 1) * 0.5 * ACOS_N)]!
const COST_SCALE = 255
const NB = COST_SCALE + 2
const INF = 0x7fffffff

export interface GridBox {
  x0: number
  y0: number
  /** 含 */
  x1: number
  y1: number
}

/**
 * 从一个种子出发的 live-wire（窗口内增量 Dijkstra）。坐标都是网格整数。
 * threshold：「对比度」0–1，梯度低于它的像素当没有边（梯度 / 过零项都按最差算）。
 */
export class LiveWire {
  readonly map: EdgeCostMap
  readonly threshold: number
  /** 展开过的像素数（性能统计） */
  expanded = 0
  private box: GridBox = { x0: 0, y0: 0, x1: -1, y1: -1 }
  private bw = 0
  private dist = new Int32Array(0)
  private parent = new Int8Array(0)
  private done = new Uint8Array(0)
  /** 禁行像素（闭合段不走回头路用）；空 = 没有 */
  private blocked: Uint8Array | null = null
  private buckets: number[][] = Array.from({ length: NB }, () => [])
  private queued = 0
  private cur = 0
  seedX = 0
  seedY = 0

  constructor(map: EdgeCostMap, threshold: number) {
    this.map = map
    this.threshold = threshold
  }

  /** 新种子；box = 搜索窗口（会夹到图内） */
  start(sx: number, sy: number, box: GridBox) {
    const { width: W, height: H } = this.map
    const b = {
      x0: Math.max(0, Math.floor(box.x0)),
      y0: Math.max(0, Math.floor(box.y0)),
      x1: Math.min(W - 1, Math.ceil(box.x1)),
      y1: Math.min(H - 1, Math.ceil(box.y1)),
    }
    this.box = b
    this.bw = b.x1 - b.x0 + 1
    const size = this.bw * (b.y1 - b.y0 + 1)
    if (this.dist.length < size) {
      this.dist = new Int32Array(size)
      this.parent = new Int8Array(size)
      this.done = new Uint8Array(size)
    }
    this.blocked = null
    this.dist.fill(INF, 0, size)
    this.parent.fill(-1, 0, size)
    this.done.fill(0, 0, size)
    for (const q of this.buckets) q.length = 0
    this.queued = 0
    this.cur = 0
    this.expanded = 0
    this.seedX = Math.min(b.x1, Math.max(b.x0, Math.round(sx)))
    this.seedY = Math.min(b.y1, Math.max(b.y0, Math.round(sy)))
    const li = (this.seedY - b.y0) * this.bw + (this.seedX - b.x0)
    this.dist[li] = 0
    this.buckets[0]!.push(li)
    this.queued = 1
  }

  /**
   * 把已经走过的路径（网格坐标）外扩 r 像素设成禁行，keep 周围 keepR 像素例外（起点 / 终点要能到）。
   * 闭合段用：不让它贴着已画好的那一段折回去，围出一条月牙。须在 start 之后、pathTo 之前调用。
   */
  blockPath(pts: readonly Pt[], r: number, keep: readonly Pt[], keepR: number) {
    const b = this.box
    const bw = this.bw
    const bh = b.y1 - b.y0 + 1
    const m = new Uint8Array(bw * bh)
    const R = Math.max(0, Math.round(r))
    for (const p of pts) {
      const px = Math.round(p.x) - b.x0
      const py = Math.round(p.y) - b.y0
      for (let y = Math.max(0, py - R); y <= Math.min(bh - 1, py + R); y++)
        for (let x = Math.max(0, px - R); x <= Math.min(bw - 1, px + R); x++) m[y * bw + x] = 1
    }
    const K = Math.ceil(keepR)
    for (const p of keep) {
      const px = Math.round(p.x) - b.x0
      const py = Math.round(p.y) - b.y0
      for (let y = Math.max(0, py - K); y <= Math.min(bh - 1, py + K); y++)
        for (let x = Math.max(0, px - K); x <= Math.min(bw - 1, px + K); x++)
          if ((x - px) * (x - px) + (y - py) * (y - py) <= keepR * keepR) m[y * bw + x] = 0
    }
    this.blocked = m
  }

  /** 窗口内？ */
  inBox(x: number, y: number): boolean {
    const b = this.box
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  }

  /** 最小代价路径：种子 → 目标（网格坐标数组，含两端）；目标在窗口外时夹到窗口边 */
  pathTo(tx: number, ty: number): Pt[] {
    const b = this.box
    const x = Math.min(b.x1, Math.max(b.x0, Math.round(tx)))
    const y = Math.min(b.y1, Math.max(b.y0, Math.round(ty)))
    const li = (y - b.y0) * this.bw + (x - b.x0)
    if (!this.done[li]) this.expandUntil(li)
    const out: Pt[] = []
    let cx = x
    let cy = y
    let c = li
    // 回溯（parent = 从哪个方向来的）
    for (let guard = 0; guard < 1e7; guard++) {
      out.push({ x: cx, y: cy })
      const k = this.parent[c]!
      if (k < 0) break
      cx -= NX[k]!
      cy -= NY[k]!
      c = (cy - b.y0) * this.bw + (cx - b.x0)
    }
    out.reverse()
    return out
  }

  private expandUntil(target: number) {
    const { width: W, grad, dx, dy, zc } = this.map
    const b = this.box
    const bw = this.bw
    const bh = b.y1 - b.y0 + 1
    const thr = this.threshold
    const dist = this.dist
    const parent = this.parent
    const done = this.done
    const blocked = this.blocked
    const buckets = this.buckets
    const wz = MB_WEIGHTS.z
    const wd = MB_WEIGHTS.d * (2 / (3 * Math.PI))
    const wg = MB_WEIGHTS.g
    let empty = 0
    while (this.queued > 0) {
      const q = buckets[this.cur % NB]!
      if (!q.length) {
        this.cur++
        if (++empty > NB) break
        continue
      }
      empty = 0
      const li = q.pop()!
      this.queued--
      if (done[li] || dist[li] !== this.cur) continue
      done[li] = 1
      this.expanded++
      const lx = li % bw
      const ly = (li - lx) / bw
      const gi = (ly + b.y0) * W + (lx + b.x0)
      const dpx = dx[gi]!
      const dpy = dy[gi]!
      for (let k = 0; k < 8; k++) {
        const nx = lx + NX[k]!
        const ny = ly + NY[k]!
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
        const ni = ny * bw + nx
        if (done[ni] || (blocked && blocked[ni])) continue
        const gq = (ny + b.y0) * W + (nx + b.x0)
        const g = grad[gq]!
        const strong = g >= thr
        const fG = strong ? 1 - g : 1
        const fZ = strong && zc[gq] ? 0 : 1
        // 方向项：L 取与 D(p) 同向的那一个链接方向
        const inv = 1 / NL[k]!
        let lxv = NX[k]! * inv
        let lyv = NY[k]! * inv
        let dp = dpx * lxv + dpy * lyv
        if (dp < 0) {
          lxv = -lxv
          lyv = -lyv
          dp = -dp
        }
        const dq = lxv * dx[gq]! + lyv * dy[gq]!
        const c = wz * fZ + wd * (acosLut(dp) + acosLut(dq)) + wg * fG * (k & 1 ? 1 : Math.SQRT1_2)
        const nd = this.cur + Math.round(c * COST_SCALE)
        if (nd < dist[ni]!) {
          dist[ni] = nd
          parent[ni] = k
          buckets[nd % NB]!.push(ni)
          this.queued++
        }
      }
      if (li === target) return
    }
  }
}

/** 「宽度」：指针 (x, y) 半径 r 内找最强边缘（梯度 ≥ 阈值，同强度取近的）；没有就原地 */
export function snapTarget(map: EdgeCostMap, x: number, y: number, r: number, threshold: number): Pt {
  const { width: W, height: H, grad } = map
  const cx = Math.min(W - 1, Math.max(0, Math.round(x)))
  const cy = Math.min(H - 1, Math.max(0, Math.round(y)))
  const R = Math.max(0, Math.round(r))
  let best = -Infinity
  let bx = cx
  let by = cy
  for (let yy = Math.max(0, cy - R); yy <= Math.min(H - 1, cy + R); yy++)
    for (let xx = Math.max(0, cx - R); xx <= Math.min(W - 1, cx + R); xx++) {
      const d2 = (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy)
      if (d2 > R * R) continue
      const g = grad[yy * W + xx]!
      if (g < threshold) continue
      const s = g - (0.25 * Math.sqrt(d2)) / Math.max(1, R)
      if (s > best) {
        best = s
        bx = xx
        by = yy
      }
    }
  return { x: bx, y: by }
}

/**
 * 路径冷却：新路径与上一帧路径的公共前缀（从种子起逐点相同）上的点「稳定次数」+1，其余清零。
 * 返回与 path 等长的稳定计数（沿路径单调不增）。
 */
export function coolStable(prev: readonly Pt[], prevStable: Uint16Array | null, path: readonly Pt[]): Uint16Array {
  const out = new Uint16Array(path.length)
  const m = Math.min(prev.length, path.length)
  for (let i = 0; i < m; i++) {
    if (prev[i]!.x !== path[i]!.x || prev[i]!.y !== path[i]!.y) break
    out[i] = Math.min(65535, (prevStable?.[i] ?? 0) + 1)
  }
  return out
}

/** 冷却到可以固化的最远下标（稳定次数 ≥ k）；-1 = 没有 */
export function cooledIndex(stable: Uint16Array, k: number): number {
  let j = -1
  for (let i = 0; i < stable.length; i++) {
    if (stable[i]! < k) break
    j = i
  }
  return j
}

/** 网格像素阶梯路径 → 轻平滑（三点均值，保留两端）+ RDP 精简（网格单位） */
export function smoothGridPath(path: readonly Pt[], eps = 0.6): Pt[] {
  if (path.length < 3) return path.map((p) => ({ x: p.x, y: p.y }))
  const s: Pt[] = [{ x: path[0]!.x, y: path[0]!.y }]
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const c = path[i + 1]!
    s.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 })
  }
  s.push({ x: path[path.length - 1]!.x, y: path[path.length - 1]!.y })
  return simplifyPath(s, eps)
}

/**
 * 闭合段：最后一个锚点 → 起点再吸附一段（含「不走回头路」禁行与堵死时的退回）。
 * 纯函数：Worker（edge-cost.worker.ts）与主线程兜底共用这一份，结果逐点一致。
 * drawn = 已画好的全部点（网格坐标）；窗口 = 它们的外接框外扩 margin，闭合段可能要绕到另一侧。
 */
export function closingPath(
  map: EdgeCostMap,
  threshold: number,
  last: Pt,
  first: Pt,
  drawn: readonly Pt[],
  margin: number,
): Pt[] {
  const w = new LiveWire(map, threshold)
  const box = boxAround(last, first, margin)
  for (const q of drawn) {
    box.x0 = Math.min(box.x0, q.x - margin)
    box.y0 = Math.min(box.y0, q.y - margin)
    box.x1 = Math.max(box.x1, q.x + margin)
    box.y1 = Math.max(box.y1, q.y + margin)
  }
  w.start(last.x, last.y, box)
  // 已画的段设成禁行（两端各留一点口子）：闭合段走「另一半」，不贴着来路折回去
  w.blockPath(drawn, 2, [first, last], 6)
  let closing = w.pathTo(first.x, first.y)
  // 被堵死（窗口里绕不过去）：退回不禁行再算一次
  const end = closing[closing.length - 1]
  if (
    !end ||
    Math.round(end.x) !== Math.round(first.x) ||
    Math.round(end.y) !== Math.round(first.y) ||
    closing.length < 2
  ) {
    w.start(last.x, last.y, box)
    closing = w.pathTo(first.x, first.y)
  }
  return closing
}

/** 搜索窗口：两点外接框外扩 margin */
export function boxAround(a: Pt, b: Pt, margin: number): GridBox {
  return {
    x0: Math.min(a.x, b.x) - margin,
    y0: Math.min(a.y, b.y) - margin,
    x1: Math.max(a.x, b.x) + margin,
    y1: Math.max(a.y, b.y) + margin,
  }
}
