/**
 * 画布实时同步接口（Go 网关）：变更事件 SSE、当前 revision 轮询、历史 revision 快照。
 *
 * <p>契约（Go docs/design/canvas-agent-tools.md §11，代码 app/gateway/api/internal/handler/canvasevents）：
 * - `GET /api/v1/canvas/canvases/{id}/events`（SSE，须带 Accept: text/event-stream）。帧：
 *   `event: hello`（首帧 {mode: push|poll, canvasId, revision, updatedAt, heartbeatMs | pollUrl, pollIntervalMs}）；
 *   `id: <revision>` + `event: canvas`（source=user|agent，或网关补发的 resync=true、source=unknown、changedNodeIds=[]）；
 *   `event: run`（source=run，无 id，revision 不变，只刷新节点运行态，不需要合并）；`: ping` 注释心跳；
 *   `retry: <ms>` 字段（重连间隔）；结束帧 `event: gone`（不要重连：code=CANVAS_GONE | SESSION_EXPIRED）
 *   与 `event: bye`（可重连：code=RECONNECT | CONN_SLOT_UNAVAILABLE）。
 *   事件载荷 camelCase：{canvasId, revision, source, actor, changedNodeIds[≤200], truncated?, at, requestId?, runStatus?, resync?}。
 *   续传：重连带 `Last-Event-ID`（或 `?since=`）；与当前 revision 不同则先补发一条 resync。
 *   hello.mode=poll（网关无会话 Redis）后服务端立即结束，客户端改轮询 revision。
 *   超出每用户连接上限回 JSON 信封 4002 · CANVAS_EVENTS_TOO_MANY；画布不存在 / 不属于你回 4001（不开流）。
 * - `GET /api/v1/canvas/canvases/{id}/revision` → {canvas_id, revision, updated_at, node_count, push, poll_interval_ms}（信封含驼峰别名）。
 * - `GET /api/v1/canvas/canvases/{id}?revision=<rev>` → 该 revision 的画布详情（保留最近 20 个）；
 *   超出保留范围 4001 · reason=CANVAS_REVISION_NOT_RETAINED（调用方退化为无 base 合并）。
 */
import { ApiError, authorizedFetch, getQuiet } from './index.ts'
import type { ICanvasDetail } from './canvas-home.ts'
import { isCanvasMock } from './canvas-mock-switch.ts'

const PREFIX = '/api/v1/canvas'

export type CanvasChangeSource = 'user' | 'agent' | 'run' | (string & {})

/** 一次 revision 变化 */
export interface ICanvasChangeEvent {
  canvasId: string
  revision: string
  source: CanvasChangeSource
  /** 谁改的：用户 id / 智能体名 / run 的 request_id（展示用，不参与判断） */
  actor: string
  changedNodeIds: string[]
  /** 毫秒时间戳 */
  at: number
  /** 网关补发的对账事件（source=unknown、changedNodeIds=[]）：只表示「revision 变了」 */
  resync?: boolean
  /** changedNodeIds 超过 200 被截断：按整画布刷新，不要信 ids */
  truncated?: boolean
  /** source=run：生成请求号与状态（revision 不变） */
  requestId?: string
  runStatus?: string
}

export interface ICanvasRevision {
  revision: string
  updatedAt: number
  /** false = 网关没有事件推送，按 pollIntervalMs 轮询本接口 */
  push?: boolean
  pollIntervalMs?: number
}

/** 历史快照已超出保留范围（4001 · CANVAS_REVISION_NOT_RETAINED）：合并改用无 base 模式 */
export class CanvasRevisionNotRetained extends Error {
  constructor() {
    super('revision snapshot not retained')
    this.name = 'CanvasRevisionNotRetained'
  }
}

/** gone / bye 帧里的 code */
export type CanvasGoneCode = 'CANVAS_GONE' | 'SESSION_EXPIRED'
export type CanvasByeCode = 'RECONNECT' | 'CONN_SLOT_UNAVAILABLE'

/** 服务端不支持事件流（404 / 405 / 501 或不是 SSE）：调用方退回轮询 */
export class CanvasEventsUnsupported extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasEventsUnsupported'
  }
}

const str = (v: unknown) => (v == null ? '' : String(v))

/** 事件 JSON → ICanvasChangeEvent（camelCase / snake_case 都认）；缺 revision 返回 null */
export function normalizeChangeEvent(raw: unknown, fallbackRevision = ''): ICanvasChangeEvent | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const revision = str(r.revision ?? fallbackRevision)
  if (!revision) return null
  const ids = r.changedNodeIds ?? r.changed_node_ids
  const at = Number(r.at ?? r.updatedAt ?? r.updated_at ?? 0)
  const truncated = r.truncated === true
  return {
    canvasId: str(r.canvasId ?? r.canvas_id),
    revision,
    source: (str(r.source) || 'user') as CanvasChangeSource,
    actor: str(r.actor),
    // 被截断时 ids 不完整：丢掉，让上层按前后差异自行算
    changedNodeIds: !truncated && Array.isArray(ids) ? ids.map(str).filter(Boolean) : [],
    at: Number.isFinite(at) ? at : 0,
    ...(r.resync === true ? { resync: true } : {}),
    ...(truncated ? { truncated: true } : {}),
    ...(r.requestId != null ? { requestId: str(r.requestId) } : {}),
    ...(r.runStatus != null ? { runStatus: str(r.runStatus) } : {}),
  }
}

