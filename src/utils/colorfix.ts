/**
 * 结果图校色（2026-11-06 交付包「阶段 1 校色闭环」，整图 v1）。
 *
 * <p>五参数与校色包 API 一致：色相 / 饱和度 / 明度 / 亮度 / 对比度。默认值取校色包在图四
 * 给出的那组真实参数（ hue 3 / sat −16 / light −6 / bright −17 / contrast 10）。
 *
 * <p>整图校色：滤镜烘进像素（下载 / 前后对比 / 存资产都要真图，不能只挂 CSS filter）。
 * 逐件蒙版（只调服装不调背景）需要服务端分割（SAM3）随结果返回 maskUrl，接口参数已预留
 * `maskUrl`——有蒙版时按软边 alpha 只合成蒙版内像素，没有时整图校色，合成逻辑两种共用。
 * 输出一律无损 PNG：承诺「蒙版外一个像素不动」时 JPEG 的有损压缩不成立；PNG 同时保留透明通道
 * （抠图等透明底结果烘完仍透明）。尺寸只缩不放（长边 ≤ maxSide，原图更小按原尺寸）。
 */
import { reactive } from 'vue'

export interface ColorFixParams {
  hue: number
  sat: number
  light: number
  bright: number
  contrast: number
}

/** 「默认校色」参数（校色包图四的真实值） */
export const COLORFIX_DEFAULT: ColorFixParams = { hue: 3, sat: -16, light: -6, bright: -17, contrast: 10 }

export const COLORFIX_RANGES: Record<keyof ColorFixParams, { min: number; max: number }> = {
  hue: { min: -30, max: 30 },
  sat: { min: -60, max: 70 },
  light: { min: -40, max: 40 },
  bright: { min: -80, max: 80 },
  contrast: { min: -50, max: 50 },
}

