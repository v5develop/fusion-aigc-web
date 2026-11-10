/**
 * 「在画布中打开 / 用于画布」→ 画布编辑器的一次性交接（同 refillHandoff 的写法）。
 * 来源：智能体结果图、资产库详情与多选（资产可带视频）。
 *
 * <p>新建画布接口只收 title，带不了初始快照；所以智能体页先建一张空画布，把图片地址存进
 * sessionStorage 再跳到编辑器，编辑器首次加载完按画布 id 取走一次（取完即删），逐张建图片节点，
 * 由编辑器的自动保存落库。
 */

export interface CanvasImportHandoff {
  /** 目标画布 id：只交给这张画布，别的画布打开时不动 */
  canvasId: string
  /** 图片地址：逐张建图片节点 */
  urls: string[]
  /** 视频地址：逐个建视频素材节点（可选，老交接没有） */
  videos?: string[]
  at: number
}

const STORAGE_KEY = 'fusion:canvas-import'
/** 交接只在跳页那一下有效：放久了再进画布不该突然多出节点 */
const TTL_MS = 2 * 60 * 1000

/** 删交接：存储被禁用时 removeItem 也会抛，吞掉即可（交接本就是尽力而为） */
function dropHandoff() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}

export function stashCanvasImport(handoff: Omit<CanvasImportHandoff, 'at'>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...handoff, at: Date.now() }))
  } catch {
    // 隐私模式 / 配额满：拿不到交接，画布照常打开，只是没有导入的图片
  }
}

/** 取走发给这张画布的交接；不是给它的不动，过期的顺手清掉 */
export function takeCanvasImport(canvasId: string): CanvasImportHandoff | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let h: CanvasImportHandoff | null = null
  try {
    h = JSON.parse(raw) as CanvasImportHandoff
  } catch {
    h = null
  }
  const expired = !h || typeof h.at !== 'number' || Date.now() - h.at > TTL_MS
  if (expired) {
    dropHandoff()
    return null
  }
  if (h!.canvasId !== canvasId || !Array.isArray(h!.urls)) return null
  dropHandoff()
  const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
  const urls = h!.urls.filter(isHttp)
  const videos = Array.isArray(h!.videos) ? h!.videos.filter(isHttp) : []
  return urls.length || videos.length ? { ...h!, urls, videos } : null
}
