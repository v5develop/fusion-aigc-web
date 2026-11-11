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

// ---------------- 更多调整：白平衡 + HSL 分色（2026-11-11） ----------------

/** HSL 分色的 8 个色带（顺序固定：存储 / 界面都按它） */
export const COLORFIX_HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'] as const
export type ColorFixHslBand = (typeof COLORFIX_HSL_BANDS)[number]
export const COLORFIX_HSL_BAND_LABELS: Record<ColorFixHslBand, string> = {
  red: '红',
  orange: '橙',
  yellow: '黄',
  green: '绿',
  cyan: '青',
  blue: '蓝',
  purple: '紫',
  magenta: '洋红',
}
/**
 * 各色带中心（OKLCH 色相，度）：按 sRGB 纯色 / 常见色在 OKLCH 里的色相取（红 29、橙 53–71、黄 110、绿 142、青 195、
 * 蓝 262–264、紫 294、洋红 328），间距不均匀——相邻中心之间按余弦平方过渡，任意色相的各带权重之和恒为 1。
 */
export const COLORFIX_HSL_CENTERS: readonly number[] = [25, 62, 105, 142, 195, 260, 295, 335]
/** 界面上各色带色块的颜色 */
export const COLORFIX_HSL_SWATCHES: Record<ColorFixHslBand, string> = {
  red: '#d9413b',
  orange: '#e8842a',
  yellow: '#e6c534',
  green: '#3fa356',
  cyan: '#2fb3c0',
  blue: '#3467d6',
  purple: '#8a4fd0',
  magenta: '#d04aa8',
}

/** 一个色带的偏移：色相 / 饱和度 / 明度，各 −100…100 */
export interface ColorFixHslShift {
  h: number
  s: number
  l: number
}

/** 更多调整：白平衡（色温 / 色调，各 −100…100）+ 8 个色带的 HSL 偏移 + 是否保护肤色 */
export interface ColorFixAdjust {
  /** 色温：负 = 冷（偏蓝），正 = 暖（偏黄） */
  temp: number
  /** 色调：负 = 偏绿，正 = 偏洋红 */
  tint: number
  /** 8 个色带（顺序同 {@link COLORFIX_HSL_BANDS}） */
  hsl: ColorFixHslShift[]
  /** 保护肤色：HSL 分色对肤色区域减弱 80% */
  skin: boolean
}

export const COLORFIX_ADJUST_RANGE = { min: -100, max: 100 }

export function adjustZero(): ColorFixAdjust {
  return { temp: 0, tint: 0, hsl: COLORFIX_HSL_BANDS.map(() => ({ h: 0, s: 0, l: 0 })), skin: false }
}

const clampAdj = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(-100, Math.round(n))) : 0

/** 任意来源的「更多调整」→ 合法值（缺字段补 0、越界夹回）；不是对象返回 null */
export function adjustSanitize(raw: unknown): ColorFixAdjust | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const list = Array.isArray(o.hsl) ? o.hsl : []
  return {
    temp: clampAdj(o.temp),
    tint: clampAdj(o.tint),
    hsl: COLORFIX_HSL_BANDS.map((_, i) => {
      const b = (list[i] ?? {}) as Record<string, unknown>
      return { h: clampAdj(b?.h), s: clampAdj(b?.s), l: clampAdj(b?.l) }
    }),
    skin: o.skin === true,
  }
}

/** 白平衡与 HSL 都是零（不改图；skin 开关不算） */
export function adjustIsZero(a: ColorFixAdjust | null | undefined): boolean {
  if (!a) return true
  return a.temp === 0 && a.tint === 0 && a.hsl.every((b) => b.h === 0 && b.s === 0 && b.l === 0)
}

/** 签名（缓存键 / 去重）：零 = '' */
export function adjustSignature(a: ColorFixAdjust | null | undefined): string {
  if (!a || adjustIsZero(a)) return ''
  return `${a.temp},${a.tint},${a.skin ? 1 : 0}:${a.hsl.map((b) => `${b.h}.${b.s}.${b.l}`).join('/')}`
}

