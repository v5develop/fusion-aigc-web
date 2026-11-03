/**
 * 任务中心「做同款 / 参数回填」→ 工具页 / 工作流页的一次性交接。
 *
 * <p>任务中心先调 GET /api/v1/creation/task-center/tasks/{taskId}/params 拿到原始提交体，
 * 存进 sessionStorage 再跳页；目标页按「页面类型 + 标识」取走一次（取完即删）并走自己的
 * 「重新编辑」回填逻辑。不放进 URL：提交体里有图片地址和长文本，塞 query 既难看又会撞长度上限。
 *
 * <ul>
 *   <li>refill（参数回填）：原样回填全部参数，含上传的图片 / 视频；</li>
 *   <li>same（做同款）：只回填模板与设置（提示词、比例、模型等），素材留空，让用户换成自己的。</li>
 * </ul>
 */

export type RefillKind = 'tool' | 'workflow'
export type RefillMode = 'same' | 'refill'

export interface RefillHandoff {
  kind: RefillKind
  /** tool：工具历史 toolTitle（ToolSchema.historyTitle）；workflow：模板 title（WorkflowSchema.templateTitle） */
  key: string
  mode: RefillMode
  taskId: string
  params: Record<string, unknown>
  at: number
}

const STORAGE_KEY = 'fusion:task-refill'
/** 交接只在跳页那一下有效：放久了再进页面不该突然回填 */
const TTL_MS = 2 * 60 * 1000

export function stashRefill(handoff: Omit<RefillHandoff, 'at'>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...handoff, at: Date.now() }))
  } catch {
    // 隐私模式 / 配额满：拿不到交接，目标页照常打开，只是不回填
  }
}

/** 取走发给这个页面的交接；不是给它的不动，过期的顺手清掉 */
export function takeRefill(kind: RefillKind, key: string): RefillHandoff | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let h: RefillHandoff | null = null
  try {
    h = JSON.parse(raw) as RefillHandoff
  } catch {
    h = null
  }
  const expired = !h || typeof h.at !== 'number' || Date.now() - h.at > TTL_MS
  if (expired) {
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
  if (h!.kind !== kind || h!.key !== key || !h!.params || typeof h!.params !== 'object') return null
  sessionStorage.removeItem(STORAGE_KEY)
  return h
}