/** 两组参数是否完全相同（「恢复默认」禁用、是否调过参数都看它） */
export function colorFixEquals(a: ColorFixParams, b: ColorFixParams): boolean {
  return (
    a.hue === b.hue && a.sat === b.sat && a.light === b.light && a.bright === b.bright && a.contrast === b.contrast
  )
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

/** 五参数 → CSS filter 串（预览直接挂；烘图时同样喂给 ctx.filter） */
export function colorFixFilter(p: ColorFixParams): string {
  const light = 1 + p.light / 200
  const bright = 1 + p.bright / 100
  return [
    `hue-rotate(${p.hue}deg)`,
    `saturate(${Math.max(0, 100 + p.sat)}%)`,
    `brightness(${Math.max(0.05, light * bright)})`,
    `contrast(${Math.max(0, 100 + p.contrast)}%)`,
  ].join(' ')
}

/**
 * 下载 / 存资产等导出场景的长边上限：原图更小时按原尺寸输出（{@link colorFixImage} 只缩不放），
 * 更大时等比缩到 4096——再大 PNG dataURL 动辄上百 MB，画布内存在 Safari 上也会超限。
 */
export const COLORFIX_EXPORT_MAX_SIDE = 4096

// ---------------- 烘图：ctx.filter 优先，不支持的浏览器（旧 Safari）逐像素软件实现 ----------------

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * 与 {@link colorFixFilter} 同序同公式的逐像素实现（sRGB 空间，Filter Effects 规范的 hue-rotate / saturate 矩阵 +
 * brightness / contrast 线性映射，每一步夹回 0–255）。只改 RGB，alpha 原样保留（透明底抠图结果烘完仍是透明底）。
 * 浏览器里 CSS filter 的实现细节可能有极小差异，肉眼不可辨。
 */
function applyColorFixPixels(data: Uint8ClampedArray, p: ColorFixParams) {
  const rad = (p.hue * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const h = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
  const k = Math.max(0, 100 + p.sat) / 100
  const t = [
    0.213 + 0.787 * k, 0.715 - 0.715 * k, 0.072 - 0.072 * k,
    0.213 - 0.213 * k, 0.715 + 0.285 * k, 0.072 - 0.072 * k,
    0.213 - 0.213 * k, 0.715 - 0.715 * k, 0.072 + 0.928 * k,
  ] as const
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = h as [number, number, number, number, number, number, number, number, number]
  const [t0, t1, t2, t3, t4, t5, t6, t7, t8] = t
  // brightness → contrast 两步都是逐通道映射，合成一张 256 项查找表
  const bright = Math.max(0.05, (1 + p.light / 200) * (1 + p.bright / 100))
  const contrast = Math.max(0, 100 + p.contrast) / 100
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = clamp255((clamp255(v * bright) - 127.5) * contrast + 127.5)
  for (let i = 0; i < data.length; i += 4) {
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

/** 把原图按五参数画进画布（整幅）。ctx.filter 可用时走 GPU 滤镜，否则 getImageData 逐像素处理 */
function drawColorFixed(ctx: CanvasRenderingContext2D, img: CanvasImageSource, width: number, height: number, p: ColorFixParams) {
  if (typeof (ctx as { filter?: unknown }).filter === 'string') {
    ctx.filter = colorFixFilter(p)
    ctx.drawImage(img, 0, 0, width, height)
    ctx.filter = 'none'
    return
  }
  ctx.drawImage(img, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height)
  applyColorFixPixels(data.data, p)
  ctx.putImageData(data, 0, 0)
}

// ---------------- 图片 / 结果缓存（有界，长会话不涨内存） ----------------

/** 已解码原图 / 蒙版的 LRU 上限：同屏最多几张结果来回切，8 张够用 */
const IMAGE_CACHE_MAX = 8
/** 预览尺寸烘图结果的上限（dataURL 字符串） */
const RESULT_CACHE_MAX = 8
/** 导出尺寸（长边 > 预览默认值）的烘图只留最近 1 张：4096 PNG 的 dataURL 动辄几十 MB */
const EXPORT_CACHE_MAX = 1
const PREVIEW_MAX_SIDE = 1600

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const resultCache = new Map<string, string>()
const exportCache = new Map<string, string>()

/** Map 当 LRU 用：命中挪到队尾 */
function touch<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key)
  map.set(key, value)
}

/** 淘汰到上限以内；被淘汰的图片解掉 src，让浏览器尽早回收解码后的位图 */
function evictImages() {
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value as string
    const task = imageCache.get(oldest)
    imageCache.delete(oldest)
    void task?.then((img) => {
      img.onload = img.onerror = null
      img.removeAttribute('src')
    }, () => {})
  }
}

function evictStrings(map: Map<string, string>, max: number) {
  while (map.size > max) {
    const oldest = map.keys().next().value as string
    const v = map.get(oldest)
    map.delete(oldest)
    if (v?.startsWith('blob:')) URL.revokeObjectURL(v)
  }
}

/**
 * 某个地址（多为蒙版 objectURL）不再使用：从图片缓存与烘图结果缓存里摘掉，之后可以安全 revoke。
 * 烘图结果是 dataURL，不依赖原地址，摘掉只是不再命中。
 */
export function forgetColorFixSource(url: string): void {
  const task = imageCache.get(url)
  imageCache.delete(url)
  void task?.then((img) => {
    img.onload = img.onerror = null
    img.removeAttribute('src')
  }, () => {})
  for (const cache of [resultCache, exportCache]) {
    for (const key of [...cache.keys()]) if (key.includes(`|${url}|`)) cache.delete(key)
  }
}

/** 加一个防缓存查询参数（同一地址先被不带 crossorigin 的 <img> 拉过、缓存里是没有 CORS 头的那份时用） */
function bustCache(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src
  try {
    const u = new URL(src, location.href)
    u.searchParams.set('_cf', Date.now().toString(36))
    return u.toString()
  } catch {
    return src
  }
}

function loadOnce(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/**
 * 跨域加载一张可读像素的图。第一次失败（多半是缓存里命中了先前不带 CORS 头的响应）时带防缓存参数再拉一次，
 * 两次都失败才算失败。签名地址加参数可能验签失败——那种情况本来就读不了像素，结果一样是失败。
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(src)
  if (hit) {
    touch(imageCache, src, hit)
    return hit
  }
  const task = loadOnce(src).catch(() => {
    const busted = bustCache(src)
    if (busted === src) throw new Error('图片加载失败')
    return loadOnce(busted)
  })
  imageCache.set(src, task)
  evictImages()
  return task
}

// ---------------- <img crossorigin> 兜底：展示用的图带 crossorigin，服务端没配 CORS 时退回普通加载 ----------------

const corsBlocked = reactive(new Set<string>())

/**
 * 展示校色相关结果图的 `crossorigin` 属性值：默认 'anonymous'，让浏览器缓存里存的是带 CORS 头的那份，
 * 烘图（canvas 读像素）不会命中没有 CORS 头的缓存而失败；这张图带 crossorigin 加载失败过就退回不带
 * （配合 {@link markCorsBlocked}），保证至少能看到图。
 */
export function corsAttr(src: string | null | undefined): 'anonymous' | undefined {
  return src && !corsBlocked.has(src) && !src.startsWith('data:') && !src.startsWith('blob:') ? 'anonymous' : undefined
}

/** 带 crossorigin 的 <img> 加载失败时调用（@error），之后这张图退回普通加载 */
export function markCorsBlocked(src: string | null | undefined) {
  if (src && !corsBlocked.has(src) && corsAttr(src)) corsBlocked.add(src)
}

/** 蒙版的附加处理（局部调色）；都不传 = 与旧行为完全一致 */
export interface ColorFixMaskOptions {
  /** 反选：调蒙版外、蒙版内不动 */
  invert?: boolean
  /**
   * 边缘柔化（0–20）：以「长边 1000px」为基准的模糊半径，按输出尺寸等比换算——预览（1600）与导出（4096）
   * 的柔化观感一致。0 / 不传 = 不柔化。
   */
  feather?: number
}

/** 看起来没有透明信息的蒙版（整幅不透明）按亮度当 alpha：黑底白笔 PNG（MaskPainter / 多数分割服务）也能直接用 */
function maskToAlpha(data: Uint8ClampedArray, invert: boolean) {
  let opaque = true
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) {
      opaque = false
      break
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const a = opaque ? Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) : data[i + 3]!
    data[i] = data[i + 1] = data[i + 2] = 255
    data[i + 3] = invert ? 255 - a : a
  }
}

