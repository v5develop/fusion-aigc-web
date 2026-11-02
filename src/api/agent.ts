/**
 * 智能体（Java /api/v1/agent/*）接口封装 + SSE 流式对话客户端。
 *
 * <p>字段照 fusion-aigc CreaftV1CoreAgentController / CompatCoreAgentService 的 DTO（lowerCamel 出网）。
 * 普通接口复用 api/index.ts 的 axios 实例（token 注入、401 刷新、业务错误 toast）；
 * 流式接口走 {@link authorizedFetch}，同一个 token。
 *
 * <p>流式对话是计费接口（受理时预扣，终态结算）。服务端按请求头 X-Request-Id 做幂等
 * （idempotencyKey = "agent-" + X-Request-Id），所以：客户端从不自动重试；结果未知时由页面
 * 保留同一个 requestId，用户手动重发同一条内容才沿用它。
 */
import { ApiError, authorizedFetch, del, get, patch, post } from './index.ts'

const PREFIX = '/api/v1/agent'

// ---------------- 类型 ----------------

/** 分页信封（PageView） */
export interface IAgentPage<T> {
  current: number
  pages: number
  total: number
  data: T[]
}

/** 技能（SkillView）。agentSkillId 以字符串下发（雪花 id 超出 JS 安全整数），原样回传 */
export interface IAgentSkill {
  agentSkillId: string
  agentSkillCode: string
  title: string
  description: string
  icon: string
  version: string
  enabled: boolean | null
  category: string
  weight: number | null
  updatedAt: string | null
  /** react = 可走对话；workflow = 只能走对应工作流入口，选进对话会被拒 */
  executionShape: string | null
}

