/**
 * 智能选区的像素级纯函数（不碰 DOM，Node 里可直接单测）：
 *
 * <ul>
 *   <li>颜色范围 / 魔棒（{@link colorRangeMask}）：点一个颜色，按 OKLab 感知距离选相近的颜色，「仅连续区域」从点击处
 *       队列泛洪（4 邻域），否则全图；距离在容差 60%–100% 之间线性过渡成软边；</li>
 *   <li>画笔（{@link stampStroke}）：沿轨迹按间距盖圆印，硬度 = 实心部分占半径的比例，添加取 max、擦除取 min；</li>
 *   <li>扩展 / 收缩（{@link dilateMask} / {@link erodeMask}）：灰度形态学最大 / 最小滤波，横竖两遍可分离、单调队列 O(n)；</li>
 *   <li>平滑（{@link smoothMask}）：三遍盒式模糊（≈高斯）后围绕 50% 提一点对比，锯齿磨掉、选区边界位置基本不变。</li>
 * </ul>
 * 蒙版一律是 0–255 的 Uint8Array（行优先，width × height）。
 */
import { okDistance, srgb8ToOklab, type Lab } from '../../utils/colorfix-math.ts'

/** RGBA → 逐像素 OKLab（Float32Array，3 个一组）；透明像素（alpha < 8）L 记为 NaN，魔棒不会选到 */
export function rgbaToLab(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height
  const out = new Float32Array(n * 3)
  const lab: Lab = [0, 0, 0]
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (data[i + 3]! < 8) {
      out[p * 3] = NaN
      continue
    }
    srgb8ToOklab(data[i]!, data[i + 1]!, data[i + 2]!, lab)
    out[p * 3] = lab[0]
    out[p * 3 + 1] = lab[1]
    out[p * 3 + 2] = lab[2]
  }
  return out
}

/** 种子色：点击处 3×3 的平均（避开单个噪点） */
export function seedColor(lab: Float32Array, width: number, height: number, x: number, y: number): Lab | null {
  const cx = Math.min(width - 1, Math.max(0, Math.round(x)))
  const cy = Math.min(height - 1, Math.max(0, Math.round(y)))
  let L = 0
  let a = 0
  let b = 0
  let n = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx
      const yy = cy + dy
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
      const p = (yy * width + xx) * 3
      if (Number.isNaN(lab[p]!)) continue
      L += lab[p]!
      a += lab[p + 1]!
      b += lab[p + 2]!
      n++
    }
  }
  return n ? [L / n, a / n, b / n] : null
}

export interface ColorRangeOptions {
  /** 容差（{@link okDistance} 单位，1 ≈ 刚能分辨；常用 8–30） */
  tolerance: number
  /** 仅连续区域：从种子点泛洪；false = 全图所有相近颜色 */
  contiguous: boolean
}

/** 距离 → 软边 alpha：≤ 60% 容差全选，60%–100% 线性过渡，超过不选 */
function softAlpha(d: number, tol: number): number {
  const inner = tol * 0.6
  if (d <= inner) return 255
  if (d >= tol) return 0
  return Math.round(((tol - d) / (tol - inner)) * 255)
}

/**
 * 颜色范围 / 魔棒：返回与 lab 同网格的软蒙版。种子点落在透明处 / 网格外返回全 0。
 * 泛洪按「距离 < 容差」扩散（软边像素也会继续往外走，过渡带不会被截断）。
 */