/** alpha 通道的三遍可分离盒式模糊（≈ 高斯），ctx.filter 不可用时的柔化兜底 */
function blurAlpha(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  const r = Math.max(1, Math.round(radius / 1.5))
  const a = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3]!
  const tmp = new Float32Array(w * h)
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h
    const lines = horizontal ? h : w
    for (let l = 0; l < lines; l++) {
      const at = (k: number) => (horizontal ? l * w + k : k * w + l)
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
  for (let i = 0; i < a.length; i++) data[i * 4 + 3] = a[i]!
}

/** 把任意蒙版图（alpha 或黑白）整理成「白色 + alpha = 调整强度」的画布，按需反选与柔化 */
function prepareMask(mask: HTMLImageElement, width: number, height: number, opts: ColorFixMaskOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  ctx.drawImage(mask, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height)
  maskToAlpha(data.data, !!opts.invert)
  const blur = opts.feather && opts.feather > 0 ? (opts.feather * Math.max(width, height)) / 1000 : 0
  if (blur > 0 && typeof (ctx as { filter?: unknown }).filter !== 'string') blurAlpha(data.data, width, height, blur)
  ctx.putImageData(data, 0, 0)
  if (blur > 0 && typeof (ctx as { filter?: unknown }).filter === 'string') {
    // ctx.filter 的 blur 把画布外当透明，边缘会往里衰减；先按 3×半径复制边缘像素垫一圈再模糊、再裁回，
    // 与 blurAlpha（下标钳在边缘 = 边缘复制）口径一致
    const pad = Math.ceil(blur * 3)
    const pw = width + pad * 2
    const ph = height + pad * 2
    const padded = document.createElement('canvas')
    padded.width = pw
    padded.height = ph
    const pctx = padded.getContext('2d')
    const blurred = document.createElement('canvas')
    blurred.width = pw
    blurred.height = ph
    const bctx = blurred.getContext('2d')
    const soft = document.createElement('canvas')
    soft.width = width
    soft.height = height
    const sctx = soft.getContext('2d')
    if (!pctx || !bctx || !sctx) {
      padded.width = padded.height = blurred.width = blurred.height = soft.width = soft.height = 0
      const raw = ctx.getImageData(0, 0, width, height)
      blurAlpha(raw.data, width, height, blur)
      ctx.putImageData(raw, 0, 0)
      return canvas
    }
    pctx.imageSmoothingEnabled = false
    const w = width
    const h = height
    pctx.drawImage(canvas, pad, pad)
    // 四条边
    pctx.drawImage(canvas, 0, 0, w, 1, pad, 0, w, pad)
    pctx.drawImage(canvas, 0, h - 1, w, 1, pad, pad + h, w, pad)
    pctx.drawImage(canvas, 0, 0, 1, h, 0, pad, pad, h)
    pctx.drawImage(canvas, w - 1, 0, 1, h, pad + w, pad, pad, h)
    // 四个角
    pctx.drawImage(canvas, 0, 0, 1, 1, 0, 0, pad, pad)
    pctx.drawImage(canvas, w - 1, 0, 1, 1, pad + w, 0, pad, pad)
    pctx.drawImage(canvas, 0, h - 1, 1, 1, 0, pad + h, pad, pad)
    pctx.drawImage(canvas, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad)
    bctx.filter = `blur(${blur.toFixed(2)}px)`
    bctx.drawImage(padded, 0, 0)
    sctx.drawImage(blurred, pad, pad, w, h, 0, 0, w, h)
    canvas.width = canvas.height = padded.width = padded.height = blurred.width = blurred.height = 0
    return soft
  }
  return canvas
}

