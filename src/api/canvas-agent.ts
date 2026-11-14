/**
 * 画布助手（编辑器右侧智能体面板）接口：复用 Java /api/v1/agent/stream，带 canvasId 与画布助手技能。
 *
 * <p>契约（Java 侧已实现：CreaftV1CoreAgentController.StreamRequest.canvasId、AgentCanvasToolExecutor、迁移 V1.0.234）：
 * - 技能：code = `canvas_assistant`，固定 agentSkillId（见 CANVAS_ASSISTANT_SKILL_ID）；未配置 Go 时工具回 CANVAS_DISABLED。
 * - StreamRequest 新增可选 `canvasId`（`cv_` + 16 位 hex）。引用的选中节点 id 只写进消息正文（Java 没有单独字段）。
 * - canvas_* 工具结果走 PROCESSING `tool_result`（toolName 为中文展示名；result = frontend_payload：
 *   {resultType: canvas_tool_result, isError, revision, result: Go 工具完整出参}）。`tool_call` 帧（{toolName, toolArgs}）
 *   Java 目前不发，面板认它是为了将来能显示「正在添加 3 个节点…」；没有时只显示完成态。
 *   画布本身的刷新不靠这些帧，而是靠画布变更事件（canvas-sync.ts）。
 */
import {
  agentCancel,
  agentRecoverStream,
  agentStream,
  type IAgentConversation,
  type IAgentFrame,
  type IAgentMessage,
  type IAgentPage,
  type IAgentRecoverReq,
  type IAgentStreamReq,
} from './agent.ts'
import { isCanvasMock } from './canvas-mock-switch.ts'
import { getQuiet, post } from './index.ts'
import { currentAccountId } from '@/utils/auth-session.ts'

export const CANVAS_ASSISTANT_SKILL_CODE = 'canvas_assistant'
/**
 * 画布助手技能的固定 id（Java 迁移 V1.0.234 种子：agent_skill_id = 7700000000000000001）。
 * 该技能没有分类，不出现在 /agent/skills 目录里，受理时按 id 解析——所以直接用 id，不查列表。
 * 字符串原样回传（超出 JS 安全整数）。
 */
export const CANVAS_ASSISTANT_SKILL_ID = '7700000000000000001'
/** 工具结果里的错误码：Java 未配置 Go 画布服务时回它，面板据此显示「画布助手暂未开启」 */
export const CANVAS_DISABLED_CODE = 'CANVAS_DISABLED'

/** 画布 id 格式（Java 校验 ^cv_[0-9a-f]{16}$） */
const CANVAS_ID_RE = /^cv_[0-9a-f]{16}$/

/** 画布助手会话的分类（POST /agent/conversations 的 category，列表可按它过滤） */
export const CANVAS_AGENT_CATEGORY = 'canvas'

/**
 * 新建画布助手会话（首条消息 / 点「新对话」后各一个）。
 * meta 记下所属画布（Java 原样存取、不解释），供本地记录丢失时从会话列表里认回本画布的会话。
 */
export async function createCanvasAgentConversation(title: string, canvasId = ''): Promise<string> {
  if (isCanvasMock()) return 'mock-conv-1'
  const res = await post<{ conversationId: string }>('/api/v1/agent/conversations', {
    category: CANVAS_AGENT_CATEGORY,
    title: title.slice(0, 30) || '画布助手',
    ...(canvasId ? { meta: { agent_mode: 'AGENT', canvasId } } : {}),
  })
  return res.data?.conversationId ?? ''
}

/**
 * 本画布最近的会话（GET /agent/conversations?canvasId=：Java 只回本人且建会话时 meta.canvasId 等于它的，按最近更新倒序）。
 * 本地记录丢了（清过存储 / 换了设备）也能靠它找回；没有或失败回空串（按新会话处理）。
 */
export async function findCanvasAgentConversation(canvasId: string): Promise<string> {
  if (isCanvasMock() || !CANVAS_ID_RE.test(canvasId)) return ''
  try {
    const res = await getQuiet<IAgentPage<IAgentConversation>>('/api/v1/agent/conversations', {
      page: 1,
      size: 1,
      canvasId,
    })
    return res.data?.data?.[0]?.agentConversationId ?? ''
  } catch {
    return ''
  }
}

/** 会话当前进行中的轮次（GET /agent/conversations/{id}/active-turn）；status 取 submitted / running / cancelling */
export interface ICanvasAgentActiveTurn {
  turnId: string
  status: string
  /** 服务端已落库事件的最大序号，仅供参考：续流游标用本地已渲染的最后一帧，不用它 */
  lastSequence: number
}

