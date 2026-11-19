/**
 * 图片下载工具：解决跨域 OSS 图片直接用 <a href> 会在页面打开而非下载的问题。
 * 单图：fetch→blob→<a download>，抓取失败时裸链打开由用户手动另存。
 * 整组：打包成一个 ZIP 后触发下载，用户只需在「另存为」里选一次位置；
 * 抓取失败则降级为逐张下载。
 *
 * 不要改用 File System Access 的 showDirectoryPicker（选文件夹后逐张写入）：
 * 试过，它要求安全上下文（http + 内网 IP 直接不可用），且受浏览器目录黑名单和
 * macOS 系统权限限制，实测桌面/下载目录都可能被拒。ZIP 走的是浏览器原生下载栈，
 * 无这些限制，是唯一能在所有环境「只选一次位置」的方案。
 */
import JSZip from 'jszip'
import { createDiscreteApi } from 'naive-ui'
import { discreteConfigProviderProps } from '@/theme/naive'

/**
 * 取一组任务里可下载的 URL（仅生成成功 status===2 且有 resultUrl 的）。
 *
 * ⚠️ 必须取 resultUrl，不能取 watermarkUrl。
 * 后端下发两个字段：watermarkUrl 是【展示用】（有水印版则为水印版，否则与 resultUrl 同值），
 * resultUrl 才是原件。改成 watermarkUrl 的话，视频水印一开启用户下到的就是带水印的文件，
 * 而且因为关闭时两者同值，本地关着开关测不出问题——线上开了才炸。
 */
export function getDownloadableUrls(item: any): string[] {
  return (item?.contents ?? [])
    .filter((c: any) => c?.resultUrl && c?.status === 2)
    .map((c: any) => c.resultUrl as string)
}

/** 从 URL 推断文件扩展名，无法识别时默认 jpg */
export function extFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url)
    const ext = pathname.match(/\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|m4v)$/i)?.[1]
    return ext ? ext.toLowerCase() : 'jpg'
  } catch {
    return 'jpg'
  }
}

/**
 * 注意：不要再用 response-content-disposition 做「服务端强制下载」兜底。
 * 素材 bucket 是公共读、匿名访问，OSS 对匿名请求禁止覆盖响应头，
 * 加了该参数会直接返回 InvalidRequest 错误 XML（0017-00000901）而不是文件。
 * 因此所有下载一律走 fetch→blob，抓不到时只能裸链打开让用户手动另存。
 */

/**
 * 通过隐藏 <a> 触发一次下载。
 * newTab：跨域裸链兜底时置 true —— 跨域 a.download 会被浏览器忽略，不加 target 会把
 * 当前页导航走（智能体会话、表单草稿全丢），所以一律新开标签页（noopener）展示让用户另存。
 */
