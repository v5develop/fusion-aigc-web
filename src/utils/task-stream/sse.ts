/**
 * 任务中心实时推送（SSE）客户端：只在主标签页里用，由 utils/taskWatcher 驱动。
 *
 * <p>鉴权：EventSource 设不了请求头，所以先用正常的 Bearer 请求换一张一次性票据
 * （POST /creation/task-center/stream-ticket，约 60s 有效），再 GET /stream?ticket=…。
 * <b>访问令牌绝不进 URL。</b>票据只能用一次，所以浏览器自带的自动重连（复用旧 URL）必然 401——
 * 任何错误都由这里关掉连接、换新票据、带上 lastEventId 重开（新建的 EventSource 不会自带 Last-Event-ID 头）。
 *
 * <p>降级：票据接口 404/405（后端未部署或已关闭）→ 10 分钟内不再试，期间由轮询兜底；429（连接数超限）→ 1 分钟后再试；
 * 其它失败指数退避（1s → 60s）。不可用期间 {@link TaskStream.live} 为 false，调用方据此回到轮询。
 */
import { authorizedFetch } from '@/api/index.ts'

const API_BASE: string = import.meta.env.VITE_FUSION_API_BASE ?? ''
const TICKET_URL = '/api/v1/creation/task-center/stream-ticket'
const DEFAULT_STREAM_PATH = '/api/v1/creation/task-center/stream'
const DISABLED_RETRY_MS = 10 * 60_000
const LIMITED_RETRY_MS = 60_000
const MAX_BACKOFF_MS = 60_000
/** 服务端到点会发 bye 并断开；没收到 bye 时按「最长时长 + 宽限」兜底重连，防止半死连接一直挂着 */
const DURATION_GRACE_MS = 30_000

export interface TaskStreamEvent {
  taskId: string
  statusBucket: string
  status?: number | null
  statusLabel?: string | null
  progress?: number | null
  etaSeconds?: number | null
  progressSource?: string | null
  /** epoch ms */
  updatedAt?: number | null
}

export interface TaskStreamHandlers {
  onTask(ev: TaskStreamEvent, id: number | null): void
  onResync(reason: string): void
  onLive(live: boolean): void
  /** 重开连接时带上的最后事件号（跨标签页共享，由调用方维护） */
  lastEventId(): number | null
}