export interface ICanvasEventStreamHandlers {
  /** 续传游标（上一次看到的 revision） */
  lastEventId?: string
  signal: AbortSignal
  /** 连上了（收到响应头） */
  onOpen?: () => void
  /** 任何字节到达（含心跳）：调用方据此判断连接是否还活着 */
  onActivity?: () => void
  onEvent: (event: ICanvasChangeEvent) => void
  /** 服务端提示改为轮询（hello.mode=poll，没有 Redis）；带轮询间隔（毫秒，可能缺省） */
  onPollHint?: (intervalMs?: number) => void
  /** gone：不要重连（画布已删除 / 登录已失效） */
  onGone?: (code: CanvasGoneCode | (string & {}), reason: string) => void
  /** bye：可重连（到达最长存活 / 连接名额暂不可用） */
  onBye?: (code: CanvasByeCode | (string & {}), reason: string) => void
  /** SSE `retry:` 字段（毫秒）：服务端建议的重连间隔 */
  onRetry?: (ms: number) => void
}

/**
 * 打开事件流，直到服务端关闭（resolve）或出错（reject）。
 * 主动 abort 抛原生 AbortError；服务端不支持抛 {@link CanvasEventsUnsupported}；其余失败抛 ApiError（isNetwork）。
 */
export async function openCanvasEventStream(canvasId: string, handlers: ICanvasEventStreamHandlers): Promise<void> {
  if (isCanvasMock()) return (await import('./canvas-mock.ts')).mockEventStream(canvasId, handlers)
  let resp: Response
  try {
    resp = await authorizedFetch(`${PREFIX}/canvases/${encodeURIComponent(canvasId)}/events`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(handlers.lastEventId ? { 'Last-Event-ID': handlers.lastEventId } : {}),
      },
      cache: 'no-store',
      signal: handlers.signal,
    })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') throw err
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }
  const type = resp.headers.get('content-type') ?? ''
  if ([404, 405, 501].includes(resp.status)) throw new CanvasEventsUnsupported(`events HTTP ${resp.status}`)
  if (resp.status === 401) {
    handlers.onGone?.('SESSION_EXPIRED', '登录已失效，请重新登录')
    return
  }
  if (!resp.ok || !resp.body) {
    throw new ApiError(`events HTTP ${resp.status}`, { code: -1, isNetwork: true, httpStatus: resp.status })
  }
  // 200 但回的是 JSON 信封：4001 = 画布不存在 / 不属于你（不开流，等同 gone）；4002 = 连接数超限、其余 = 业务拒绝，退回轮询
  if (!type.includes('text/event-stream')) {
    const env = (await resp.json().catch(() => null)) as { code?: number } | null
    if (env?.code === 4001) {
      handlers.onGone?.('CANVAS_GONE', '画布已删除或不再属于你')
      return
    }
    throw new CanvasEventsUnsupported(`events content-type ${type} code ${env?.code ?? ''}`)
  }
  handlers.onOpen?.()

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let id = ''
  let data: string[] = []

  const dispatch = () => {
    const name = event || 'message'
    const text = data.join('\n')
    const frameId = id
    event = ''
    id = ''
    data = []
    if (name === 'ping' || name === 'heartbeat') return
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    if (name === 'gone') {
      handlers.onGone?.(str(obj.code) || 'CANVAS_GONE', str(obj.reason))
      return
    }
    if (name === 'bye') {
      handlers.onBye?.(str(obj.code) || 'RECONNECT', str(obj.reason))
      return
    }
    if (name === 'hello') {
      if (obj.mode === 'poll') handlers.onPollHint?.(Number(obj.pollIntervalMs) || undefined)
      return
    }
    // 兼容旧写法：event: poll
    if (name === 'poll' || obj.mode === 'poll' || obj.type === 'poll') {
      handlers.onPollHint?.(Number(obj.pollIntervalMs) || undefined)
      return
    }
    if (!text) return
    const change = normalizeChangeEvent(parsed, frameId)
    if (change) handlers.onEvent(change)
  }

  const handleLine = (line: string) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return // 注释心跳
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id') id = value
    else if (field === 'retry') {
      const ms = Number(value)
      if (Number.isFinite(ms) && ms > 0) handlers.onRetry?.(ms)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      handlers.onActivity?.()
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, sep))
        buffer = buffer.slice(sep + 1)
      }
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') throw err
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }
}

/** 当前 revision（轮询，静默失败） */
export async function canvasRevision(canvasId: string): Promise<ICanvasRevision> {
  if (isCanvasMock()) return (await import('./canvas-mock.ts')).mockRevision(canvasId)
  const res = await getQuiet<Partial<ICanvasRevision> & { updated_at?: number; poll_interval_ms?: number }>(
    `${PREFIX}/canvases/${encodeURIComponent(canvasId)}/revision`,
  )
  const interval = Number(res.data?.pollIntervalMs ?? res.data?.poll_interval_ms ?? 0)
  return {
    revision: str(res.data?.revision),
    updatedAt: Number(res.data?.updatedAt ?? res.data?.updated_at ?? 0),
    ...(typeof res.data?.push === 'boolean' ? { push: res.data.push } : {}),
    ...(interval > 0 ? { pollIntervalMs: interval } : {}),
  }
}

/** 指定 revision 的历史快照（服务端保留最近 20 个；过旧 / 不存在时 reject，调用方降级） */
export async function canvasGetAtRevision(canvasId: string, revision: string): Promise<ICanvasDetail> {
  if (isCanvasMock()) return (await import('./canvas-mock.ts')).mockGetAtRevision(canvasId, revision)
  let res
  try {
    res = await getQuiet<ICanvasDetail>(`${PREFIX}/canvases/${encodeURIComponent(canvasId)}`, { revision })
  } catch (err) {
    if (err instanceof ApiError && (err.reason === 'CANVAS_REVISION_NOT_RETAINED' || err.code === 4001)) {
      throw new CanvasRevisionNotRetained()
    }
    throw err
  }
  if (!res.data || str(res.data.revision) !== revision) throw new Error('revision snapshot unavailable')
  return res.data
}
