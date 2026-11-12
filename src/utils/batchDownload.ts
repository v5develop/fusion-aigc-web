import { downloadImage, extFromUrl } from '@/utils/download'

/** 批量下载的一项 */
export interface BatchDownloadItem {
  src: string
  /** 基础文件名（不要自带序号；可带可不带扩展名）；序号由批量下载统一追加。缺省为「结果」 */
  name?: string
  /**
   * 该项套了校色效果时给：参数是已编好序号的基础文件名（不含扩展名）；
   * 返回 true = 已下载烘好的图；false = 烘图失败，已退回下载原图
   * （与单张下载同一个烘图函数，不另写一套）
   */
  bake?: (fileBase: string) => Promise<boolean>
  /**
   * 烘图依赖「当前选中那张」的校色状态：开始烘之前问一下这一项现在还是不是被选中。
   * 返回 false（批量期间用户切走了）就不烘，直接下载原图，保证「烘的图」和「文件名」对得上
   */
  isCurrent?: () => boolean
}

/** 两次下载之间的间隔：浏览器对连续触发的下载有节流 */
export const BATCH_DOWNLOAD_GAP_MS = 120

const KNOWN_EXT = /^(.*)\.(png|jpe?g|webp|gif|bmp|avif|heic|tiff?|svg|mp4|mov|webm|m4v)$/i

/** 在扩展名前追加序号：已带扩展名的保持扩展名（`图.png` → `图_2.png`），没带的按地址补 */
function numberedName(base: string, index: number, src: string): string {
  const m = KNOWN_EXT.exec(base)
  if (m) return `${m[1]}_${index}.${m[2]}`
  return `${base}_${index}.${extFromUrl(src)}`
}

/** 去掉已有的已知扩展名（交给 bake 的基础名；它自己补 .png） */
function stripExt(name: string): string {
  const m = KNOWN_EXT.exec(name)
  return m ? m[1]! : name
}

/**
 * 逐个下载（间隔 120ms，不打包）。地址与单张下载完全相同——免费档拿到的就是接口下发的那个地址，不另取原件。
 * 单项失败不中断后面的；返回成功 / 失败数，由调用方提示。
 */
export async function downloadAllSequential(
  items: BatchDownloadItem[],
  gap = BATCH_DOWNLOAD_GAP_MS,
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!
    try {
      const base = item.name || '结果'
      if (item.bake && (item.isCurrent?.() ?? true)) {
        await item.bake(`${stripExt(base)}_${i + 1}`)
      } else {
        await downloadImage(item.src, numberedName(base, i + 1, item.src), { strict: true })
      }
      ok += 1
    } catch {
      failed += 1
    }
    if (i < items.length - 1) await new Promise((resolve) => setTimeout(resolve, gap))
  }
  return { ok, failed }
}