interface TicketResp {
  ticket: string
  expiresInSeconds?: number
  streamPath?: string
  heartbeatSeconds?: number
  retryMs?: number
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export class TaskStream {
  live = false
  private es: EventSource | null = null
  private running = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private disabledUntil = 0
  /** 每次 open 自增；过期的异步回调（票据请求、旧连接的事件）据此作废 */
  private gen = 0
  private heartbeatMs = 0
  /** 心跳是 SSE 注释行，EventSource 看不见；只有服务端发过具名 ping 时才按心跳周期判死 */
  private sawPing = false
  private maxDurationMs = 0

  constructor(private readonly h: TaskStreamHandlers) {}

  /** 后端未部署 / 浏览器不支持时为 true（期间只走轮询） */
  get unavailable() {
    return Date.now() < this.disabledUntil
  }

  start() {
    if (this.running) return
    this.running = true
    this.failures = 0
    void this.open()
  }

  stop() {
    this.running = false
    this.gen++
    this.clearRetry()
    this.close()
  }

  /** 立即换票重连（换号后用） */
  restart() {
    this.stop()
    this.start()
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private close() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    if (this.es) {
      this.es.close()
      this.es = null
    }
    this.setLive(false)
  }

  private setLive(live: boolean) {
    if (this.live === live) return
    this.live = live
    this.h.onLive(live)
  }

  private retryIn(ms: number) {
    this.clearRetry()
    if (!this.running) return
    this.retryTimer = setTimeout(() => void this.open(), ms)
  }

  private fail(minMs?: number) {
    this.close()
    this.failures++
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.failures, 6))
    this.retryIn(Math.max(minMs ?? 0, backoff) + Math.floor(Math.random() * 1000))
  }

  private armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog)
    const limits = [this.maxDurationMs ? this.maxDurationMs + DURATION_GRACE_MS : 0].filter((n) => n > 0)
    if (!limits.length) return
    const my = this.gen
    this.watchdog = setTimeout(
      () => {
        if (my !== this.gen || !this.running) return
        this.close()
        this.retryIn(200)
      },
      Math.min(...limits),
    )
  }

  /** 收到任何具名心跳事件时：超过 2.5 个心跳周期没有字节就判死 */
  private bumpHeartbeat() {
    if (!this.heartbeatMs) return
    if (this.watchdog) clearTimeout(this.watchdog)
    const my = this.gen
    this.watchdog = setTimeout(
      () => {
        if (my !== this.gen || !this.running) return
        this.close()
        this.retryIn(200)
      },
      Math.min(this.heartbeatMs * 2.5, this.maxDurationMs ? this.maxDurationMs + DURATION_GRACE_MS : Infinity),
    )
  }

  private async open() {
    this.clearRetry()
    if (!this.running) return
    if (typeof EventSource === 'undefined') {
      this.disabledUntil = Number.MAX_SAFE_INTEGER
      return
    }
    const wait = this.disabledUntil - Date.now()
    if (wait > 0) return this.retryIn(wait)
    if (!localStorage.getItem('fusion_accessToken')) return this.retryIn(MAX_BACKOFF_MS)
    const my = ++this.gen
    let ticket: TicketResp | null = null
    try {
      const resp = await authorizedFetch(TICKET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (my !== this.gen || !this.running) return
      if (resp.status === 404 || resp.status === 405 || resp.status === 501) {
        // 后端还没有这条路由（部署先后无关）或已关闭：老老实实轮询，过一阵再探
        this.disabledUntil = Date.now() + DISABLED_RETRY_MS
        this.close()
        return this.retryIn(DISABLED_RETRY_MS)
      }
      if (resp.status === 429) return this.fail(LIMITED_RETRY_MS)
      if (!resp.ok) return this.fail()
      const body = parse<{ code?: number; data?: TicketResp }>(await resp.text())
      if (body?.code === 1004) return this.fail(LIMITED_RETRY_MS)
      if (body?.code !== 0 || !body.data?.ticket) return this.fail()
      ticket = body.data
    } catch {
      if (my !== this.gen) return
      return this.fail()
    }
    if (my !== this.gen || !this.running) return

    this.heartbeatMs = (ticket.heartbeatSeconds ?? 0) * 1000
    this.sawPing = false
    const path = ticket.streamPath || DEFAULT_STREAM_PATH
    const qs = new URLSearchParams({ ticket: ticket.ticket })
    const last = this.h.lastEventId()
    if (last != null) qs.set('lastEventId', String(last))
    let es: EventSource
    try {
      es = new EventSource(`${API_BASE}${path}?${qs.toString()}`)
    } catch {
      return this.fail()
    }
    this.es = es
    const alive = () => my === this.gen && this.es === es

    es.addEventListener('ready', (e) => {
      if (!alive()) return
      const d = parse<{ heartbeatSeconds?: number; maxDurationSeconds?: number }>((e as MessageEvent).data) ?? {}
      if (d.heartbeatSeconds) this.heartbeatMs = d.heartbeatSeconds * 1000
      this.maxDurationMs = (d.maxDurationSeconds ?? 0) * 1000
      this.failures = 0
      this.setLive(true)
      this.armWatchdog()
    })
    es.addEventListener('task', (e) => {
      if (!alive()) return
      const me = e as MessageEvent
      const ev = parse<TaskStreamEvent>(me.data)
      if (!ev?.taskId) return
      const id = me.lastEventId ? Number(me.lastEventId) : NaN
      if (this.sawPing) this.bumpHeartbeat()
      this.h.onTask(ev, Number.isFinite(id) ? id : null)
    })
    es.addEventListener('resync', (e) => {
      if (!alive()) return
      const d = parse<{ reason?: string }>((e as MessageEvent).data)
      this.h.onResync(d?.reason ?? 'resync')
    })
    // 服务端说登录态失效：关掉，下一张票据请求会走正常的令牌刷新（authorizedFetch 遇 401 自动刷新）
    es.addEventListener('auth-expired', () => {
      if (!alive()) return
      this.close()
      this.retryIn(1000)
    })
    // 服务端主动结束（到点 / 慢消费者 / 停机）：尽快换票重连，带上 lastEventId 补齐中间事件
    es.addEventListener('bye', () => {
      if (!alive()) return
      this.close()
      this.retryIn(300 + Math.floor(Math.random() * 700))
    })
    for (const name of ['ping', 'heartbeat']) {
      es.addEventListener(name, () => {
        if (!alive()) return
        this.sawPing = true
        this.bumpHeartbeat()
      })
    }
    es.onerror = () => {
      if (!alive()) return
      // 票据一次性：不能让浏览器拿旧 URL 自动重连，统一换票重开
      this.fail()
    }
  }
}
