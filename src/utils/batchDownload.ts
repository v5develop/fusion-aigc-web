import JSZip from 'jszip'
import { anchorSave, canSaveAsJpg, convertBlobToJpg, downloadImage, extFromUrl, toast, zipNameByNow } from '@/utils/download'

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
  /**
   * 「全部另存为 JPG」专用：给出烘好的校色图 Blob（与 bake 同一个烘图函数，只是不触发下载）。
   * 只在 isCurrent 仍为真时调用；失败 / 未提供则转换原图。
   */
  bakeBlob?: () => Promise<Blob>
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


// ---------------- 全部另存为 JPG ----------------

/** 转换并发数：解码大图很吃内存，2–3 路足够 */
const JPG_CONCURRENCY = 3

export interface SaveJpgBatchResult {
  saved: number
  failed: number
  /** 视频 / 动图 / SVG 等不可转换而跳过的数量 */
  skipped: number
  cancelled: boolean
  /** 校色烘图失败、改用原图转换的张数 */
  bakeFallback: number
}

type DirHandle = {
  getFileHandle: (name: string, o?: { create?: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>
  removeEntry: (name: string) => Promise<void>
}

/** 当前批次内 / 目标目录里不重名：重名依次追加 (2)、(3)… */
function uniqueName(base: string, taken: Set<string>, existsInDir?: (n: string) => Promise<boolean>): Promise<string> {
  return (async () => {
    for (let n = 1; ; n += 1) {
      const name = `${base}${n === 1 ? '' : ` (${n})`}.jpg`
      if (taken.has(name)) continue
      taken.add(name) // 先同步占位，避免并发 worker 在等待目录检查时撞同一个名字
      if (existsInDir && (await existsInDir(name))) continue
      return name
    }
  })()
}

/**
 * 批量「另存为 JPG」。
 * - 只处理静态图片（canSaveAsJpg），视频 / 动图 / SVG 跳过并计数；文件名序号沿用批量下载规则（基础名_原清单序号）。
 * - 浏览器有 showDirectoryPicker：先选文件夹（必须第一时间调起以保住用户激活），逐张写入，同名自动追加 (2)；
 *   没有（或调起被策略拒绝）：打成一个 ZIP（文件名 + _JPG）下载。
 * - 抓【原图】转换，最多 3 路并发；单张抓取 / 转换失败只计数，不中断整批。全部失败时不留任何文件。
 * - 进度用一条常驻提示，可点关闭取消（只停止开新项，已写入的保留）。
 */
export async function saveImagesAsJpg(
  items: BatchDownloadItem[],
  opts: { zipName?: string; quality?: number; background?: string } = {},
): Promise<SaveJpgBatchResult> {
  const result: SaveJpgBatchResult = { saved: 0, failed: 0, skipped: 0, cancelled: false, bakeFallback: 0 }
  // 保留原清单序号，与「下载全部」的文件编号对得上
  const jobs = items.map((it, index) => ({ it, index })).filter((j) => canSaveAsJpg(j.it.src))
  result.skipped = items.length - jobs.length
  if (!jobs.length) {
    toast().warning('没有可转换为 JPG 的图片（视频 / 动图 / SVG 不支持）')
    return result
  }

  // 先选保存位置，再做任何异步抓取，否则用户激活会过期
  let dir: DirHandle | null = null
  const picker = (window as any).showDirectoryPicker as undefined | ((o: any) => Promise<DirHandle>)
  if (picker) {
    try {
      dir = await picker({ mode: 'readwrite' })
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        result.cancelled = true
        return result
      }
      dir = null // 非安全上下文 / 目录被系统拒绝：退回 ZIP
    }
  }

  const zip = dir ? null : new JSZip()
  const taken = new Set<string>()
  const existsInDir = dir
    ? async (name: string) => {
        try {
          await dir!.getFileHandle(name)
          return true
        } catch {
          return false
        }
      }
    : undefined

  let finished = false
  let done = 0
  const total = jobs.length
  const label = () => `正在转换 ${done}/${total}（关闭此提示可取消）`
  const progress = toast().loading(label(), {
    duration: 0,
    closable: true,
    onClose: () => {
      if (!finished) result.cancelled = true
    },
  })

  // 校色烘图一张就占几十 MB 画布内存：多路并发会让 Safari 崩页，烘图串行，抓取 / 转码仍并发
  let bakeChain: Promise<unknown> = Promise.resolve()
  const bakeSerial = (fn: () => Promise<Blob>) => {
    const run = bakeChain.then(fn, fn)
    bakeChain = run.catch(() => {})
    return run
  }

  let cursor = 0
  async function worker() {
    while (!result.cancelled && cursor < jobs.length) {
      const { it, index } = jobs[cursor++]!
      try {
        const base = `${stripExt(it.name || '结果')}_${index + 1}`
        let blob: Blob | null = null
        if (it.bakeBlob && (it.isCurrent?.() ?? true)) {
          try {
            blob = await bakeSerial(it.bakeBlob)
          } catch {
            result.bakeFallback += 1
          }
        }
        if (!blob) {
          const res = await fetch(it.src, { mode: 'cors' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          blob = await res.blob()
        }
        const jpg = await convertBlobToJpg(blob, opts)
        const name = await uniqueName(base, taken, existsInDir)
        if (dir) {
          // 转换成功才建文件，失败不留空文件
          try {
            const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
            await w.write(jpg)
            await w.close()
          } catch (err) {
            await dir.removeEntry(name).catch(() => {})
            throw err
          }
        } else {
          zip!.file(name, jpg)
        }
        result.saved += 1
      } catch {
        result.failed += 1
      }
      done += 1
      progress.content = label()
    }
  }
  await Promise.all(Array.from({ length: Math.min(JPG_CONCURRENCY, jobs.length) }, worker))

  if (zip && result.saved && !result.cancelled) {
    progress.content = '正在打包…'
    anchorSave(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `${opts.zipName ?? zipNameByNow()}_JPG.zip`)
  }
  finished = true
  progress.destroy()

  const extra = [
    result.skipped ? `${result.skipped} 个视频 / 动图已跳过` : '',
    result.bakeFallback ? `${result.bakeFallback} 张校色未能写入，已按原图转换` : '',
  ].filter(Boolean)
  const tail = extra.length ? `（${extra.join('，')}）` : ''
  if (result.cancelled) {
    toast().info(dir ? `已取消，已保存 ${result.saved} 张` : '已取消，未生成压缩包')
  } else if (!result.saved) {
    toast().error('全部转换失败（可能是图片跨域或格式不支持），可改用「下载」保存原图')
  } else if (result.failed) {
    toast().warning(`已保存 ${result.saved} 张，${result.failed} 张失败（可改用「下载」保存原图）${tail}`)
  } else {
    toast().success(`已保存 ${result.saved} 张 JPG${tail}`)
  }
  return result
}