/** 没有进行中的轮次回 null；会话不存在 / 不是本人的按业务失败抛出（不弹 toast） */
export async function getCanvasAgentActiveTurn(conversationId: string): Promise<ICanvasAgentActiveTurn | null> {
  if (isCanvasMock()) return null
  const res = await getQuiet<ICanvasAgentActiveTurn | null>(
    `/api/v1/agent/conversations/${encodeURIComponent(conversationId)}/active-turn`,
  )
  return res.data?.turnId ? res.data : null
}

/** 一页消息的条数（Java 上限 100） */
const MESSAGE_PAGE_SIZE = 50

/**
 * 会话的最近消息（按顺序号升序）：先取第 1 页拿总页数，多页时再取最后一页（与智能体页同一做法）。
 * 不弹全局 toast：会话不存在 / 无权时由面板清掉本地记录、显示空会话。
 */
export async function loadCanvasAgentMessages(conversationId: string): Promise<IAgentMessage[]> {
  if (isCanvasMock()) return []
  const url = `/api/v1/agent/conversations/${encodeURIComponent(conversationId)}/messages`
  const first = await getQuiet<IAgentPage<IAgentMessage>>(url, { page: 1, size: MESSAGE_PAGE_SIZE })
  const pages = first.data?.pages ?? 0
  if (pages <= 1) return first.data?.data ?? []
  const last = await getQuiet<IAgentPage<IAgentMessage>>(url, { page: pages, size: MESSAGE_PAGE_SIZE })
  return last.data?.data ?? []
}

/**
 * 续接会话里运行中的那一轮（POST /agent/recover-stream，只读不计费，恒 200 + SSE），恒带 clientCaps=canvas：
 * ERROR 帧附 content.code（FORBIDDEN 无权 / TURN_FAILED 本轮失败 / TURN_INTERRUPTED 执行方中断），
 * 用户打断的轮次收口发 END{reason:interrupted}。
 * turnId 正是运行中那一轮时只发 afterSequence 之后的帧（0 = 整轮从 START 重放）；不是则整轮重放最新一轮。
 * 没有运行中的流 → 一帧 RECOVER_EMPTY。
 */
export async function canvasAgentRecover(
  req: { conversationId: string; turnId?: string; afterSequence: number },
  opts: { signal: AbortSignal; onFrame: (frame: IAgentFrame) => void },
): Promise<void> {
  if (isCanvasMock()) {
    opts.onFrame({ event: 'RECOVER_EMPTY', data: { content: {} } })
    return
  }
  // IAgentRecoverReq 不含 clientCaps（agent.ts 不归本次改）：多带的字段原样进请求体
  return agentRecoverStream({ ...req, clientCaps: 'canvas' } as IAgentRecoverReq, opts)
}

// ---------------- 按画布记住会话（localStorage） ----------------

/**
 * 每个画布一条：`canvas-agent:conv:{canvasId}`。
 * turnId / lastSeq / snapshot 只在有一轮进行中时存在（START 帧写入、逐帧更新，轮次收尾清掉）。
 * snapshot 是归并到 lastSeq（含）为止的面板回复，与 lastSeq 同一次写入：刷新后先渲染它，再从 lastSeq 之后续流，
 * 两者始终对齐（没有 snapshot 就从 0 整轮重放）。结构由面板定义，这里不解释。
 */
export interface ICanvasAgentSession {
  v: 1
  /** 写入时的账号：同一浏览器换号登录时不拿别人的会话 */
  accountId: string
  conversationId: string
  turnId?: string
  lastSeq?: number
  snapshot?: unknown
  updatedAt: number
}

const sessionKey = (canvasId: string) => `canvas-agent:conv:${canvasId}`

export function readCanvasAgentSession(canvasId: string): ICanvasAgentSession | null {
  if (!canvasId) return null
  try {
    const raw = localStorage.getItem(sessionKey(canvasId))
    const value = raw ? (JSON.parse(raw) as Partial<ICanvasAgentSession>) : null
    if (!value || value.v !== 1 || typeof value.conversationId !== 'string' || !value.conversationId) return null
    if ((value.accountId ?? '') !== currentAccountId()) return null
    return value as ICanvasAgentSession
  } catch {
    return null
  }
}

