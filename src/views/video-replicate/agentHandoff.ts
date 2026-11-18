/**
 * 独立页 → 智能体对话的素材交接（CONTRACT §AA「需求复杂？去对话里说」）：
 * 智能体页原来没有「带附件进入」的入口，这里用一次性的 sessionStorage 交接（读完即删、超时作废），
 * 地址栏只带 `?skill=…&handoff=1` 这个标记，不把长地址塞进 URL。存储不可用（无痕 / 禁用）时静默降级为只跳转。
 */
export const AGENT_HANDOFF_KEY = 'xq-agent-handoff'
/** 交接有效期：超过就当没有（防止过期的素材被下一次进入页面误带入） */
const TTL_MS = 2 * 60 * 1000

export interface AgentHandoff {
  /** 原片地址（本站上传地址） */
  videoUrl?: string
  videoName?: string
  /** 全部素材图（http 地址，按图号顺序） */
  images: string[]
  /** 没带过来的品牌素材张数（私有媒体，只有会过期的现签地址）；智能体页据此提示用名字调用 */
  skippedBrand?: number
  analysisNo?: string
  /** 「想怎么改」原文，放进输入框作为草稿 */
  text?: string
  at: number
}

export function writeAgentHandoff(h: Omit<AgentHandoff, 'at'>): boolean {
  try {
    sessionStorage.setItem(AGENT_HANDOFF_KEY, JSON.stringify({ ...h, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

/** 取走交接（读完即删）；没有 / 过期 / 损坏都返回 null */
export function takeAgentHandoff(): AgentHandoff | null {
  try {
    const raw = sessionStorage.getItem(AGENT_HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(AGENT_HANDOFF_KEY)
    const h = JSON.parse(raw) as AgentHandoff
    if (!h || typeof h.at !== 'number' || Date.now() - h.at > TTL_MS) return null
    return { ...h, images: Array.isArray(h.images) ? h.images.filter((u) => typeof u === 'string') : [] }
  } catch {
    return null
  }
}