/** 会话列表行（ConversationListView） */
export interface IAgentConversation {
  agentConversationId: string
  title: string
  meta: unknown
  messageTotal: number
  lastMessage: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** 一帧 SSE（实时流与助手历史 sseEvents 同形） */
export interface IAgentFrame {
  event: string
  data: { content: Record<string, any>; timestamp?: number }
}

/**
 * 会话消息（messageView）：assistant 为对象时给 sseEvents、没有 content；
 * 其余给 content（user 可能带 hidden / attribute / imageUrls）。
 */
export interface IAgentMessage {
  id: number | string
  role: string
  content?: unknown
  sseEvents?: IAgentFrame[]
  generationLanguage?: string
  hidden?: boolean
  imageUrls?: string[]
  createdAt?: string | null
  updatedAt?: string | null
}

/** 流式请求体（StreamRequest 的子集：本页不传图、不答表单） */
export interface IAgentStreamReq {
  conversationId: string
  content: string
  /** v2 开启（技能目录非空）时必填；目录为空时不能带 */
  agentSkillId?: string
}

// ---------------- 普通接口 ----------------

/** 技能目录：按分类分组的字典；不传 categories = 全部 */
export function agentSkills() {
  return get<Record<string, IAgentSkill[]>>(`${PREFIX}/skills`)
}

export function agentConversations(params: { page: number; size: number }) {
  return get<IAgentPage<IAgentConversation>>(`${PREFIX}/conversations`, params)
}

/** 建会话：只回 {conversationId} */
export function agentCreateConversation(data: { title?: string; category?: string }) {
  return post<{ conversationId: string }>(`${PREFIX}/conversations`, data)
}

export function agentMessages(id: string, params: { page: number; size: number }) {
  return get<IAgentPage<IAgentMessage>>(`${PREFIX}/conversations/${encodeURIComponent(id)}/messages`, params)
}

/** 改名：局部更新，只传 title */
export function agentRenameConversation(id: string, title: string) {
  return patch<null>(`${PREFIX}/conversations/${encodeURIComponent(id)}`, { title })
}

export function agentDeleteConversation(id: string) {
  return del<null>(`${PREFIX}/conversations/${encodeURIComponent(id)}`)
}

/** 中断当前回答：status 只会是 interrupting / idle */
export function agentCancel(id: string) {
  return post<{ status: 'interrupting' | 'idle'; conversationId: string; runId: string }>(
    `${PREFIX}/conversations/${encodeURIComponent(id)}/cancel`,
    {},
  )
}

// ---------------- 帧归并（实时与历史共用） ----------------

export interface IAgentToolResult {
  name: string
  status: string
  message: string
}

/** 一轮助手回复的可渲染状态 */
export interface IAgentReply {
  text: string
  thinking: string
  tools: IAgentToolResult[]
  /** ERROR 帧的 message；空 = 无错误 */
  error: string
  /** 收到 END */
  finished: boolean
}

export function emptyReply(): IAgentReply {
  return { text: '', thinking: '', tools: [], error: '', finished: false }
}

const str = (v: unknown) => (v == null ? '' : String(v))

/**
 * 把一帧归并进回复：
 * PROCESSING message_delta → 正文；thinking_delta → 思考；tool_result → 工具结果；
 * END → finished；ERROR → error（content.message）。START / RECOVER_EMPTY / 其余 eventType 忽略。
 */
export function applyFrame(reply: IAgentReply, frame: IAgentFrame): void {
  const content = frame.data?.content ?? {}
  switch (frame.event) {
    case 'PROCESSING': {
      const payload = (content.payload ?? {}) as Record<string, unknown>
      if (content.eventType === 'message_delta') reply.text += str(payload.delta)
      else if (content.eventType === 'thinking_delta') reply.thinking += str(payload.delta)
      else if (content.eventType === 'tool_result') {
        reply.tools.push({ name: str(payload.toolName), status: str(payload.status), message: str(payload.message) })
      }
      break
    }
    case 'END':
      reply.finished = true
      break
    case 'ERROR':
      reply.error = str(content.message) || 'agent 执行失败'
      break
  }
}

export function replyFromFrames(frames: IAgentFrame[] | undefined): IAgentReply {
  const reply = emptyReply()
  for (const f of frames ?? []) applyFrame(reply, f)
  return reply
}

// ---------------- SSE 客户端 ----------------

export interface IAgentStreamOptions {
  /** 本次提交的幂等身份，写进 X-Request-Id（8~64 位字母数字与连字符） */
  requestId: string
  signal: AbortSignal
  onFrame: (frame: IAgentFrame) => void
}

/**
 * 发起一轮流式对话，逐帧回调，流结束时 resolve。
 *
 * <p>失败一律抛 {@link ApiError}：传输层失败（断网 / 中断）isNetwork=true（结果未知）；
 * 受理前的参数校验失败服务端回 JSON 信封（code≠0），按确定失败抛出。
 * 受理前的业务拒绝（点数不足、技能不可用等）走 SSE 的 ERROR 帧（恒 200），经 onFrame 交回。
 * 主动 abort 时抛原生 AbortError，由调用方忽略。
 */
export async function agentStream(body: IAgentStreamReq, opts: IAgentStreamOptions): Promise<void> {
  let resp: Response
  try {
    resp = await authorizedFetch(`${PREFIX}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Request-Id': opts.requestId },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }

  const type = resp.headers.get('content-type') ?? ''
  if (!resp.ok || !type.includes('text/event-stream') || !resp.body) {
    const json = (await resp.json().catch(() => null)) as { code?: number; msg?: string; reason?: string } | null
    const code = typeof json?.code === 'number' && json.code !== 0 ? json.code : -1
    throw new ApiError(json?.msg || `SSE request failed: ${resp.status}`, {
      code,
      reason: typeof json?.reason === 'string' ? json.reason : undefined,
      httpStatus: resp.ok ? undefined : resp.status,
    })
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []

  const dispatch = () => {
    if (data.length) {
      try {
        const parsed = JSON.parse(data.join('\n'))
        opts.onFrame({ event: event || 'message', data: parsed })
      } catch {
        // 非 JSON 的 data 不是本接口的帧，丢弃
      }
    }
    event = ''
    data = []
  }

  const handleLine = (line: string) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return // 心跳注释帧（": ping"）
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 末尾裸 \r 可能是被分包劈开的 CRLF 前半，留到下一个 chunk 再归一
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, sep))
        buffer = buffer.slice(sep + 1)
      }
    }
    buffer += decoder.decode()
    for (const line of buffer.replace(/\r\n?/g, '\n').split('\n')) handleLine(line)
    dispatch()
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }
}