export function colorRangeMask(
  lab: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  opts: ColorRangeOptions,
): Uint8Array {
  const n = width * height
  const out = new Uint8Array(n)
  const seed = seedColor(lab, width, height, x, y)
  if (!seed) return out
  const tol = Math.max(0.5, opts.tolerance)
  const [sL, sa, sb] = seed
  const dist = (p: number) => {
    const L = lab[p * 3]!
    if (Number.isNaN(L)) return Infinity
    return okDistance(L, lab[p * 3 + 1]!, lab[p * 3 + 2]!, sL, sa, sb)
  }
  if (!opts.contiguous) {
    for (let p = 0; p < n; p++) out[p] = softAlpha(dist(p), tol)
    return out
  }
  const cx = Math.min(width - 1, Math.max(0, Math.round(x)))
  const cy = Math.min(height - 1, Math.max(0, Math.round(y)))
  const visited = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  const start = cy * width + cx
  visited[start] = 1
  queue[tail++] = start
  while (head < tail) {
    const p = queue[head++]!
    const d = dist(p)
    // 种子点自己总算选中（哪怕 3×3 平均后离它有点远）
    if (d >= tol && p !== start) continue
    out[p] = p === start ? 255 : softAlpha(d, tol)
    const px = p % width
    const py = (p - px) / width
    if (px > 0 && !visited[p - 1]) {
      visited[p - 1] = 1
      queue[tail++] = p - 1
    }
    if (px < width - 1 && !visited[p + 1]) {
      visited[p + 1] = 1
      queue[tail++] = p + 1
    }
    if (py > 0 && !visited[p - width]) {
      visited[p - width] = 1
      queue[tail++] = p - width
    }
    if (py < height - 1 && !visited[p + width]) {
      visited[p + width] = 1
      queue[tail++] = p + width
    }
  }
  return out
}

// ---------------- 画笔 ----------------

export interface BrushStroke {
  id: number
  mode: 'add' | 'sub'
  /** 半径（原图像素） */
  radius: number
  /** 硬度 0–1：实心部分占半径的比例 */
  hardness: number
  /** 轨迹（原图像素坐标） */
  pts: { x: number; y: number }[]
}

/** 在 (cx, cy) 盖一个圆印（网格坐标），add = max、sub = min(255 − v) */
function stamp(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, hard: number, add: boolean) {
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  const core = r * hard
  const ramp = Math.max(1e-3, r - core)
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy
    const row = y * w
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d >= r) continue
      const v = d <= core ? 255 : Math.round(((r - d) / ramp) * 255)
      const i = row + x
      if (add) {
        if (v > mask[i]!) mask[i] = v
      } else if (255 - v < mask[i]!) mask[i] = 255 - v
    }
  }
}

/**
 * 一笔画进蒙版（就地）：轨迹按 sx / sy 换算到网格，相邻两点间按 1/4 半径的间距补印（最小 1 像素），
 * 半径小于 0.75 网格像素时按 0.75 画（缩得很小也不会断成虚线）。
 */
export function stampStroke(mask: Uint8Array, width: number, height: number, stroke: BrushStroke, sx: number, sy = sx) {
  const pts = stroke.pts
  if (!pts.length) return
  const r = Math.max(0.75, stroke.radius * Math.max(sx, sy))
  const hard = Math.min(1, Math.max(0, stroke.hardness))
  const add = stroke.mode === 'add'
  const spacing = Math.max(1, r * 0.25)
  let px = pts[0]!.x * sx
  let py = pts[0]!.y * sy
  stamp(mask, width, height, px, py, r, hard, add)
  for (let k = 1; k < pts.length; k++) {
    const nx = pts[k]!.x * sx
    const ny = pts[k]!.y * sy
    const len = Math.hypot(nx - px, ny - py)
    const steps = Math.max(1, Math.ceil(len / spacing))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      stamp(mask, width, height, px + (nx - px) * t, py + (ny - py) * t, r, hard, add)
    }
    px = nx
    py = ny
  }
}

// ---------------- 扩展 / 收缩 / 平滑 ----------------

/** 一条线（起点 offset、步长 stride、长度 len）上的滑动窗口最大 / 最小值（窗口 [i−r, i+r]，单调队列） */
function slideLine(
  src: Uint8Array,
  dst: Uint8Array,
  offset: number,
  stride: number,
  len: number,
  r: number,
  max: boolean,
  dq: Int32Array,
) {
  let head = 0
  let tail = 0
  const at = (k: number) => src[offset + k * stride]!
  const better = (u: number, v: number) => (max ? u >= v : u <= v)
  let next = 0
  for (let i = 0; i < len; i++) {
    const hi = Math.min(len - 1, i + r)
    while (next <= hi) {
      const v = at(next)
      while (tail > head && better(v, at(dq[tail - 1]!))) tail--
      dq[tail++] = next
      next++
    }
    while (dq[head]! < i - r) head++
    dst[offset + i * stride] = at(dq[head]!)
  }
}