/** 选区蒙版拿不到（跨域 / 404 / blob 已回收）：不退回整图校色，抛这个错，由调用方走失败 / 原图兜底 */
export const COLORFIX_MASK_LOAD_FAILED = '选区蒙版加载失败，未应用校色'
export class ColorFixMaskLoadError extends Error {
  constructor() {
    super(COLORFIX_MASK_LOAD_FAILED)
    this.name = 'ColorFixMaskLoadError'
  }
}

/** 烘图失败的提示语：蒙版加载失败给专门的一句，其余返回 fallback */
export function colorFixFailureText(err: unknown, fallback: string): string {
  return err instanceof ColorFixMaskLoadError ? COLORFIX_MASK_LOAD_FAILED : fallback
}

/**
 * 把五参数烘成一张 PNG dataURL。
 * - 有 maskUrl：原图打底，校色层按蒙版 alpha 合成（逐件校色，蒙版外不动）；
 * - 无 maskUrl：整图校色。
 * 结果缓存：预览尺寸 LRU ≤8，导出尺寸（maxSide > 1600）只留最近 1 张。
 */
export async function colorFixImage(
  src: string,
  p: ColorFixParams,
  maskUrl?: string | null,
  /** 长边上限：舞台预览默认 1600；下载 / 存资产传更大的值（如 4096）尽量保留原分辨率 */
  maxSide = PREVIEW_MAX_SIDE,
  /** 局部调色：反选 / 边缘柔化（只在有 maskUrl 时生效）；maskUrl 可以是 http / blob: / data: 地址 */
  maskOpts: ColorFixMaskOptions = {},
): Promise<string> {
  const invert = !!maskUrl && !!maskOpts.invert
  const feather = maskUrl ? Math.max(0, Math.min(20, maskOpts.feather ?? 0)) : 0
  const key = `${src}|${maskUrl ?? 'none'}|${invert ? 'inv' : ''}${feather}|${maxSide}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}`
  const isExport = maxSide > PREVIEW_MAX_SIDE
  const cache = isExport ? exportCache : resultCache
  const hit = cache.get(key)
  if (hit) {
    touch(cache, key, hit)
    return hit
  }

  const img = await loadImage(src).catch((err) => {
    // 失败的加载不留在缓存里，下次（如网络恢复）重新拉
    imageCache.delete(src)
    throw err
  })
  // 给了蒙版却拿不到（跨域 / 404 / blob 已回收）：抛 ColorFixMaskLoadError，不悄悄退回整图校色（那会把选区外也调了）；
  // 调用方的 failed / 原图兜底接住，提示「选区蒙版加载失败，未应用校色」
  const mask = maskUrl
    ? await loadImage(maskUrl).catch(() => {
      imageCache.delete(maskUrl)
      throw new ColorFixMaskLoadError()
    })
    : null
  const max = maxSide
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布不可用')

  if (!mask) {
    drawColorFixed(ctx, img, width, height, p)
  } else {
    // 1) 校色层 × 蒙版 alpha（destination-in）；2) 原图 × (1 − 蒙版 alpha)（destination-out）；3) 两层相加（lighter）。
    // 相加而不是「原图打底再盖校色层」：透明底原图（抠图）半透明边缘的 alpha 不会被叠高，蒙版外像素逐位等于原图
    const alpha = prepareMask(mask, width, height, { invert, feather })
    const layer = (corrected: boolean) => {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const lctx = c.getContext('2d')
      if (!lctx) throw new Error('画布不可用')
      if (corrected) drawColorFixed(lctx, img, width, height, p)
      else lctx.drawImage(img, 0, 0, width, height)
      lctx.globalCompositeOperation = corrected ? 'destination-in' : 'destination-out'
      lctx.drawImage(alpha, 0, 0)
      return c
    }
    const inside = layer(true)
    const outside = layer(false)
    alpha.width = alpha.height = 0
    ctx.drawImage(outside, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(inside, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    inside.width = inside.height = outside.width = outside.height = 0
  }

  const out = canvas.toDataURL('image/png')
  // 用完即释放画布的像素缓冲（Safari 对画布总内存有上限）
  canvas.width = canvas.height = 0
  cache.set(key, out)
  evictStrings(cache, isExport ? EXPORT_CACHE_MAX : RESULT_CACHE_MAX)
  return out
}

/** dataURL PNG → Blob（上传 / 下载共用） */
export function colorFixDataUrlToBlob(dataUrl: string): Blob {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: 'image/png' })
}

