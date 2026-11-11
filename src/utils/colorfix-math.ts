/**
 * 校色的纯计算（不碰 DOM / Vue，Node 里可直接单测；utils/colorfix.ts 原样 re-export 前半部分）：
 *
 * <ul>
 *   <li>五参数类型 / 区间 / 合法化 / 逐像素实现（与 CSS filter 同序同公式）；</li>
 *   <li>OKLab / OKLCH 换算、色差（{@link okDistance}）、十六进制色；</li>
 *   <li>替换为目标颜色（{@link recolorPixels}）：OKLCH 里把色相 / 彩度往目标挪，亮度按「相对映射」保留明暗纹理；</li>
 *   <li>选区内主色（{@link dominantLab}）、图层合成（{@link compositeLayerPixels}）。</li>
 * </ul>
 */

export interface ColorFixParams {
  hue: number
  sat: number
  light: number
  bright: number
  contrast: number
}

/** 「默认校色」参数（校色包图四的真实值） */
export const COLORFIX_DEFAULT: ColorFixParams = { hue: 3, sat: -16, light: -6, bright: -17, contrast: 10 }

/** 全零 = 不校色（新建的选区图层从这里起调） */
export const COLORFIX_ZERO: ColorFixParams = { hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 }

export const COLORFIX_RANGES: Record<keyof ColorFixParams, { min: number; max: number }> = {
  hue: { min: -30, max: 30 },
  sat: { min: -60, max: 70 },
  light: { min: -40, max: 40 },
  bright: { min: -80, max: 80 },
  contrast: { min: -50, max: 50 },
}

/** 两组参数是否完全相同（「恢复默认」禁用、是否调过参数都看它） */
export function colorFixEquals(a: ColorFixParams, b: ColorFixParams): boolean {
  return a.hue === b.hue && a.sat === b.sat && a.light === b.light && a.bright === b.bright && a.contrast === b.contrast
}

/** 任意来源（接口 / localStorage）的参数 → 合法五参数（缺字段 / 非数字返回 null，越界夹回范围） */
export function colorFixSanitize(raw: unknown): ColorFixParams | null {
  let v = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const out = {} as ColorFixParams
  for (const k of Object.keys(COLORFIX_RANGES) as (keyof ColorFixParams)[]) {
    const n = o[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    const { min, max } = COLORFIX_RANGES[k]
    out[k] = Math.min(max, Math.max(min, Math.round(n)))
  }
  return out
}

/** 参数是否为全零（零 = 不校色，UI 上「恢复默认」禁用 / 预览不挂滤镜都看它） */
export function colorFixIsZero(p: ColorFixParams): boolean {
  return p.hue === 0 && p.sat === 0 && p.light === 0 && p.bright === 0 && p.contrast === 0
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * 与 CSS filter 串（utils/colorfix colorFixFilter）同序同公式的逐像素实现（sRGB 空间，Filter Effects 规范的
 * hue-rotate / saturate 矩阵 + brightness / contrast 线性映射，每一步夹回 0–255）。只改 RGB，alpha 原样保留。
 * mask（可选，与像素同序的 0–255）：为 0 的像素跳过（图层只在选区里算，省时间）。
 */
export function applyColorFixPixels(data: Uint8ClampedArray, p: ColorFixParams, mask?: Uint8Array | null) {
  const rad = (p.hue * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const h0 = 0.213 + c * 0.787 - s * 0.213
  const h1 = 0.715 - c * 0.715 - s * 0.715
  const h2 = 0.072 - c * 0.072 + s * 0.928
  const h3 = 0.213 - c * 0.213 + s * 0.143
  const h4 = 0.715 + c * 0.285 + s * 0.14
  const h5 = 0.072 - c * 0.072 - s * 0.283
  const h6 = 0.213 - c * 0.213 - s * 0.787
  const h7 = 0.715 - c * 0.715 + s * 0.715
  const h8 = 0.072 + c * 0.928 + s * 0.072
  const k = Math.max(0, 100 + p.sat) / 100
  const t0 = 0.213 + 0.787 * k
  const t1 = 0.715 - 0.715 * k
  const t2 = 0.072 - 0.072 * k
  const t3 = 0.213 - 0.213 * k
  const t4 = 0.715 + 0.285 * k
  const t5 = 0.072 - 0.072 * k
  const t6 = 0.213 - 0.213 * k
  const t7 = 0.715 - 0.715 * k
  const t8 = 0.072 + 0.928 * k
  // brightness → contrast 两步都是逐通道映射，合成一张 256 项查找表
  const bright = Math.max(0.05, (1 + p.light / 200) * (1 + p.bright / 100))
  const contrast = Math.max(0, 100 + p.contrast) / 100
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = clamp255((clamp255(v * bright) - 127.5) * contrast + 127.5)
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    if (mask && mask[px] === 0) continue
    const r0 = data[i]!
    const g0 = data[i + 1]!
    const b0 = data[i + 2]!
    const r1 = clamp255(h0 * r0 + h1 * g0 + h2 * b0)
    const g1 = clamp255(h3 * r0 + h4 * g0 + h5 * b0)
    const b1 = clamp255(h6 * r0 + h7 * g0 + h8 * b0)
    data[i] = lut[Math.round(clamp255(t0 * r1 + t1 * g1 + t2 * b1))]!
    data[i + 1] = lut[Math.round(clamp255(t3 * r1 + t4 * g1 + t5 * b1))]!
    data[i + 2] = lut[Math.round(clamp255(t6 * r1 + t7 * g1 + t8 * b1))]!
  }
}

// ---------------- OKLab ----------------

/** sRGB 8 位 → 线性（查表） */
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return t
})()