/** 白平衡每 100 点在对数域里的力度（log2，单侧）：色温 R / B 反向 ±0.6 档、色调 G ±0.4 档 */
const WB_TEMP_STOPS = 0.6
const WB_TINT_STOPS = 0.4

/**
 * 白平衡增益（线性 RGB 三通道乘数）：色温 R↑B↓（暖）、色调 G↓（洋红）；按 Rec.709 亮度归一，灰色调完亮度不变。
 */
export function wbGains(temp: number, tint: number): [number, number, number] {
  const t = temp / 100
  const g = tint / 100
  const r = Math.pow(2, WB_TEMP_STOPS * t)
  const b = Math.pow(2, -WB_TEMP_STOPS * t)
  const gg = Math.pow(2, -WB_TINT_STOPS * g)
  const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b
  return [r / y, gg / y, b / y]
}

/**
 * 中性灰吸管：给一个「本该是灰色」的像素（sRGB 8 位），算出让它变成灰的色温 / 色调（{@link wbGains} 的反解，
 * 夹在 ±100；极暗像素按 1/255 兜底，避免 log(0)）。
 */
export function neutralGrayWB(r: number, g: number, b: number): { temp: number; tint: number } {
  const lin = (v: number) => Math.max(SRGB_TO_LINEAR[1]!, SRGB_TO_LINEAR[Math.round(clamp255(v))]!)
  const lr = Math.log2(lin(r))
  const lg = Math.log2(lin(g))
  const lb = Math.log2(lin(b))
  const t = (lb - lr) / (2 * WB_TEMP_STOPS)
  const tn = (lg - (lr + lb) / 2) / WB_TINT_STOPS
  const c = (v: number) => Math.min(100, Math.max(-100, Math.round(v * 100)))
  return { temp: c(t) || 0, tint: c(tn) || 0 }
}

/**
 * 某个色相（OKLCH，度）在 8 个色带上的权重：落在相邻两个中心之间，按位置 t 分给两边 cos²(πt/2) / sin²(πt/2)——
 * 连续、平滑（中心处导数为 0）、和恒为 1。out 可复用。
 */
export function hslBandWeights(hueDeg: number, out: Float64Array = new Float64Array(8)): Float64Array {
  out.fill(0)
  const C = COLORFIX_HSL_CENTERS
  const n = C.length
  const h = ((hueDeg % 360) + 360) % 360
  let i = n - 1
  for (let k = 0; k < n; k++) if (h >= C[k]!) i = k
  // h 比第一个中心还小：属于「最后一个 → 第一个」那一段（跨 360）
  const a = C[i]!
  const j = (i + 1) % n
  let span = C[j]! - a
  if (span <= 0) span += 360
  let d = h - a
  if (d < 0) d += 360
  const t = Math.min(1, Math.max(0, d / span))
  const s = Math.sin((Math.PI / 2) * t)
  out[i] = 1 - s * s
  out[j] = s * s
  return out
}

/**
 * 肤色权重 0–1（OKLCH）：色相围绕 54°（高斯 σ≈16°）× 彩度窗（0.02–0.14 之间）× 亮度窗（0.35–0.95）。
 * 「保护肤色」时 HSL 分色对这部分减弱 80%。
 */
export function skinWeight(L: number, C: number, hueDeg: number): number {
  let dh = Math.abs((((hueDeg - 54) % 360) + 540) % 360 - 180)
  dh = dh / 16
  const hw = Math.exp(-dh * dh)
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))
  const cw = ramp(C, 0.012, 0.03) * (1 - ramp(C, 0.13, 0.18))
  const lw = ramp(L, 0.3, 0.42) * (1 - ramp(L, 0.94, 0.99))
  return hw * cw * lw
}