function triggerAnchorDownload(href: string, filename?: string, newTab = false) {
  const a = document.createElement('a')
  a.href = href
  if (filename) a.download = filename
  if (newTab) {
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  }
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * 下载单张图片：fetch→blob→<a download>，可控文件名且强制下载。
 * 抓取失败（OSS 未开 CORS / 网络异常）时只能裸链打开，由用户手动另存 ——
 * 不能再拼 response-content-disposition，见上方说明。
 */
export async function downloadImage(url: string, filename?: string, opts?: { strict?: boolean }): Promise<void> {
  if (!url) return
  const name = filename || `AI素材_${Date.now()}.${extFromUrl(url)}`
  try {
    // 下载走【原图】：水印只加在展示上，下载给无水印原件。
    // 拼 x-oss-process 会让 OSS 返回带水印的变体，用户拿到的文件就洗不掉了。
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const objectUrl = URL.createObjectURL(await res.blob())
    triggerAnchorDownload(objectUrl, name)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  } catch (err) {
    // strict（批量下载）：连续新开标签页会被拦截，抓取失败原样抛给调用方计数
    if (opts?.strict) throw err
    // 跨域时 a.download 会被忽略，退化为新开标签页展示，用户可右键另存（绝不在当前页导航）
    triggerAnchorDownload(url, name, true)
  }
}

/** 逐张下载（整组兜底方案）：复用单图下载，间隔触发避免被浏览器拦截 */
async function downloadImagesSequentially(urls: string[], prefix: string): Promise<void> {
  let i = 0
  for (const url of urls) {
    i += 1
    await downloadImage(url, `${prefix}_${i}.${extFromUrl(url)}`)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

/** 按当前时刻生成压缩包名：AI素材_2026-08-20_14-30-25。无任务时间可依据时用，避免多次下载重名 */
export function zipNameByNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return `AI素材_${date}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/**
 * 整组素材的 ZIP 文件名：按任务时间区分，清洗掉文件名非法字符。
 * createTime 是创作历史的字段，taskTime 是资产分组的字段；都缺时退回当前时刻。
 */
export function zipNameOf(item: any): string {
  const t = String(item?.createTime ?? item?.taskTime ?? '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return t ? `AI素材_${t}` : zipNameByNow()
}

/**
 * 整组下载：优先把多张图片打包成一个 ZIP。
 * 任一图片跨域抓取失败（OSS 未开 CORS 等）→ 整体降级为逐张下载，保证始终能下。
 * 只有一张时直接下载单图，不打包。
 * zipName 默认按调用时刻生成（默认参数每次调用才求值），漏传也不会重名互相覆盖。
 */
export async function downloadImagesAsZip(urls: string[], zipName = zipNameByNow()): Promise<void> {
  const list = urls.filter(Boolean)
  if (!list.length) return
  if (list.length === 1) {
    const only = list[0]
    if (only) await downloadImage(only, `${zipName}.${extFromUrl(only)}`)
    return
  }
  try {
    const files = await Promise.all(
      list.map(async (url) => {
        // 同 downloadImage：打包下载同样给无水印原图
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { blob: await res.blob(), ext: extFromUrl(url) }
      }),
    )
    const zip = new JSZip()
    files.forEach((file, i) => {
      zip.file(`${zipName}_${i + 1}.${file.ext}`, file.blob)
    })
    const content = await zip.generateAsync({ type: 'blob' })
    const objectUrl = URL.createObjectURL(content)
    triggerAnchorDownload(objectUrl, `${zipName}.zip`)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  } catch {
    await downloadImagesSequentially(list, zipName)
  }
}


// ---------------- 另存为 JPG ----------------

/** 不是静态位图的扩展名（视频 / 动图 / 矢量）：不提供「另存为 JPG」 */
const NON_JPG_CONVERTIBLE = /\.(mp4|mov|webm|m4v|gif|svg)$/i

/** 这个地址能否提供「另存为 JPG」：只认静态图片，视频 / 动图 / SVG 不出入口 */
export function canSaveAsJpg(url?: string | null): boolean {
  if (!url) return false
  try {
    return !NON_JPG_CONVERTIBLE.test(new URL(url, 'http://x').pathname)
  } catch {
    return false
  }
}

/** 文件名去掉已有扩展名并补 .jpg；空名 / 只有扩展名时给默认名 */
export function jpgFileName(filename: string | undefined, fallbackBase = `AI素材_${Date.now()}`): string {
  const base = (filename ?? '').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
  return `${base || fallbackBase}.jpg`
}

/** 解码后画布像素上限：各浏览器单画布约 1.6 亿像素（Safari 更低），取保守值，超出则等比缩小（绝不放大） */
const MAX_CANVAS_PIXELS = 100_000_000
const MAX_CANVAS_SIDE = 16384

/** 解码为位图：优先 createImageBitmap，失败（格式 / 环境不支持）退回 <img> + objectURL */
async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob)
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    } catch {
      // 落到 Image 兜底
    }
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = objectUrl
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(objectUrl) }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

/**
 * 把图片 Blob 转成 JPEG Blob。已是 JPEG 原样返回（不重新压缩，避免二次画质损失）。
 * 透明区域先铺 background（默认白）再绘制，否则 JPEG 无 alpha 会变黑。
 * 过大的图等比缩小到画布上限内；解码 / 画布失败抛错，由调用方提示。
 */
export async function convertBlobToJpg(blob: Blob, opts: { quality?: number; background?: string } = {}): Promise<Blob> {
  if (blob.type === 'image/jpeg') return blob
  const { quality = 0.92, background = '#ffffff' } = opts
  const dec = await decodeImage(blob)
  try {
    let { width, height } = dec
    if (!width || !height) throw new Error('empty image')
    const k = Math.min(1, MAX_CANVAS_SIDE / Math.max(width, height), Math.sqrt(MAX_CANVAS_PIXELS / (width * height)))
    if (k < 1) {
      width = Math.max(1, Math.floor(width * k))
      height = Math.max(1, Math.floor(height * k))
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(dec.source, 0, 0, width, height)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!out) throw new Error('toBlob failed')
    return out
  } finally {
    dec.release()
  }
}

/** 提示用的 message：懒创建一次复用（每次调用都 createDiscreteApi 会反复挂载新的提示容器） */
let discreteMessage: ReturnType<typeof createDiscreteApi>['message'] | null = null
function toast() {
  discreteMessage ??= createDiscreteApi(['message'], { configProviderProps: discreteConfigProviderProps }).message
  return discreteMessage
}

type SaveHandle = { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>; remove?: () => Promise<void> }

/**
 * 原生「另存为」：必须在点击后的用户激活窗口内（约 5 秒）调起，所以在抓图 / 转换之前先拿文件句柄。
 * 返回 null = 浏览器不支持或调起失败（退回普通下载）；'cancel' = 用户取消。
 */
async function pickSaveHandle(name: string): Promise<SaveHandle | null | 'cancel'> {
  const picker = (window as any).showSaveFilePicker as undefined | ((o: any) => Promise<SaveHandle>)
  if (!picker) return null
  try {
    return await picker({
      suggestedName: name,
      types: [{ description: 'JPEG 图片', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }],
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancel'
    return null // 非安全上下文 / 被策略拒绝等：退回普通下载，别让用户拿不到图
  }
}

/** 写入失败或转换失败时删掉刚建的空文件（remove 是较新的 API，没有就算了） */
async function discardHandle(handle: SaveHandle | null): Promise<void> {
  try {
    await handle?.remove?.()
  } catch {
    // 删不掉就留着空文件，提示里已说明失败
  }
}

function anchorSave(blob: Blob, name: string) {
  const objectUrl = URL.createObjectURL(blob)
  triggerAnchorDownload(objectUrl, name)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}

/**
 * 另存为 JPG：先调起原生「另存为」拿到保存位置（保住用户激活）→ 抓【原图】→ 转 JPEG（透明变白底）→ 写入；
 * 浏览器不支持另存为时走普通下载。与 downloadImage 同一条规则：只取原图，绝不拼 x-oss-process 水印变体。
 * 抓取失败（多为 OSS 未开 CORS）：提示并按原图新开标签页，用户可右键另存；
 * 解码 / 画布失败（图过大、格式不支持）：明确报错，不静默；两种失败都删掉刚建的空文件。
 */
export async function saveImageAsJpg(
  url: string,
  filename?: string,
  opts: { quality?: number; background?: string } = {},
): Promise<void> {
  if (!url) return
  const name = jpgFileName(filename)
  const picked = await pickSaveHandle(name)
  if (picked === 'cancel') return
  const handle = picked
  let blob: Blob
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    blob = await res.blob()
  } catch {
    await discardHandle(handle)
    toast().warning('这张图暂时不能转换，已按原图打开，可右键另存')
    triggerAnchorDownload(url, filename, true)
    return
  }
  let jpg: Blob
  try {
    jpg = await convertBlobToJpg(blob, opts)
  } catch {
    await discardHandle(handle)
    toast().error('这张图转换 JPG 失败（可能尺寸过大或格式不支持），请改用「下载」保存原图')
    return
  }
  if (!handle) {
    anchorSave(jpg, name)
    return
  }
  try {
    const w = await handle.createWritable()
    await w.write(jpg)
    await w.close()
  } catch {
    await discardHandle(handle)
    anchorSave(jpg, name) // 写入被拒（权限 / 磁盘）：退回普通下载
  }
}