/** dataURL PNG → File（存资产走 goUploadImage 的文件口） */
export function colorFixDataUrlToFile(dataUrl: string, name = 'colorfix.png'): File {
  return new File([colorFixDataUrlToBlob(dataUrl)], name, { type: 'image/png' })
}

// ---------------- 参数随历史记录还原（localStorage，按任务号存） ----------------

const KEY_PREFIX = 'colorfix:'

/** 读某条历史记录的校色参数；没有存过返回 null（调用方复位默认） */
export function loadColorFix(taskUid: string): ColorFixParams | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + taskUid)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ColorFixParams>
    if (typeof value.hue !== 'number' || typeof value.sat !== 'number' || typeof value.light !== 'number'
      || typeof value.bright !== 'number' || typeof value.contrast !== 'number') return null
    return { hue: value.hue, sat: value.sat, light: value.light, bright: value.bright, contrast: value.contrast }
  } catch {
    return null
  }
}

/** 存某条历史记录的校色参数（切回记录时还原用） */
export function saveColorFix(taskUid: string, p: ColorFixParams): void {
  try {
    localStorage.setItem(KEY_PREFIX + taskUid, JSON.stringify(p))
  } catch {
    /* 存储满 / 隐私模式：校色参数丢还原而已，不打断主流程 */
  }
}

/** 清掉某条历史记录的校色参数 */
export function clearColorFix(taskUid: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + taskUid)
  } catch {
    /* 同上 */
  }
}