/** 预先算好的调整（逐像素用） */
export interface PreparedAdjust {
  gains: [number, number, number] | null
  /** 8 个色带的 [Δ色相(弧度), Δ饱和度(比例), Δ明度(比例)]；null = 不做 HSL */
  bands: Float64Array | null
  skin: boolean
}

export function prepareAdjust(a: ColorFixAdjust): PreparedAdjust {
  const gains = a.temp || a.tint ? wbGains(a.temp, a.tint) : null
  const any = a.hsl.some((b) => b.h || b.s || b.l)
  let bands: Float64Array | null = null
  if (any) {
    bands = new Float64Array(24)
    a.hsl.forEach((b, i) => {
      // 色相 ±100 → ±30°；饱和度 ±100 → 彩度 ×0…×2；明度 ±100 → 往黑 / 白挪一半
      bands![i * 3] = ((b.h * 0.3) / 180) * Math.PI
      bands![i * 3 + 1] = b.s / 100
      bands![i * 3 + 2] = b.l / 100
    })
  }
  return { gains, bands, skin: a.skin }
}

const tmpW = new Float64Array(8)
const tmpLab: Lab = [0, 0, 0]
/**
 * 单个像素按 {@link PreparedAdjust} 调整（sRGB 8 位进、出；out 可复用）：先白平衡（线性 RGB 乘增益）、再 HSL 分色
 * （OKLCH：色相旋转、彩度缩放、亮度往黑 / 白挪），越界按彩度收回色域。灰色（彩度 < 0.01）不受 HSL 影响，0.01–0.05 渐入。
 */
export function adjustPixel(r: number, g: number, b: number, p: PreparedAdjust, out: Lab = [0, 0, 0]): Lab {
  let lr = SRGB_TO_LINEAR[r & 255]!
  let lg = SRGB_TO_LINEAR[g & 255]!
  let lb = SRGB_TO_LINEAR[b & 255]!
  if (p.gains) {
    lr *= p.gains[0]
    lg *= p.gains[1]
    lb *= p.gains[2]
  }
  if (!p.bands) {
    out[0] = linearToSrgb8(lr)
    out[1] = linearToSrgb8(lg)
    out[2] = linearToSrgb8(lb)
    return out
  }
  linearToOklab(Math.min(1, lr), Math.min(1, lg), Math.min(1, lb), tmpLab)
  const L = tmpLab[0]
  const A = tmpLab[1]
  const B = tmpLab[2]
  const C = Math.hypot(A, B)
  const cw = C <= 0.01 ? 0 : C >= 0.05 ? 1 : (C - 0.01) / 0.04
  if (cw === 0) {
    out[0] = linearToSrgb8(lr)
    out[1] = linearToSrgb8(lg)
    out[2] = linearToSrgb8(lb)
    return out
  }
  const h = Math.atan2(B, A)
  const hDeg = (h * 180) / Math.PI
  hslBandWeights(hDeg, tmpW)
  let dh = 0
  let ds = 0
  let dl = 0
  for (let i = 0; i < 8; i++) {
    const w = tmpW[i]!
    if (!w) continue
    dh += w * p.bands[i * 3]!
    ds += w * p.bands[i * 3 + 1]!
    dl += w * p.bands[i * 3 + 2]!
  }
  let f = cw
  if (p.skin) f *= 1 - 0.8 * skinWeight(L, C, hDeg)
  const h2 = h + dh * f
  const C2 = C * Math.max(0, 1 + ds * f)
  const k = dl * 0.5 * f
  const L2 = k >= 0 ? L + (1 - L) * k : L * (1 + k)
  const lin = gamutMap(L2, C2 * Math.cos(h2), C2 * Math.sin(h2))
  out[0] = linearToSrgb8(lin[0])
  out[1] = linearToSrgb8(lin[1])
  out[2] = linearToSrgb8(lin[2])
  return out
}

