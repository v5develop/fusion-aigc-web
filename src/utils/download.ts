/**
 * 图片下载工具：解决跨域 OSS 图片直接用 <a href> 会在页面打开而非下载的问题。
 * 单图：fetch→blob→<a download>，跨域失败时降级为 OSS response-content-disposition 强制下载。
 * 整组：优先打包 ZIP（需 fetch 到二进制），任一图片抓取失败则整体降级为逐张下载。
 */
import JSZip from 'jszip'
import { withWatermark } from './oss'

/** 取一组任务里可下载的图片 URL（仅生成成功、有 resultUrl 的） */
export function getDownloadableUrls(item: any): string[] {
  return (item?.contents ?? [])
    .map((c: any) => c?.resultUrl)
    .filter((url: any): url is string => !!url)
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