function morph(mask: Uint8Array, width: number, height: number, radius: number, max: boolean): Uint8Array {
  const r = Math.round(radius)
  if (r <= 0) return mask.slice()
  const tmp = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  const dq = new Int32Array(Math.max(width, height))
  for (let y = 0; y < height; y++) slideLine(mask, tmp, y * width, 1, width, r, max, dq)
  for (let x = 0; x < width; x++) slideLine(tmp, out, x, width, height, r, max, dq)
  return out
}

/** 扩展 radius 像素（灰度膨胀：方形结构元，横竖两遍） */
export function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(mask, width, height, radius, true)
}

/** 收缩 radius 像素（灰度腐蚀） */
export function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(mask, width, height, radius, false)
}

/** 三遍可分离盒式模糊（边缘复制） */
export function boxBlurMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(1, Math.round(radius))
  const a = new Float32Array(mask.length)
  for (let i = 0; i < a.length; i++) a[i] = mask[i]!
  const tmp = new Float32Array(mask.length)
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? width : height
    const lines = horizontal ? height : width
    for (let l = 0; l < lines; l++) {
      const at = (k: number) => (horizontal ? l * width + k : k * width + l)
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[at(Math.min(len - 1, Math.max(0, k)))]!
      for (let k = 0; k < len; k++) {
        dst[at(k)] = sum / (2 * r + 1)
        sum += src[at(Math.min(len - 1, k + r + 1))]! - src[at(Math.max(0, k - r))]!
      }
    }
  }
  for (let n = 0; n < 3; n++) {
    pass(a, tmp, true)
    pass(tmp, a, false)
  }
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(a[i]!)
  return out
}

/** 平滑：模糊后围绕 50% 提对比（×2），边界位置不动、锯齿与毛刺被磨掉，边缘保留约 radius 的软过渡 */
export function smoothMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice()
  const blurred = boxBlurMask(mask, width, height, radius)
  for (let i = 0; i < blurred.length; i++) {
    const v = (blurred[i]! - 127.5) * 2 + 127.5
    blurred[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
  }
  return blurred
}

export interface SelectionPostOps {
  /** 扩展（正）/ 收缩（负），像素（按工作网格长边 1024 计，导出时等比换算） */
  grow: number
  /** 平滑半径 0–10（同上） */
  smooth: number
}

export const POST_OPS_NONE: SelectionPostOps = { grow: 0, smooth: 0 }

/** 合成后的选区依次做 扩展 / 收缩 → 平滑；scale = 网格长边 / 1024（导出网格更大时半径等比放大） */
export function applyPostOps(
  mask: Uint8Array,
  width: number,
  height: number,
  ops: SelectionPostOps,
  scale = 1,
): Uint8Array {
  let out = mask
  const g = Math.round(ops.grow * scale)
  if (g > 0) out = dilateMask(out, width, height, g)
  else if (g < 0) out = erodeMask(out, width, height, -g)
  const s = ops.smooth * scale
  if (s > 0) out = smoothMask(out, width, height, s)
  return out
}

// ---------------- 画笔效果压成两张图（会话持久化，2026-11-11） ----------------

/**
 * 一串笔画对合成选区的作用恒等于一次夹取：f(c) = min(hi, max(lo, c))——添加 = max(·, v)、擦除 = min(·, 255 − v)，
 * 两种夹取复合后仍是夹取（lo ≤ hi 一直成立）。所以任意多笔可以无损压成 lo / hi 两张图（同网格），会话里笔画太多时存它。
 */