/** 3D 查找表边长：33³ 个格点，三线性插值（预览用；绝大多数像素与精算差 ≤ 2 级，色域边界附近极端参数最多约 20 级，导出走精算） */
export const ADJUST_LUT_SIZE = 33

/** 按调整建 3D 查找表（sRGB 立方体 size³ 个格点 × RGB，Uint8） */
export function buildAdjustLut(a: ColorFixAdjust, size = ADJUST_LUT_SIZE): Uint8ClampedArray {
  const p = prepareAdjust(a)
  const lut = new Uint8ClampedArray(size * size * size * 3)
  const out: Lab = [0, 0, 0]
  const step = 255 / (size - 1)
  let i = 0
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        adjustPixel(Math.round(ri * step), Math.round(gi * step), Math.round(bi * step), p, out)
        lut[i++] = out[0]
        lut[i++] = out[1]
        lut[i++] = out[2]
      }
  return lut
}

/** RGBA 像素就地套 3D 查找表（三线性；只改 RGB）；mask（可选，0–255）为 0 的像素跳过 */
export function applyAdjustLut(data: Uint8ClampedArray, lut: Uint8ClampedArray, size = ADJUST_LUT_SIZE, mask?: Uint8Array | null) {
  const s1 = size - 1
  const k = s1 / 255
  const sz2 = size * size
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    if (mask && mask[px] === 0) continue
    const fr = data[i]! * k
    const fg = data[i + 1]! * k
    const fb = data[i + 2]! * k
    const r0 = fr >= s1 ? s1 - 1 : fr | 0
    const g0 = fg >= s1 ? s1 - 1 : fg | 0
    const b0 = fb >= s1 ? s1 - 1 : fb | 0
    const dr = fr - r0
    const dg = fg - g0
    const db = fb - b0
    const base = (b0 * sz2 + g0 * size + r0) * 3
    const oR = 3
    const oG = size * 3
    const oB = sz2 * 3
    for (let c = 0; c < 3; c++) {
      const q = base + c
      const c00 = lut[q]! + (lut[q + oR]! - lut[q]!) * dr
      const c10 = lut[q + oG]! + (lut[q + oG + oR]! - lut[q + oG]!) * dr
      const c01 = lut[q + oB]! + (lut[q + oB + oR]! - lut[q + oB]!) * dr
      const c11 = lut[q + oB + oG]! + (lut[q + oB + oG + oR]! - lut[q + oB + oG]!) * dr
      const c0 = c00 + (c10 - c00) * dg
      const c1 = c01 + (c11 - c01) * dg
      data[i + c] = c0 + (c1 - c0) * db
    }
  }
}

const lutCache = new Map<string, Uint8ClampedArray>()
/**
 * RGBA 像素就地做「更多调整」（查找表按签名缓存 8 份）；零调整直接返回。
 * exact = 逐像素精算（不走查找表；导出真图用——查找表在色域边界附近极端参数下最多差约 20 级，导出不能带这个误差，
 * 4MP 约 0.6s，可接受）。
 */
export function applyAdjustPixels(
  data: Uint8ClampedArray,
  a: ColorFixAdjust | null | undefined,
  mask?: Uint8Array | null,
  exact = false,
) {
  const sig = adjustSignature(a)
  if (!sig || !a) return
  if (exact) {
    const p = prepareAdjust(a)
    const out: Lab = [0, 0, 0]
    for (let i = 0, px = 0; i < data.length; i += 4, px++) {
      if (mask && mask[px] === 0) continue
      adjustPixel(data[i]!, data[i + 1]!, data[i + 2]!, p, out)
      data[i] = out[0]
      data[i + 1] = out[1]
      data[i + 2] = out[2]
    }
    return
  }
  let lut = lutCache.get(sig)
  if (!lut) {
    lut = buildAdjustLut(a)
    lutCache.set(sig, lut)
    while (lutCache.size > 8) lutCache.delete(lutCache.keys().next().value as string)
  }
  applyAdjustLut(data, lut, ADJUST_LUT_SIZE, mask)
}
