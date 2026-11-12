import { downloadImage, extFromUrl } from '@/utils/download'

/** 批量下载的一项 */
export interface BatchDownloadItem {
  src: string
  /** 文件名（可不带扩展名）；缺省按序号生成 */
  name?: string
  /**
   * 该项套了校色效果时给：返回 true = 已下载烘好的图；false = 烘图失败，已退回下载原图
   * （与单张下载同一个烘图函数，不另写一套）
   */
  bake?: () => Promise<boolean>
}

/** 两次下载之间的间隔：浏览器对连续触发的下载有节流 */
export const BATCH_DOWNLOAD_GAP_MS = 120

function withExt(name: string, src: string): string {
  return /\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.${extFromUrl(src)}`
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
      if (item.bake) {
        await item.bake()
      } else {
        const base = item.name || `结果_${i + 1}`
        await downloadImage(item.src, withExt(`${base}_${i + 1}`, item.src), { strict: true })
      }
      ok += 1
    } catch {
      failed += 1
    }
    if (i < items.length - 1) await new Promise((resolve) => setTimeout(resolve, gap))
  }
  return { ok, failed }
}
