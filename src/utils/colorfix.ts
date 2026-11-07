/**
 * 结果图校色（2026-11-06 交付包「阶段 1 校色闭环」，整图 v1）。
 *
 * <p>五参数与校色包 API 一致：色相 / 饱和度 / 明度 / 亮度 / 对比度。默认值取校色包在图四
 * 给出的那组真实参数（ hue 3 / sat −16 / light −6 / bright −17 / contrast 10）。
 *
 * <p>整图校色：滤镜烘进像素（下载 / 前后对比 / 存资产都要真图，不能只挂 CSS filter）。
 * 逐件蒙版（只调服装不调背景）需要服务端分割（SAM3）随结果返回 maskUrl，接口参数已预留
 * `maskUrl`——有蒙版时按软边 alpha 只合成蒙版内像素，没有时整图校色，合成逻辑两种共用。
 * 输出一律无损 PNG：承诺「蒙版外一个像素不动」时 JPEG 的有损压缩不成立。
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

export const COLORFIX_RANGES: Record<keyof ColorFixParams, { min: number; max: number }> = {
  hue: { min: -30, max: 30 },
  sat: { min: -60, max: 70 },
  light: { min: -40, max: 40 },
  bright: { min: -80, max: 80 },
  contrast: { min: -50, max: 50 },
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

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const resultCache = new Map<string, string>()

function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(src)
  if (hit) return hit
  const task = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
  imageCache.set(src, task)
  return task
}

/**
 * 把五参数烘成一张 PNG dataURL。
 * - 有 maskUrl：原图打底，校色层按蒙版 alpha 合成（逐件校色，蒙版外不动）；
 * - 无 maskUrl：整图校色。
 * 结果缓存 ≤12（超过整表清掉，避免长会话内存增长）。
 */
export async function colorFixImage(src: string, p: ColorFixParams, maskUrl?: string | null): Promise<string> {
  const key = `${src}|${maskUrl ?? 'none'}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}`
  const hit = resultCache.get(key)
  if (hit) return hit

  const img = await loadImage(src)
  const mask = maskUrl ? await loadImage(maskUrl).catch(() => null) : null
  const max = 1600
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布不可用')

  if (!mask) {
    ctx.filter = colorFixFilter(p)
    ctx.drawImage(img, 0, 0, width, height)
  } else {
    // 1) 先烘一张校色层；2) 按蒙版 alpha 裁掉蒙版外的校色像素（软边保留）；3) 原图打底盖上去
    const corrected = document.createElement('canvas')
    corrected.width = width
    corrected.height = height
    const cctx = corrected.getContext('2d')
    if (!cctx) throw new Error('画布不可用')
    cctx.filter = colorFixFilter(p)
    cctx.drawImage(img, 0, 0, width, height)
    cctx.filter = 'none'
    cctx.globalCompositeOperation = 'destination-in'
    cctx.drawImage(mask, 0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    ctx.drawImage(corrected, 0, 0)
  }

  const out = canvas.toDataURL('image/png')
  if (resultCache.size > 12) resultCache.clear()
  resultCache.set(key, out)
  return out
}

/** dataURL PNG → File（存资产走 goUploadImage 的文件口） */
export function colorFixDataUrlToFile(dataUrl: string, name = 'colorfix.png'): File {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new File([buf], name, { type: 'image/png' })
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
