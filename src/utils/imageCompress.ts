/**
 * 上传前的图片压缩：只做「有损重编码」降体积，**不改变像素尺寸**。
 * 尺寸是 AI 生成任务的输入依据（比例/分辨率），缩放会影响生成结果，因此这里
 * canvas 严格按原始宽高绘制，只调低编码质量。
 *
 * 格式策略：JPEG 仍输出 JPEG；PNG / BMP / WebP 统一输出 WebP —— canvas 输出 PNG 是
 * 无损的（quality 参数被忽略），只有换成有损格式才能真正减小体积，而 WebP 相比 JPEG
 * 能保留透明通道。
 *
 * 一切异常（解码失败、canvas 被浏览器限制、编码返回空）都退回原文件，
 * 压缩失败绝不能让上传失败。
 */

/** 小于该体积的图不折腾，压缩收益抵不上编解码开销 */
const MIN_COMPRESS_SIZE = 1024 * 1024

/** 有损编码质量 */
const QUALITY = 0.85

/**
 * canvas 像素总数上限。Safari 对单个 canvas 的面积限制约 16.7M px(4096×4096)，
 * 超出后 drawImage 得到的是空白图，压出来会是一张全白的图，因此直接跳过压缩。
 */
const MAX_CANVAS_PIXELS = 16_777_216

/** 压缩后体积没降到原图 95% 以下就没必要改格式，直接用原文件 */
const MIN_GAIN_RATIO = 0.95

/** 重绘会破坏内容的格式：GIF 只剩首帧，SVG 会被栅格化 */
const SKIP_TYPES = ['image/gif', 'image/svg+xml']

const MIME_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
}

let webpEncodable: boolean | undefined

/** 浏览器 canvas 能否编码 WebP（Safari 14 以下不能），结果缓存 */
function canEncodeWebp(): boolean {
  if (webpEncodable === undefined) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      webpEncodable = canvas.toDataURL('image/webp').startsWith('data:image/webp')
    } catch {
      webpEncodable = false
    }
  }
  return webpEncodable
}

/**
 * 决定输出格式：JPEG 保持 JPEG，其余走 WebP。
 * 不支持 WebP 编码时返回空 —— 此时宁可原样上传，也不把 PNG 的透明底压成白底。
 */
function pickTargetType(file: File): string | null {
  if (file.type === 'image/jpeg') return 'image/jpeg'
  return canEncodeWebp() ? 'image/webp' : null
}

/** 把文件名扩展名换成新格式的扩展名，保证 OSS objectKey 与实际内容一致 */
function renameExt(name: string, mime: string): string {
  const ext = MIME_EXT[mime]
  if (!ext) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base}.${ext}`
}

/**
 * 解码图片。优先 createImageBitmap 并指定 imageOrientation: 'from-image'：
 * 手机竖拍 JPEG 的方向存在 EXIF 里，重编码后 EXIF 会丢失，若解码时不按 EXIF 摆正，
 * 上传后的图就会「躺倒」。
 */
async function decode(file: File): Promise<{
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  } catch {
    // createImageBitmap 不可用或不认识该格式时回退到 <img>（浏览器同样会应用 EXIF 方向）
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('image decode failed'))
        el.src = url
      })
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      }
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
  }
}

/** 按原始宽高绘制并编码，返回 Blob；编码失败返回 null */
async function encode(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(source, 0, 0)
    return await canvas.convertToBlob({ type, quality })
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0)
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

/**
 * 覆盖默认策略的可选项。业务侧不需要传，仅在需要调参对比不同档位时使用。
 */
export interface CompressOptions {
  /** 有损编码质量，默认 0.85 */
  quality?: number
  /** 小于该体积不压缩，默认 1MB */
  minSize?: number
  /** 强制输出格式，默认按源格式自动选择（JPEG→JPEG，其余→WebP） */
  targetType?: string
}

/** 压缩单个文件，不满足条件或出现任何异常时返回原文件 */
export async function compressImage(file: File, options?: CompressOptions): Promise<File> {
  const quality = options?.quality ?? QUALITY
  const minSize = options?.minSize ?? MIN_COMPRESS_SIZE

  if (!file.type.startsWith('image/')) return file
  if (SKIP_TYPES.includes(file.type)) return file
  if (file.size <= minSize) return file

  const targetType = options?.targetType ?? pickTargetType(file)
  if (!targetType) return file

  let release: (() => void) | undefined
  try {
    const decoded = await decode(file)
    release = decoded.release
    const { source, width, height } = decoded
    if (!width || !height) return file
    // 超大图 canvas 会画出空白，压出来是一张废图，直接原样上传
    if (width * height > MAX_CANVAS_PIXELS) return file

    const blob = await encode(source, width, height, targetType, quality)
    if (!blob || blob.size >= file.size * MIN_GAIN_RATIO) return file

    return new File([blob], renameExt(file.name, targetType), {
      type: targetType,
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    release?.()
  }
}

/**
 * 批量压缩。串行执行：几张大图同时解码会让内存峰值翻倍，
 * 而上传本身才是耗时大头，串行带来的额外等待可以接受。
 */
export async function compressImages(files: File[], options?: CompressOptions): Promise<File[]> {
  const result: File[] = []
  for (const file of files) {
    result.push(await compressImage(file, options))
  }
  return result
}