export function writeCanvasAgentSession(
  canvasId: string,
  value: { conversationId: string; turnId?: string; lastSeq?: number; snapshot?: unknown },
): void {
  if (!canvasId || !value.conversationId) return
  const record: ICanvasAgentSession = {
    v: 1,
    accountId: currentAccountId(),
    conversationId: value.conversationId,
    ...(value.turnId
      ? {
          turnId: value.turnId,
          lastSeq: value.lastSeq ?? 0,
          ...(value.snapshot !== undefined ? { snapshot: value.snapshot } : {}),
        }
      : {}),
    updatedAt: Date.now(),
  }
  try {
    localStorage.setItem(sessionKey(canvasId), JSON.stringify(record))
  } catch {
    // 存储不可用（隐私模式 / 配额满）：只是下次打开不恢复，不影响本次对话
  }
}

export function clearCanvasAgentSession(canvasId: string): void {
  if (!canvasId) return
  try {
    localStorage.removeItem(sessionKey(canvasId))
  } catch {
    // 同上
  }
}

export interface ICanvasAgentStreamReq {
  conversationId: string
  content: string
  agentSkillId: string
  canvasId: string
  /** 确认表单续答：attribute.answers = { 问题 id: { selected, text } }，此时 content 为空串 */
  attribute?: IAgentStreamReq['attribute']
  /** 确认表单续答：interrupt_required 帧的 interruptId（没有就不带，服务端按会话当前待答表单处理） */
  interruptId?: string
  /**
   * 「自动执行」：每轮自动放行的点数上限（正整数）；关闭时不带。
   * ⚠️ Java StreamRequest 目前没有这个字段（Spring 默认忽略未知字段，带了不报错也不生效），见面板说明。
   */
  autoApprovePoints?: number
}

/** 发起一轮画布助手对话（计费、幂等语义同 agentStream：requestId 进 X-Request-Id，不自动重试） */
export async function canvasAgentStream(
  req: ICanvasAgentStreamReq,
  opts: { requestId: string; signal: AbortSignal; onFrame: (frame: IAgentFrame) => void },
): Promise<void> {
  if (isCanvasMock()) return (await import('./canvas-mock.ts')).mockAgentStream(req, opts)
  const body: IAgentStreamReq & { canvasId?: string; autoApprovePoints?: number } = {
    conversationId: req.conversationId,
    content: req.content,
    agentSkillId: req.agentSkillId,
    // 服务端校验格式 ^cv_[0-9a-f]{16}$：不合格式就不带（工具会要求显式 canvas_id），不让整轮被拒
    ...(CANVAS_ID_RE.test(req.canvasId) ? { canvasId: req.canvasId } : {}),
    ...(req.attribute ? { attribute: req.attribute } : {}),
    ...(req.interruptId ? { interruptId: req.interruptId } : {}),
    ...(req.autoApprovePoints && req.autoApprovePoints > 0 ? { autoApprovePoints: req.autoApprovePoints } : {}),
  }
  return agentStream(body, opts)
}

export async function cancelCanvasAgent(conversationId: string): Promise<void> {
  if (isCanvasMock()) return
  await agentCancel(conversationId)
}

// ---------------- 「自动执行」设置（按账号，localStorage） ----------------

/** 键前缀已登记在 auth-session 的 ACCOUNT_KEYED_PREFIXES（换号不清、按账号隔离） */
const AUTO_KEY_PREFIX = 'xq-canvas-agent-auto:'

export interface ICanvasAgentAutoPrefs {
  /** 是否自动执行；默认关 */
  enabled: boolean
  /** 每轮不超过多少点（正整数） */
  points: number
}

export const CANVAS_AGENT_AUTO_PRESETS = [50, 100, 200] as const
export const DEFAULT_AUTO_PREFS: ICanvasAgentAutoPrefs = { enabled: false, points: 100 }

function autoKey(): string {
  const who = currentAccountId()
  return who ? `${AUTO_KEY_PREFIX}${who}` : ''
}

export function readCanvasAgentAutoPrefs(): ICanvasAgentAutoPrefs {
  try {
    const key = autoKey()
    const raw = key ? localStorage.getItem(key) : null
    const value = raw ? (JSON.parse(raw) as Partial<ICanvasAgentAutoPrefs>) : null
    const points = Number(value?.points)
    return {
      enabled: value?.enabled === true,
      points: Number.isInteger(points) && points > 0 ? points : DEFAULT_AUTO_PREFS.points,
    }
  } catch {
    return { ...DEFAULT_AUTO_PREFS }
  }
}

export function writeCanvasAgentAutoPrefs(prefs: ICanvasAgentAutoPrefs): void {
  try {
    const key = autoKey()
    if (key) localStorage.setItem(key, JSON.stringify({ enabled: prefs.enabled, points: prefs.points }))
  } catch {
    // 存储不可用：只是下次不记得，本次仍按内存里的设置发送
  }
}
