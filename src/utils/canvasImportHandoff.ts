/**
 * 智能体「在画布中打开」→ 画布编辑器的一次性交接（同 refillHandoff 的写法）。
 *
 * <p>新建画布接口只收 title，带不了初始快照；所以智能体页先建一张空画布，把图片地址存进
 * sessionStorage 再跳到编辑器，编辑器首次加载完按画布 id 取走一次（取完即删），逐张建图片节点，
 * 由编辑器的自动保存落库。
 */

export interface CanvasImportHandoff {
  /** 目标画布 id：只交给这张画布，别的画布打开时不动 */
  canvasId: string
  urls: string[]
  at: number
}

const STORAGE_KEY = 'fusion:canvas-import'
/** 交接只在跳页那一下有效：放久了再进画布不该突然多出节点 */
const TTL_MS = 2 * 60 * 1000

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
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
  if (h!.canvasId !== canvasId || !Array.isArray(h!.urls)) return null
  sessionStorage.removeItem(STORAGE_KEY)
  const urls = h!.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
  return urls.length ? { ...h!, urls } : null
}