const LIN_LUT_SIZE = 4096
/** 线性 0–1 → sRGB 8 位（4096 级查表，误差 < 0.5 级） */
const LINEAR_TO_SRGB = (() => {
  const t = new Uint8ClampedArray(LIN_LUT_SIZE + 1)
  for (let i = 0; i <= LIN_LUT_SIZE; i++) {
    const x = i / LIN_LUT_SIZE
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    t[i] = Math.round(v * 255)
  }
  return t
})()

export function linearToSrgb8(x: number): number {
  if (!(x > 0)) return 0
  if (x >= 1) return 255
  return LINEAR_TO_SRGB[Math.round(x * LIN_LUT_SIZE)]!
}

export type Lab = [number, number, number]

/** 线性 RGB → OKLab（Björn Ottosson 2020） */
export function linearToOklab(r: number, g: number, b: number, out: Lab = [0, 0, 0]): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return out
}

/** OKLab → 线性 RGB（不夹，可能越界） */
export function oklabToLinear(L: number, a: number, b: number, out: Lab = [0, 0, 0]): Lab {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return out
}

export function srgb8ToOklab(r: number, g: number, b: number, out: Lab = [0, 0, 0]): Lab {
  return linearToOklab(SRGB_TO_LINEAR[r & 255]!, SRGB_TO_LINEAR[g & 255]!, SRGB_TO_LINEAR[b & 255]!, out)
}

/** OKLab → sRGB 8 位（越界先按彩度收回色域，再夹） */
export function oklabToSrgb8(L: number, a: number, b: number): [number, number, number] {
  const lin = gamutMap(L, a, b)
  return [linearToSrgb8(lin[0]), linearToSrgb8(lin[1]), linearToSrgb8(lin[2])]
}

const inGamut = (c: Lab) => c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001 && c[2] >= -1e-4 && c[2] <= 1.0001
const tmpLin: Lab = [0, 0, 0]
/** 亮度不动、彩度二分收回 sRGB 色域（6 轮，误差 < 2%），返回线性 RGB（共用缓冲，调用方立即取值） */
function gamutMap(L: number, a: number, b: number): Lab {
  const Lc = L < 0 ? 0 : L > 1 ? 1 : L
  oklabToLinear(Lc, a, b, tmpLin)
  if (inGamut(tmpLin)) return tmpLin
  let lo = 0
  let hi = 1
  for (let k = 0; k < 6; k++) {
    const mid = (lo + hi) / 2
    oklabToLinear(Lc, a * mid, b * mid, tmpLin)
    if (inGamut(tmpLin)) lo = mid
    else hi = mid
  }
  return oklabToLinear(Lc, a * lo, b * lo, tmpLin)
}