export function strokeClampMaps(
  strokes: readonly BrushStroke[],
  width: number,
  height: number,
  sx: number,
  sy = sx,
): { lo: Uint8Array; hi: Uint8Array } {
  const size = width * height
  const lo = new Uint8Array(size)
  const hi = new Uint8Array(size).fill(255)
  const add = new Uint8Array(size)
  for (const st of strokes) {
    // 单笔内部按「笔迹蒙版」盖：先画到临时层再整体并进 lo / hi（同一笔重叠处取 max，与逐印 max / min 一致）
    add.fill(st.mode === 'add' ? 0 : 255)
    stampStroke(add, width, height, st, sx, sy)
    if (st.mode === 'add') {
      for (let i = 0; i < size; i++) {
        const v = add[i]!
        if (!v) continue
        if (v > lo[i]!) lo[i] = v
        if (v > hi[i]!) hi[i] = v
      }
    } else {
      for (let i = 0; i < size; i++) {
        const v = add[i]!
        if (v === 255) continue
        if (v < lo[i]!) lo[i] = v
        if (v < hi[i]!) hi[i] = v
      }
    }
  }
  return { lo, hi }
}

/** 就地套用 {@link strokeClampMaps} 的结果：mask = min(hi, max(lo, mask)) */
export function applyClampMaps(mask: Uint8Array, lo: Uint8Array, hi: Uint8Array) {
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]! < lo[i]! ? lo[i]! : mask[i]!
    mask[i] = v > hi[i]! ? hi[i]! : v
  }
}

// ---------------- 选区查看方式（2026-11-11） ----------------

/** 叠加（半透明藤紫）/ 黑白蒙版 / 仅选区（选区外棋盘格）/ 轮廓（行军蚁，由调用方画矢量线） */
export type MaskViewMode = 'overlay' | 'mask' | 'only' | 'outline'

export const MASK_VIEW_LABELS: Record<MaskViewMode, string> = {
  overlay: '叠加',
  mask: '黑白蒙版',
  only: '仅选区',
  outline: '轮廓',
}

export const MASK_VIEW_HINTS: Record<MaskViewMode, string> = {
  overlay: '选区盖一层半透明藤紫',
  mask: '白 = 选中、黑 = 未选，灰 = 半选（软边）',
  only: '只看选区里的内容，选区外显示棋盘格',
  outline: '只画选区边界（虚线）',
}

/**
 * 按查看方式把蒙版画成 RGBA（与蒙版同网格），叠在原图上：
 * <ul>
 *   <li>overlay：藤紫 × 蒙版 × alpha（默认 0.55，与以前一致）；</li>
 *   <li>mask：不透明灰度（白 = 选中）；</li>
 *   <li>only：选区外盖棋盘格（不透明度 = 1 − 蒙版），选区里透出原图；</li>
 *   <li>outline：全透明（轮廓由调用方用 {@link maskContours} 画矢量虚线）。</li>
 * </ul>
 * checker = 棋盘格边长（网格像素）。
 */
export function renderMaskView(
  mask: Uint8Array,
  width: number,
  height: number,
  view: MaskViewMode,
  opts: { rgb?: [number, number, number]; alpha?: number; checker?: number; out?: Uint8ClampedArray } = {},
): Uint8ClampedArray {
  const out = opts.out ?? new Uint8ClampedArray(width * height * 4)
  if (view === 'outline') {
    out.fill(0)
    return out
  }
  if (view === 'mask') {
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i]!
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v
      out[i * 4 + 3] = 255
    }
    return out
  }
  if (view === 'only') {
    const cs = Math.max(1, Math.round(opts.checker ?? 8))
    for (let y = 0; y < height; y++) {
      const ry = Math.floor(y / cs)
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const c = (ry + Math.floor(x / cs)) % 2 ? 214 : 245
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = c
        out[i * 4 + 3] = 255 - mask[i]!
      }
    }
    return out
  }
  const [r, g, b] = opts.rgb ?? [135, 95, 154]
  const k = opts.alpha ?? 0.55
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]!
    if (a < 8) {
      out[i * 4 + 3] = 0
      continue
    }
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = Math.round(a * k)
  }
  return out
}
