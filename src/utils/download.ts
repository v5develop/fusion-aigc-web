/**
 * 图片下载工具：解决跨域 OSS 图片直接用 <a href> 会在页面打开而非下载的问题。
 * 单图：fetch→blob→<a download>，跨域失败时降级为 OSS response-content-disposition 强制下载。
 * 整组两种形态：
 *  - 打包 ZIP（downloadImagesAsZip）
 *  - 选一次文件夹后逐张写入（downloadImagesToDirectory）
 * 二者失败时都降级为逐张 attachment 下载，保证任何浏览器都能下到文件。
 */
import JSZip from 'jszip'
import { withWatermark } from './oss'

/** 取一组任务里可下载的图片 URL（仅生成成功 status===2 且有 resultUrl 的） */
export function getDownloadableUrls(item: any): string[] {
  return (item?.contents ?? [])
    .filter((c: any) => c?.resultUrl && c?.status === 2)
    .map((c: any) => c.resultUrl as string)
}

/** 从 URL 推断文件扩展名，无法识别时默认 jpg */
function extFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url)
    const ext = pathname.match(/\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|m4v)$/i)?.[1]
    return ext ? ext.toLowerCase() : 'jpg'
  } catch {
    return 'jpg'
  }
}

/** 给 OSS URL 追加强制下载参数（服务端驱动，不依赖 CORS 的兜底方案） */
function withAttachment(url: string, filename?: string): string {
  try {
    const u = new URL(url)
    // filename* 用 RFC 5987 编码，非 ASCII 文件名（中文）经 OSS 回传后浏览器才能正确解码
    u.searchParams.set(
      'response-content-disposition',
      filename ? `attachment;filename*=UTF-8''${encodeURIComponent(filename)}` : 'attachment',
    )
    return u.toString()
  } catch {
    return url
  }
}

/** 通过隐藏 <a> 触发一次下载 */
function triggerAnchorDownload(href: string, filename?: string) {
  const a = document.createElement('a')
  a.href = href
  if (filename) a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * 下载单张图片。优先 fetch→blob（可控文件名、强制下载）；
 * 跨域 / 网络失败时降级为 OSS response-content-disposition 强制下载。
 */
export async function downloadImage(url: string, filename?: string): Promise<void> {
  if (!url) return
  const name = filename || `AI素材_${Date.now()}.${extFromUrl(url)}`
  try {
    // 图片走水印变体；视频 URL withWatermark 会原样返回
    const res = await fetch(withWatermark(url), { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const objectUrl = URL.createObjectURL(await res.blob())
    triggerAnchorDownload(objectUrl, name)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  } catch {
    // 先 withAttachment(内部 new URL) 再拼水印，避免水印逗号被 URL 序列化重编码
    triggerAnchorDownload(withWatermark(withAttachment(url, name)))
  }
}

/** 逐张下载（整组兜底方案）：用服务端强制下载，间隔触发避免被浏览器拦截 */
async function downloadImagesSequentially(urls: string[], prefix: string): Promise<void> {
  let i = 0
  for (const url of urls) {
    i += 1
    triggerAnchorDownload(withWatermark(withAttachment(url, `${prefix}_${i}.${extFromUrl(url)}`)))
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

/** 目录选择器（File System Access API）：仅 Chrome/Edge 且安全上下文可用，其余环境返回 null */
type DirectoryPicker = (opts?: {
  mode?: 'read' | 'readwrite'
  id?: string
  startIn?: string
}) => Promise<any>
function getDirectoryPicker(): DirectoryPicker | null {
  const picker = (globalThis as any).showDirectoryPicker
  if (typeof picker !== 'function' || !globalThis.isSecureContext) return null
  return picker.bind(globalThis) as DirectoryPicker
}

/**
 * 整组下载到同一文件夹：只弹一次「选择文件夹」，随后逐张写入该目录（不打包）。
 * 不论几张都弹目录选择（含只有一张时），保证「全部下载」行为恒定，
 * 不受浏览器「下载前询问保存位置」设置影响。
 * 依赖 File System Access API；浏览器不支持 / 拒绝授权 / 跨域抓取失败 →
 * 降级为逐张 attachment 下载（那条路径每张各弹一次另存为）。
 */
export async function downloadImagesToDirectory(urls: string[], prefix = 'AI素材'): Promise<void> {
  const list = urls.filter(Boolean)
  if (!list.length) return

  const pickDirectory = getDirectoryPicker()
  if (pickDirectory) {
    let dir: any = null
    try {
      // 必须在用户手势的同步调用栈里先弹目录选择：任何 await 之后再调都会因手势失效而抛错
      dir = await pickDirectory({ mode: 'readwrite', id: 'aigc-download', startIn: 'downloads' })
    } catch (err: any) {
      // 用户主动取消 → 静默结束，不能降级（否则「取消」反而触发了逐张下载）
      if (err?.name === 'AbortError') return
    }
    if (dir) {
      try {
        let i = 0
        for (const url of list) {
          i += 1
          // 图片走水印变体；视频 URL withWatermark 会原样返回
          const res = await fetch(withWatermark(url), { mode: 'cors' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const handle = await dir.getFileHandle(`${prefix}_${i}.${extFromUrl(url)}`, {
            create: true,
          })
          const writable = await handle.createWritable()
          await writable.write(await res.blob())
          await writable.close()
        }
        return
      } catch {
        // 无写入权限 / OSS 未开 CORS / 写盘失败 → 走通用降级（已写入的几张会被重复下载，可接受）
      }
    }
  }
  await downloadImagesSequentially(list, prefix)
}

/**
 * 整组下载：优先把多张图片打包成一个 ZIP。
 * 任一图片跨域抓取失败（OSS 未开 CORS 等）→ 整体降级为逐张下载，保证始终能下。
 * 只有一张时直接下载单图，不打包。
 */
export async function downloadImagesAsZip(urls: string[], zipName = 'AI素材'): Promise<void> {
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
        const res = await fetch(withWatermark(url), { mode: 'cors' })
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