/**
 * 两个 OKLab 色的感知距离（×100：2 ≈ 刚能分辨）。亮度差打 0.5 折、色度差（a/b）放大 1.5 倍——同一块布料的明暗起伏
 * 主要在亮度上，颜色范围 / 魔棒更该按「是不是同一种颜色」而不是「是不是一样亮」来选（砖红与它的阴影 ≈ 10，
 * 砖红与藏青 ≈ 31，与肤色 ≈ 24；默认容差 16）。
 */
export function okDistance(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  const dL = (L1 - L2) * 0.5
  const da = (a1 - a2) * 1.5
  const db = (b1 - b2) * 1.5
  return Math.sqrt(dL * dL + da * da + db * db) * 100
}

// ---------------- 十六进制色 ----------------

/** '#rgb' / '#rrggbb'（可不带 #，大小写不限）→ [r, g, b]；不合法返回 null */
export function parseHex(raw: unknown): [number, number, number] | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (c) => c + c)
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(clamp255(v)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 任意来源的十六进制色 → 小写 '#rrggbb'；不合法返回 null */
export function normalizeHex(raw: unknown): string | null {
  const rgb = parseHex(raw)
  return rgb ? toHex(rgb[0], rgb[1], rgb[2]) : null
}

// ---------------- 替换为目标颜色 ----------------

export interface RecolorSpec {
  /** 源色（OKLab）：选区里「现在的颜色」 */
  source: Lab
  /** 目标色（OKLab） */
  target: Lab
  /** 强度 0–1 */
  strength: number
}

/**
 * 亮度相对映射：源亮度 Ls → 目标亮度 Lt，比 Ls 暗的按比例压到 [0, Lt]、亮的按比例压到 [Lt, 1]——
 * 连续、单调、两端不动，布料的明暗起伏（褶皱、阴影、高光）原样留下，只是整体挪到目标亮度附近。
 */
export function mapLightness(L: number, Ls: number, Lt: number): number {
  if (L <= Ls) return Ls > 1e-4 ? (L * Lt) / Ls : Lt
  return Ls < 1 - 1e-4 ? Lt + ((L - Ls) * (1 - Lt)) / (1 - Ls) : Lt
}

/**
 * 单个 OKLab 像素按 {@link RecolorSpec} 换色（不含强度混合），写回 out。
 *
 * <p>两种走法按源色彩度混合：
 * <ul>
 *   <li>相对（源色有颜色时）：色相整体转 (ht − hs)、彩度按 Ct / Cs 缩放（≤3 倍）——阴影里彩度本来低，换色后仍低，
 *       印花上的白 / 黑（彩度≈0）基本不变；</li>
 *   <li>加性（源色是灰 / 白 / 黑时，色相不可靠）：在原 a/b 偏差上叠目标 a/b，叠的量随亮度靠近黑白两端递减，免得阴影溢色。</li>
 * </ul>
 */
export function recolorLab(L: number, a: number, b: number, spec: RecolorSpec, out: Lab): Lab {
  const [Ls, as, bs] = spec.source
  const [Lt, at, bt] = spec.target
  const Cs = Math.hypot(as, bs)
  const Ct = Math.hypot(at, bt)
  const L2 = mapLightness(L, Ls, Lt)
  const w = Math.min(1, Math.max(0, Cs / 0.04))
  let na = 0
  let nb = 0
  if (w > 0) {
    const dh = Math.atan2(bt, at) - Math.atan2(bs, as)
    const cos = Math.cos(dh)
    const sin = Math.sin(dh)
    const ratio = Cs > 1e-4 ? Math.min(3, Ct / Cs) : 0
    na += w * (a * cos - b * sin) * ratio
    nb += w * (a * sin + b * cos) * ratio
  }
  if (w < 1) {
    const fDark = Lt > 1e-4 ? Math.min(1, L2 / Lt) : 1
    const fLight = Lt < 1 - 1e-4 ? Math.min(1, (1 - L2) / (1 - Lt)) : 1
    const f = Math.max(0, Math.min(fDark, fLight))
    na += (1 - w) * (a - as + at * f)
    nb += (1 - w) * (b - bs + bt * f)
  }
  out[0] = L2
  out[1] = na
  out[2] = nb
  return out
}

/**
 * RGBA 像素就地换色（只改 RGB）：weight（可选，0–255，与像素同序）为 0 的跳过、其余按 strength 全量换
 * （选区的软边由图层合成时的蒙版 alpha 负责，这里不再乘一遍）。
 */
export function recolorPixels(data: Uint8ClampedArray, spec: RecolorSpec, weight?: Uint8Array | null) {
  const k = Math.min(1, Math.max(0, spec.strength))
  if (k <= 0) return
  const lab: Lab = [0, 0, 0]
  const next: Lab = [0, 0, 0]
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    if (weight && weight[px] === 0) continue
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    srgb8ToOklab(r, g, b, lab)
    recolorLab(lab[0], lab[1], lab[2], spec, next)
    const lin = gamutMap(next[0], next[1], next[2])
    const nr = linearToSrgb8(lin[0])
    const ng = linearToSrgb8(lin[1])
    const nb = linearToSrgb8(lin[2])
    data[i] = r + (nr - r) * k
    data[i + 1] = g + (ng - g) * k
    data[i + 2] = b + (nb - b) * k
  }
}

