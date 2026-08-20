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

/**
 * 注意：不要再用 response-content-disposition 做「服务端强制下载」兜底。
 * 素材 bucket 是公共读、匿名访问，OSS 对匿名请求禁止覆盖响应头，
 * 加了该参数会直接返回 InvalidRequest 错误 XML（0017-00000901）而不是文件。
 * 因此所有下载一律走 fetch→blob，抓不到时只能裸链打开让用户手动另存。
 */

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
 * 下载单张图片：fetch→blob→<a download>，可控文件名且强制下载。
 * 抓取失败（OSS 未开 CORS / 网络异常）时只能裸链打开，由用户手动另存 ——
 * 不能再拼 response-content-disposition，见上方说明。
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
    // 跨域时 a.download 会被忽略，退化为新开页展示，用户可右键另存
    triggerAnchorDownload(withWatermark(url), name)
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
export async function downloadImagesAsZip(
  urls: string[],
  zipName = zipNameByNow(),
): Promise<void> {
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
