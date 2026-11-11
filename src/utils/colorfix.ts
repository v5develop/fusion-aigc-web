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
import {
  adjustSignature,
  applyColorFixPixels,
  compositeStep,
  computeHistogram,
  coverUnion,
  writeCover,
  type CompositeStep,
  dominantLab,
  oklabToSrgb8,
  parseHex,
  srgb8ToOklab,
  toHex,
  type ColorFixHistogram,
  type Lab,
  type ColorFixAdjust,
  type ColorFixParams,
} from './colorfix-math.ts'
import { OffloadUnavailable, compositeInWorker, offloadAvailable } from './colorfix-offload.ts'

export {
  COLORFIX_DEFAULT,
  COLORFIX_ZERO,
  COLORFIX_RANGES,
  colorFixEquals,
  colorFixSanitize,
  colorFixIsZero,
  type ColorFixParams,
} from './colorfix-math.ts'

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

/** 把原图按五参数画进画布（整幅）。ctx.filter 可用时走 GPU 滤镜，否则 getImageData 逐像素处理 */
function drawColorFixed(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  width: number,
  height: number,
  p: ColorFixParams,
) {
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
    void task?.then(
      (img) => {
        img.onload = img.onerror = null
        img.removeAttribute('src')
      },
      () => {},
    )
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
  void task?.then(
    (img) => {
      img.onload = img.onerror = null
      img.removeAttribute('src')
    },
    () => {},
  )
  for (const cache of [resultCache, exportCache]) {
    for (const key of [...cache.keys()]) if (key.includes(`|${url}|`)) cache.delete(key)
  }
  for (const key of [...dominantCache.keys()]) if (key.includes(`|${url}|`)) dominantCache.delete(key)
  for (const key of [...histCache.keys()]) if (key.includes(`|${url}|`)) histCache.delete(key)
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
function maskToAlpha(data: Uint8ClampedArray, invert: boolean, forceOpaque?: boolean) {
  let opaque = true
  if (forceOpaque !== undefined) opaque = forceOpaque
  else
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

/**
 * 局部渲染（全屏 100% 清晰度）时蒙版的摆放：画布只是整幅输出（fullW × fullH）里从 (x, y) 起的一块；
 * 柔化半径按整幅尺寸算；opaque = 蒙版整体是否不透明（按整幅判断，一块区域里判不准）。
 */
interface MaskPlacement {
  x: number
  y: number
  fullW: number
  fullH: number
  opaque: boolean
}

/** 把任意蒙版图（alpha 或黑白）整理成「白色 + alpha = 调整强度」的画布，按需反选与柔化 */
function prepareMask(
  mask: HTMLImageElement,
  width: number,
  height: number,
  opts: ColorFixMaskOptions,
  place?: MaskPlacement,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  if (place) ctx.drawImage(mask, -place.x, -place.y, place.fullW, place.fullH)
  else ctx.drawImage(mask, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height)
  maskToAlpha(data.data, !!opts.invert, place?.opaque)
  const base = place ? Math.max(place.fullW, place.fullH) : Math.max(width, height)
  const blur = opts.feather && opts.feather > 0 ? (opts.feather * base) / 1000 : 0
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

/**
 * 选区可视化（全屏调色的「显示选区」）：把蒙版（alpha 或黑白，口径同烘图）画成半透明着色层，按 invert 反选；
 * 长边缩到 maxSide 以内（只是示意）。蒙版读不了像素时抛错，调用方不显示即可。
 */
export async function colorFixMaskOverlay(
  maskUrl: string,
  opts: { invert?: boolean; maxSide?: number; rgb?: [number, number, number]; alpha?: number } = {},
): Promise<HTMLCanvasElement> {
  const mask = await loadImage(maskUrl)
  const scale = Math.min(1, (opts.maxSide ?? 1024) / Math.max(mask.naturalWidth || 1, mask.naturalHeight || 1))
  const w = Math.max(1, Math.round((mask.naturalWidth || 1) * scale))
  const h = Math.max(1, Math.round((mask.naturalHeight || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  ctx.drawImage(mask, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  maskToAlpha(data.data, !!opts.invert)
  const [r, g, b] = opts.rgb ?? [135, 95, 154]
  const k = opts.alpha ?? 0.5
  for (let i = 0; i < data.data.length; i += 4) {
    data.data[i] = r
    data.data[i + 1] = g
    data.data[i + 2] = b
    data.data[i + 3] = Math.round(data.data[i + 3]! * k)
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/**
 * 蒙版 → 单通道 alpha（口径同烘图：黑白 / 透明蒙版都认，按 invert 反选；不柔化），长边缩到 maxSide 以内。
 * 全屏「显示选区」的各种查看方式用。读不了像素时抛错。
 */
export async function colorFixMaskAlpha(
  maskUrl: string,
  opts: { invert?: boolean; maxSide?: number } = {},
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const mask = await loadImage(maskUrl)
  const scale = Math.min(1, (opts.maxSide ?? 1024) / Math.max(mask.naturalWidth || 1, mask.naturalHeight || 1))
  const w = Math.max(1, Math.round((mask.naturalWidth || 1) * scale))
  const h = Math.max(1, Math.round((mask.naturalHeight || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  ctx.drawImage(mask, 0, 0, w, h)
  const rgba = ctx.getImageData(0, 0, w, h).data
  canvas.width = canvas.height = 0
  maskToAlpha(rgba, !!opts.invert)
  const data = new Uint8Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]!
  return { data, width: w, height: h }
}

/** 选区蒙版拿不到（跨域 / 404 / blob 已回收）：不退回整图校色，抛这个错，由调用方走失败 / 原图兜底 */
export const COLORFIX_MASK_LOAD_FAILED = '选区蒙版加载失败，未应用校色'
export class ColorFixMaskLoadError extends Error {
  constructor(message = COLORFIX_MASK_LOAD_FAILED) {
    super(message)
    this.name = 'ColorFixMaskLoadError'
  }
}

/** 像素层的数据拿不到（本机缓存被清 / 淘汰）：同样不悄悄少一层，抛这个错（是 ColorFixMaskLoadError，原有的失败兜底照常接住） */
export const COLORFIX_PIXEL_LOAD_FAILED = '像素层数据加载失败，未应用校色'
export class ColorFixPixelLoadError extends ColorFixMaskLoadError {
  constructor() {
    super(COLORFIX_PIXEL_LOAD_FAILED)
    this.name = 'ColorFixPixelLoadError'
  }
}

/** 烘图失败的提示语：蒙版加载失败给专门的一句，其余返回 fallback */
export function colorFixFailureText(err: unknown, fallback: string): string {
  return err instanceof ColorFixMaskLoadError ? err.message : fallback
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

// ---------------- 多图层（2026-11-11，见 components/ColorFix/layers.ts） ----------------

/** 一层的渲染输入：调整 = 替换颜色（可选）→ 五参数；mask 为 null = 整幅 */
export interface ColorFixRenderLayer {
  params: ColorFixParams
  mask: string | null
  invert?: boolean
  feather?: number
  /** 替换为目标颜色；source 为 null = 自动（选区内主色，按原图算） */
  recolor?: { source: string | null; target: string; strength: number } | null
  /** 更多调整（白平衡 + HSL 分色），替换颜色之后、五参数之前；null = 不调 */
  adjust?: ColorFixAdjust | null
  /**
   * 像素层（向下合并的产物）：整幅 RGBA PNG 的地址（A 通道 = 覆盖度），按它直接盖到下面的结果上；有它时 params / mask /
   * recolor / adjust 都不用。full = 原图分辨率；preview = 预览分辨率的副本（没有就用 full）。
   */
  pixel?: { full: string; preview?: string } | null
  /** 向下合并用：把这一层的覆盖范围并进结果的 A 通道（只 {@link colorFixMergeRender} 认） */
  cover?: boolean
}

/** 把蒙版图整理成与输出同尺寸的 alpha 数组（口径同 prepareMask：黑白 / 透明蒙版都认，反选、柔化） */
function readMaskAlpha(
  mask: HTMLImageElement,
  width: number,
  height: number,
  opts: ColorFixMaskOptions,
  place?: MaskPlacement,
): Uint8Array {
  const c = prepareMask(mask, width, height, opts, place)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  const data = ctx.getImageData(0, 0, width, height).data
  c.width = c.height = 0
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]!
  return out
}

const dominantCache = new Map<string, Promise<string | null>>()
const DOMINANT_SIDE = 256
const DOMINANT_CACHE_MAX = 32

/**
 * 选区里的主色（'#rrggbb'），按原图缩到长边 256 算（预览与导出同一个值）；mask 为 null = 整图。
 * 选区为空 / 图读不了像素返回 null。按 原图 + 蒙版 + 反选 缓存。
 */
export function colorFixDominantColor(src: string, mask: string | null, invert = false): Promise<string | null> {
  const key = `${src}|${mask ?? 'none'}|${invert ? 1 : 0}`
  const hit = dominantCache.get(key)
  if (hit) return hit
  const task = (async () => {
    const img = await loadImage(src)
    const scale = Math.min(1, DOMINANT_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    c.width = c.height = 0
    const alpha = mask ? readMaskAlpha(await loadImage(mask), w, h, { invert }) : null
    const lab = dominantLab(data, w, h, alpha)
    if (!lab) return null
    const [r, g, b] = oklabToSrgb8(lab[0], lab[1], lab[2])
    return toHex(r, g, b)
  })().catch(() => null)
  dominantCache.set(key, task)
  while (dominantCache.size > DOMINANT_CACHE_MAX) dominantCache.delete(dominantCache.keys().next().value as string)
  return task
}

const histCache = new Map<string, Promise<ColorFixHistogram | null>>()
const HIST_SIDE = 256

/**
 * 原图（选区内）的直方图（亮度 + R / G / B），按原图缩到长边 256 统计——曲线 / 色阶编辑器的底图。
 * mask 为 null = 整图；选区外（alpha < 50%）不算。读不了像素返回 null。按 原图 + 蒙版 + 反选 缓存 16 份。
 */
export function colorFixHistogram(src: string, mask: string | null, invert = false): Promise<ColorFixHistogram | null> {
  const key = `${src}|${mask ?? 'none'}|${invert ? 1 : 0}`
  const hit = histCache.get(key)
  if (hit) return hit
  const task = (async () => {
    const img = await loadImage(src)
    const scale = Math.min(1, HIST_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    c.width = c.height = 0
    const alpha = mask ? readMaskAlpha(await loadImage(mask), w, h, { invert }) : null
    return computeHistogram(data, alpha)
  })().catch(() => null)
  histCache.set(key, task)
  while (histCache.size > 16) histCache.delete(histCache.keys().next().value as string)
  return task
}

/**
 * 多图层烘图：原图打底，按顺序每层「复制当前结果 → 替换颜色 → 五参数 → 按软蒙版混回当前结果」，最后出无损 PNG
 * （透明通道原样保留）。逐像素在 CPU 上算（每层只算蒙版内像素），与单层 {@link colorFixImage} 同一套公式；
 * 导出尺寸（长边 > 1600）的合成与 PNG 编码下放 Worker（colorfix-offload.ts），不可用时主线程重算，结果逐像素相同。
 * 结果缓存口径同 colorFixImage（预览 LRU ≤8、导出只留 1 张）；任一层蒙版拿不到抛 {@link ColorFixMaskLoadError}。
 */
export async function colorFixLayersImage(
  src: string,
  layers: readonly ColorFixRenderLayer[],
  maxSide = PREVIEW_MAX_SIDE,
): Promise<string> {
  const norm: NormLayer[] = layers.map((l) => ({
    ...l,
    invert: !!l.mask && !!l.invert,
    feather: l.mask ? Math.max(0, Math.min(20, l.feather ?? 0)) : 0,
  }))
  const key =
    `L|${src}|${maxSide}` +
    norm
      .map((l) => {
        const p = l.params
        const rc = l.recolor ? `${l.recolor.source ?? 'auto'}>${l.recolor.target}@${l.recolor.strength}` : ''
        const adj = adjustSignature(l.adjust)
        if (l.pixel) return `|PX:${pixelUrlOf(l, maxSide > PREVIEW_MAX_SIDE)}`
        return `|${l.mask ?? 'none'}|${l.invert ? 'i' : ''}${l.feather}:${p.hue},${p.sat},${p.light},${p.bright},${p.contrast}:${rc}${adj ? `:A${adj}` : ''}`
      })
      .join('')
  const isExport = maxSide > PREVIEW_MAX_SIDE
  const cache = isExport ? exportCache : resultCache
  const hit = cache.get(key)
  if (hit) {
    touch(cache, key, hit)
    return hit
  }
  const img = await loadImage(src).catch((err) => {
    imageCache.delete(src)
    throw err
  })
  const masks = await Promise.all(
    norm.map((l) =>
      l.mask
        ? loadImage(l.mask).catch(() => {
            imageCache.delete(l.mask!)
            throw new ColorFixMaskLoadError()
          })
        : null,
    ),
  )
  const pixelImgs = await loadPixelImages(norm, isExport)
  // 自动源色先算好（按原图，与参数台上显示的那个色块同一个值）
  const sources = await recolorSources(src, norm)
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  ctx.drawImage(img, 0, 0, width, height)
  const alphaOf = norm.map((l, i) => {
    const maskImg = masks[i]
    return () => (maskImg ? readMaskAlpha(maskImg, width, height, { invert: l.invert, feather: l.feather }) : null)
  })
  const pixelsOf = norm.map((_, i) => {
    const pimg = pixelImgs[i]
    return pimg ? () => readPixelFrame(pimg, width, height) : null
  })
  let out = ''
  // 导出尺寸：逐像素合成与 PNG 编码下放 Worker（同一套公式，结果逐像素相同）；Worker 不可用 / 崩了退回主线程重算
  if (isExport && offloadAvailable()) {
    try {
      const r = await compositeInWorker(ctx.getImageData(0, 0, width, height).data, width, height, offloadLayers(norm, alphaOf, sources, pixelsOf), {
        exact: true,
        encode: true,
      })
      if (r.blob) out = await blobToDataUrl(r.blob)
      else if (r.buffer) {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buffer), width, height), 0, 0)
        out = canvas.toDataURL('image/png')
      }
    } catch (err) {
      if (!(err instanceof OffloadUnavailable)) {
        canvas.width = canvas.height = 0
        throw err
      }
    }
  }
  if (!out) {
    const frame = ctx.getImageData(0, 0, width, height)
    compositeLayers(frame.data, norm, alphaOf, sources, pixelsOf, isExport)
    ctx.putImageData(frame, 0, 0)
    out = canvas.toDataURL('image/png')
  }
  canvas.width = canvas.height = 0
  cache.set(key, out)
  evictStrings(cache, isExport ? EXPORT_CACHE_MAX : RESULT_CACHE_MAX)
  return out
}

type NormLayer = ColorFixRenderLayer & { invert: boolean; feather: number }

/**
 * 逐层合成（就地改 running，主线程）：复制 → 替换颜色 → 更多调整（白平衡 → HSL → 色阶 → 曲线）→ 五参数 → 按 alpha 混回；
 * exact = 白平衡 / HSL 逐像素精算（导出）。公式在 colorfix-math compositeOneLayer，与 Worker 共用。
 */
function compositeLayers(
  running: Uint8ClampedArray,
  layers: readonly NormLayer[],
  alphaOf: readonly (() => Uint8Array | null)[],
  sources: readonly (Lab | null)[],
  pixelsOf: readonly ((() => Uint8ClampedArray) | null)[],
  exact = false,
) {
  const adjusted = new Uint8ClampedArray(running.length)
  layers.forEach((l, i) => compositeStep(running, adjusted, stepOf(l, alphaOf[i]!, sources[i] ?? null, pixelsOf[i] ?? null), exact))
}

/** 一层 → 合成的一步（像素层给整幅像素，调整层给 alpha 与替换颜色源色） */
function stepOf(
  l: NormLayer,
  alpha: () => Uint8Array | null,
  source: Lab | null,
  pixels: (() => Uint8ClampedArray) | null,
): CompositeStep {
  if (pixels) return { kind: 'pixel', pixels: pixels() }
  return { kind: 'adjust', spec: { params: l.params, recolor: l.recolor, adjust: l.adjust }, alpha: alpha(), source }
}

function offloadLayers(
  layers: readonly NormLayer[],
  alphaOf: readonly (() => Uint8Array | null)[],
  sources: readonly (Lab | null)[],
  pixelsOf: readonly ((() => Uint8ClampedArray) | null)[],
) {
  return layers.map((l, i) => ({
    spec: { params: { ...l.params }, recolor: l.recolor ? { ...l.recolor } : null, adjust: l.adjust ?? null },
    alpha: alphaOf[i]!,
    source: sources[i] ?? null,
    pixels: pixelsOf[i] ?? undefined,
    cover: !!l.cover,
  }))
}

/** 像素层这次渲染该用哪张图：导出 / 局部高清用原图分辨率，预览用预览副本（没有就原图） */
function pixelUrlOf(l: Pick<ColorFixRenderLayer, 'pixel'>, full: boolean): string | null {
  return l.pixel ? (full ? l.pixel.full : l.pixel.preview || l.pixel.full) : null
}

async function loadPixelImages(layers: readonly NormLayer[], full: boolean): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(
    layers.map((l) => {
      const url = pixelUrlOf(l, full)
      return url
        ? loadImage(url).catch(() => {
            imageCache.delete(url)
            throw new ColorFixPixelLoadError()
          })
        : null
    }),
  )
}

/** 把像素层的图读成输出尺寸的 RGBA（place = 局部渲染时输出只是整幅里的一块）；与原图同分辨率时是 1:1 取像素，不重采样 */
function readPixelFrame(
  img: HTMLImageElement,
  width: number,
  height: number,
  place?: { x: number; y: number; fullW: number; fullH: number },
): Uint8ClampedArray {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  if (place) ctx.drawImage(img, -place.x, -place.y, place.fullW, place.fullH)
  else ctx.drawImage(img, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  c.width = c.height = 0
  return data
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('读取失败'))
    r.readAsDataURL(blob)
  })
}

/** 各层「替换颜色」的源色（OKLab）：自动 = 选区主色（按原图算，与参数台色块同一个值） */
function recolorSources(src: string, layers: readonly NormLayer[]): Promise<(Lab | null)[]> {
  return Promise.all(
    layers.map(async (l) => {
      if (!l.recolor || l.recolor.strength <= 0) return null
      const hex = l.recolor.source ?? (await colorFixDominantColor(src, l.mask, l.invert))
      const rgb = parseHex(hex)
      return rgb ? srgb8ToOklab(rgb[0], rgb[1], rgb[2]) : null
    }),
  )
}

/** 蒙版整体是否不透明（按整幅缩到 256 判断；局部渲染时一块区域判不准，见 MaskPlacement） */
function maskOpaque(mask: HTMLImageElement): boolean {
  const s = Math.min(1, 256 / Math.max(mask.naturalWidth || 1, mask.naturalHeight || 1))
  const w = Math.max(1, Math.round((mask.naturalWidth || 1) * s))
  const h = Math.max(1, Math.round((mask.naturalHeight || 1) * s))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return true
  ctx.drawImage(mask, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  c.width = c.height = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return false
  return true
}

/** 局部渲染的结果：PNG 的 objectURL + 它实际覆盖的区域（原图像素；按输出像素取整后的，可能比请求的略大） */
export interface ColorFixCropResult {
  url: string
  x: number
  y: number
  w: number
  h: number
}

/** 局部渲染的结果缓存（objectURL，最近 6 块） */
const cropCache = new Map<string, Promise<ColorFixCropResult>>()
const CROP_CACHE_MAX = 6

/**
 * 局部高清渲染（全屏放大到超过预览图分辨率时用）：只渲整幅输出（原图 × scale）里 crop 这一块（原图像素坐标），
 * 逐层口径与 {@link colorFixLayersImage} 相同（替换颜色 → 更多调整 → 五参数 → 软蒙版合成）；蒙版柔化按整幅尺寸算，
 * 边缘向外多取 3 倍柔化半径再裁回，接缝处与整幅渲染一致。返回 PNG 的 objectURL 与它实际覆盖的区域（原图像素；
 * 叠放时按这个区域摆，不按请求的 crop——输出像素取整会让两者差不到一个输出像素）。按 原图 + 图层 + 区域 缓存 6 块，
 * 淘汰时回收。蒙版拿不到抛 {@link ColorFixMaskLoadError}。
 */
export function colorFixRenderCrop(
  src: string,
  layers: readonly ColorFixRenderLayer[],
  crop: { x: number; y: number; w: number; h: number },
  scale = 1,
): Promise<ColorFixCropResult> {
  const norm: NormLayer[] = layers.map((l) => ({
    ...l,
    invert: !!l.mask && !!l.invert,
    feather: l.mask ? Math.max(0, Math.min(20, l.feather ?? 0)) : 0,
  }))
  const key =
    `C|${src}|${scale.toFixed(4)}|${Math.round(crop.x)},${Math.round(crop.y)},${Math.round(crop.w)},${Math.round(crop.h)}` +
    norm
      .map((l) => {
        const p = l.params
        const rc = l.recolor ? `${l.recolor.source ?? 'auto'}>${l.recolor.target}@${l.recolor.strength}` : ''
        if (l.pixel) return `|PX:${l.pixel.full}`
        return `|${l.mask ?? 'none'}|${l.invert ? 'i' : ''}${l.feather}:${p.hue},${p.sat},${p.light},${p.bright},${p.contrast}:${rc}:${adjustSignature(l.adjust)}`
      })
      .join('')
  const hit = cropCache.get(key)
  if (hit) {
    touch(cropCache, key, hit)
    return hit
  }
  const task = (async () => {
    const img = await loadImage(src)
    const fullW = Math.max(1, Math.round(img.naturalWidth * scale))
    const fullH = Math.max(1, Math.round(img.naturalHeight * scale))
    const cx = Math.max(0, Math.min(fullW - 1, Math.floor(crop.x * scale)))
    const cy = Math.max(0, Math.min(fullH - 1, Math.floor(crop.y * scale)))
    const cw = Math.max(1, Math.min(fullW - cx, Math.ceil((crop.x + crop.w) * scale) - cx))
    const ch = Math.max(1, Math.min(fullH - cy, Math.ceil((crop.y + crop.h) * scale) - cy))
    const masks = await Promise.all(
      norm.map((l) =>
        l.mask
          ? loadImage(l.mask).catch(() => {
              imageCache.delete(l.mask!)
              throw new ColorFixMaskLoadError()
            })
          : null,
      ),
    )
    const pixelImgs = await loadPixelImages(norm, true)
    const sources = await recolorSources(src, norm)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('画布不可用')
    ctx.drawImage(img, -cx, -cy, fullW, fullH)
    const alphaOf = norm.map((l, i) => () => {
        const maskImg = masks[i]
        if (!maskImg) return null
        const blur = l.feather > 0 ? (l.feather * Math.max(fullW, fullH)) / 1000 : 0
        const pad = Math.ceil(blur * 3) + 2
        const rx = Math.max(0, cx - pad)
        const ry = Math.max(0, cy - pad)
        const rw = Math.min(fullW, cx + cw + pad) - rx
        const rh = Math.min(fullH, cy + ch + pad) - ry
        const big = readMaskAlpha(maskImg, rw, rh, { invert: l.invert, feather: l.feather }, {
          x: rx,
          y: ry,
          fullW,
          fullH,
          opaque: maskOpaque(maskImg),
        })
        const out = new Uint8Array(cw * ch)
        for (let y = 0; y < ch; y++) {
          const from = (y + cy - ry) * rw + (cx - rx)
          out.set(big.subarray(from, from + cw), y * cw)
        }
        return out
      })
    const pixelsOf = norm.map((_, i) => {
      const pimg = pixelImgs[i]
      return pimg ? () => readPixelFrame(pimg, cw, ch, { x: cx, y: cy, fullW, fullH }) : null
    })
    let blob: Blob | null = null
    // 局部高清下放 Worker（精算，与导出同口径）；不可用退回主线程（查找表，与预览同口径）
    if (offloadAvailable()) {
      try {
        const r = await compositeInWorker(ctx.getImageData(0, 0, cw, ch).data, cw, ch, offloadLayers(norm, alphaOf, sources, pixelsOf), {
          exact: true,
          encode: true,
        })
        if (r.blob) blob = r.blob
        else if (r.buffer) {
          ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buffer), cw, ch), 0, 0)
          blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        }
      } catch (err) {
        if (!(err instanceof OffloadUnavailable)) {
          canvas.width = canvas.height = 0
          throw err
        }
      }
    }
    if (!blob) {
      const frame = ctx.getImageData(0, 0, cw, ch)
      compositeLayers(frame.data, norm, alphaOf, sources, pixelsOf)
      ctx.putImageData(frame, 0, 0)
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    }
    canvas.width = canvas.height = 0
    if (!blob) throw new Error('局部渲染失败')
    // 输出像素 → 原图像素（整幅输出取整过，按实际比例换算）
    const kx = img.naturalWidth / fullW
    const ky = img.naturalHeight / fullH
    return { url: URL.createObjectURL(blob), x: cx * kx, y: cy * ky, w: cw * kx, h: ch * ky }
  })()
  cropCache.set(key, task)
  task.catch(() => cropCache.delete(key))
  while (cropCache.size > CROP_CACHE_MAX) {
    const oldest = cropCache.keys().next().value as string
    const old = cropCache.get(oldest)
    cropCache.delete(oldest)
    // 延迟回收：界面可能还挂着这一块，等新块顶上来
    void old?.then((r) => setTimeout(() => URL.revokeObjectURL(r.url), 30_000)).catch(() => {})
  }
  return task
}

// ---------------- 向下合并（2026-11-11，见 components/ColorFix/layers.ts mergeDownBlocked） ----------------

/** 合并在原图分辨率上做：长边 / 总像素超过这两个上限就拒绝（Worker 里要同时放帧 + 工作缓冲 + 覆盖度，4 字节 × 2 + 1 字节 / 像素） */
export const COLORFIX_MERGE_MAX_SIDE = 8192
export const COLORFIX_MERGE_MAX_PIXELS = 40_000_000
export const COLORFIX_MERGE_TOO_LARGE = '图片太大，无法合并'

/** 原图超出合并上限（或浏览器分配不出这么大的画布） */
export class ColorFixMergeTooLargeError extends Error {
  constructor() {
    super(COLORFIX_MERGE_TOO_LARGE)
    this.name = 'ColorFixMergeTooLargeError'
  }
}

/** 向下合并的产物：原图分辨率的像素层 PNG（A 通道 = 覆盖度 0 / 255）+ 预览分辨率的副本（原图不大于预览尺寸时没有，用原图那份） */
export interface ColorFixMergeResult {
  full: Blob
  preview: Blob | null
  width: number
  height: number
}

/** Blob → 缩到长边 ≤ maxSide 的 PNG Blob（不用缩 / 浏览器不支持返回 null） */
async function downscaleBlob(blob: Blob, w: number, h: number, maxSide: number): Promise<Blob | null> {
  const scale = maxSide / Math.max(w, h)
  if (scale >= 1 || typeof createImageBitmap !== 'function') return null
  const bitmap = await createImageBitmap(blob)
  try {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * scale))
    c.height = Math.max(1, Math.round(h * scale))
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, c.width, c.height)
    const out = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
    c.width = c.height = 0
    return out
  } finally {
    bitmap.close()
  }
}

/**
 * 向下合并的渲染：按「导出口径」（逐像素精算）在原图分辨率上自下而上合成 layers（调用方只传可见且会改图的那些，到被合并的上层为止），
 * 标了 cover 的层（被合并的两层）的覆盖范围并起来写进结果的 A 通道：覆盖度 255 = 这两层碰过的像素（蒙版 alpha > 0），0 = 没碰过。
 * 覆盖度取二值而不是软并集：软边处下层结果已经混过一次，再按软并集盖回去会混第二次，合并前后就不一样了；
 * 二值覆盖 + 结果像素 = 合并前这一点的最终颜色，盖回去逐位等于合并前（没碰过的点结果就等于下面的层，所以 A=0 处不丢信息）。
 *
 * Worker 可用时合成与 PNG 编码都在 Worker（主线程只取帧、整理蒙版 alpha），不可用时主线程重算，结果逐像素相同。
 * 超过 {@link COLORFIX_MERGE_MAX_SIDE} / {@link COLORFIX_MERGE_MAX_PIXELS} 抛 {@link ColorFixMergeTooLargeError}；
 * 蒙版 / 像素层拿不到抛 {@link ColorFixMaskLoadError}。
 */
export async function colorFixMergeRender(src: string, layers: readonly ColorFixRenderLayer[]): Promise<ColorFixMergeResult> {
  const norm: NormLayer[] = layers.map((l) => ({
    ...l,
    invert: !!l.mask && !!l.invert,
    feather: l.mask ? Math.max(0, Math.min(20, l.feather ?? 0)) : 0,
  }))
  const img = await loadImage(src).catch((err) => {
    imageCache.delete(src)
    throw err
  })
  const width = Math.max(1, img.naturalWidth)
  const height = Math.max(1, img.naturalHeight)
  if (width > COLORFIX_MERGE_MAX_SIDE || height > COLORFIX_MERGE_MAX_SIDE || width * height > COLORFIX_MERGE_MAX_PIXELS)
    throw new ColorFixMergeTooLargeError()
  const masks = await Promise.all(
    norm.map((l) =>
      l.mask
        ? loadImage(l.mask).catch(() => {
            imageCache.delete(l.mask!)
            throw new ColorFixMaskLoadError()
          })
        : null,
    ),
  )
  const pixelImgs = await loadPixelImages(norm, true)
  const sources = await recolorSources(src, norm)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ColorFixMergeTooLargeError()
  ctx.drawImage(img, 0, 0, width, height)
  const alphaOf = norm.map((l, i) => {
    const maskImg = masks[i]
    return () => (maskImg ? readMaskAlpha(maskImg, width, height, { invert: l.invert, feather: l.feather }) : null)
  })
  const pixelsOf = norm.map((_, i) => {
    const pimg = pixelImgs[i]
    return pimg ? () => readPixelFrame(pimg, width, height) : null
  })
  let full: Blob | null = null
  if (offloadAvailable()) {
    try {
      const r = await compositeInWorker(
        ctx.getImageData(0, 0, width, height).data,
        width,
        height,
        offloadLayers(norm, alphaOf, sources, pixelsOf),
        { exact: true, encode: true, cover: true },
      )
      if (r.blob) full = r.blob
      else if (r.buffer) {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buffer), width, height), 0, 0)
        full = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      }
    } catch (err) {
      if (!(err instanceof OffloadUnavailable)) {
        canvas.width = canvas.height = 0
        throw err
      }
    }
  }
  if (!full) {
    const frame = ctx.getImageData(0, 0, width, height)
    const adjusted = new Uint8ClampedArray(frame.data.length)
    const cover = new Uint8Array(width * height)
    norm.forEach((l, i) => {
      const step = stepOf(l, alphaOf[i]!, sources[i] ?? null, pixelsOf[i] ?? null)
      compositeStep(frame.data, adjusted, step, true)
      if (l.cover) coverUnion(cover, step)
    })
    writeCover(frame.data, cover)
    ctx.putImageData(frame, 0, 0)
    full = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  }
  canvas.width = canvas.height = 0
  if (!full) throw new Error('合并失败')
  const preview = await downscaleBlob(full, width, height, PREVIEW_MAX_SIDE).catch(() => null)
  return { full, preview, width, height }
}

/**
 * 按图层烘图的统一入口：空 → 原图（零参数）；单层且无替换颜色 / 更多调整 → {@link colorFixImage}（与旧版单选区逐像素一致）；
 * 其余 → {@link colorFixLayersImage}。
 */
export function colorFixRenderLayers(
  src: string,
  layers: readonly ColorFixRenderLayer[],
  maxSide = PREVIEW_MAX_SIDE,
): Promise<string> {
  if (!layers.length) return colorFixImage(src, { hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 }, null, maxSide)
  const only = layers[0]!
  if (layers.length === 1 && !only.recolor && !only.adjust && !only.pixel)
    return colorFixImage(src, { ...only.params }, only.mask, maxSide, { invert: only.invert, feather: only.feather })
  return colorFixLayersImage(src, layers, maxSide)
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
    if (
      typeof value.hue !== 'number' ||
      typeof value.sat !== 'number' ||
      typeof value.light !== 'number' ||
      typeof value.bright !== 'number' ||
      typeof value.contrast !== 'number'
    )
      return null
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