/**
 * 选区内主色（OKLab）：按 alpha 加权、24 个色相格 + 1 个灰格（彩度 < 0.03）投票，取票最多的格的加权平均。
 * 有色像素的票按彩度加权（同一件衣服里饱和的部分更能代表「它是什么颜色」），灰格固定按 0.03 计。
 * step = 采样步长（大图隔行隔列取样）。选区为空返回 null。
 */
export function dominantLab(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alpha: Uint8Array | null,
  step = 1,
): Lab | null {
  const BINS = 25
  const wsum = new Float64Array(BINS)
  const Ls = new Float64Array(BINS)
  const As = new Float64Array(BINS)
  const Bs = new Float64Array(BINS)
  const vote = new Float64Array(BINS)
  const lab: Lab = [0, 0, 0]
  const s = Math.max(1, Math.floor(step))
  for (let y = 0; y < height; y += s) {
    for (let x = 0; x < width; x += s) {
      const px = y * width + x
      const a = alpha ? alpha[px]! / 255 : 1
      if (a < 0.5) continue
      const i = px * 4
      if (data[i + 3]! < 128) continue
      srgb8ToOklab(data[i]!, data[i + 1]!, data[i + 2]!, lab)
      const C = Math.hypot(lab[1], lab[2])
      let bin = BINS - 1
      let v = 0.03
      if (C >= 0.03) {
        const h = Math.atan2(lab[2], lab[1])
        bin = Math.min(BINS - 2, Math.floor(((h + Math.PI) / (2 * Math.PI)) * (BINS - 1)))
        v = Math.min(C, 0.2)
      }
      vote[bin]! += v * a
      wsum[bin]! += a
      Ls[bin]! += lab[0] * a
      As[bin]! += lab[1] * a
      Bs[bin]! += lab[2] * a
    }
  }
  let best = -1
  for (let k = 0; k < BINS; k++) if (wsum[k]! > 0 && (best < 0 || vote[k]! > vote[best]!)) best = k
  if (best < 0) return null
  const n = wsum[best]!
  return [Ls[best]! / n, As[best]! / n, Bs[best]! / n]
}

// ---------------- 图层合成 ----------------

/**
 * 一层的合成：running ← running + (adjusted − running) × alpha（逐像素、只 RGB；alpha 缺省 = 整幅 1）。
 * running 的 alpha 通道不动（透明底抠图结果合成后仍透明）。
 */
export function compositeLayerPixels(running: Uint8ClampedArray, adjusted: Uint8ClampedArray, alpha?: Uint8Array | null) {
  if (!alpha) {
    for (let i = 0; i < running.length; i += 4) {
      running[i] = adjusted[i]!
      running[i + 1] = adjusted[i + 1]!
      running[i + 2] = adjusted[i + 2]!
    }
    return
  }
  for (let i = 0, px = 0; i < running.length; i += 4, px++) {
    const a = alpha[px]!
    if (a === 0) continue
    if (a === 255) {
      running[i] = adjusted[i]!
      running[i + 1] = adjusted[i + 1]!
      running[i + 2] = adjusted[i + 2]!
      continue
    }
    const k = a / 255
    running[i] = running[i]! + (adjusted[i]! - running[i]!) * k
    running[i + 1] = running[i + 1]! + (adjusted[i + 1]! - running[i + 1]!) * k
    running[i + 2] = running[i + 2]! + (adjusted[i + 2]! - running[i + 2]!) * k
  }
}
