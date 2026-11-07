import axios from 'axios'
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from './types'
import { createDiscreteApi } from 'naive-ui'
import { refreshToken, getAuthToken } from '@/api/union'
import { adoptSession, isAccountVerified, markAccountVerified, saveTokens } from '@/utils/authSession'
import { resolveUnionToken } from '@/utils/unionBridge'
import { BILLING_BLOCK_CODES, emitBillingBlock } from '@/utils/billingGuide'

const { message } = createDiscreteApi(['message'])
const refreshTokenApi = '/api/v1/auth/refresh'
const unionTokenLoginApi = '/api/v1/auth/union-token-login'

const baseURL = import.meta.env.VITE_FUSION_API_BASE
const service = axios.create({
  baseURL,
  timeout: 10000,
})

/**
 * 用 unionToken 换 fusion token 并接管会话（含换号检测）。
 *
 * <p>一律用裸 axios、不走 service 拦截器，理由有两条：
 * 一是结构性避免「刷新接口的响应再次触发刷新」的重入死锁；
 * 二是<b>不能带上 Authorization 头</b> —— 冷启动校验时本地那份 token 可能已属于上一个账号
 * 且已过期，带着它请求会被拦截器判成令牌失效，凭空拽出一条刷新链。
 *
 * @returns 新的 accessToken；换到的是<b>另一个账号</b>时 switched 为 true
 */
export async function exchangeUnionToken(token: string): Promise<{ accessToken: string; switched: boolean }> {
  const { data: body } = await axios.post<ApiResponse>(baseURL + unionTokenLoginApi, { token }, { timeout: 10000 })
  if (body?.code !== 0 || !body.data?.accessToken) {
    throw new Error(`union-token-login failed: code=${body?.code}`)
  }
  const switched = adoptSession(body.data)
  return { accessToken: body.data.accessToken as string, switched }
}

// fusion refresh 失败后的兜底：用联盟侧凭证换新的 fusion token。
// 失败只 throw，登出决策统一收敛在 handleTokenExpired，避免双 toast/双跳转
async function refreshViaUnion(): Promise<string> {
  const bridge = (window as any).ThirdServiceBridge

  // 容器内：走桥接刷新（桥优先、URL 兜底，带超时——桥不回调会挂死整条单航班）
  if (bridge?.refreshUnionToken) {
    const token = await resolveUnionToken()
    if (!token) throw new Error('no union token from bridge or url')
    const { accessToken, switched } = await exchangeUnionToken(token)
    // 这份 token 是宿主此刻给的，账号已经对上，后续刷新不必再优先绕联盟侧
    markAccountVerified()
    // 运行期换到了另一个账号：内存里的 store、正在跑的轮询全是旧账号的，
    // 局部清理收不干净，直接整页重载让一切从新 token 重建
    if (switched) {
      window.location.reload()
    }
    return accessToken
  }

  // 独立运行：用联盟 refreshToken 刷新
  const unionRefresh = localStorage.getItem('union_refreshToken')
  if (!unionRefresh) {
    throw new Error('no union refresh token')
  }
  const newUnion = await refreshToken(unionRefresh)
  const authRes = await getAuthToken(newUnion.token)
  const { accessToken } = await exchangeUnionToken(authRes.tempToken)
  // 联盟侧凭证落在 exchangeUnionToken <b>之后</b>：它换到别的账号时会清空 localStorage，
  // 先写就会被一起清掉
  localStorage.setItem('union_token', newUnion.token)
  localStorage.setItem('union_refreshToken', newUnion.refreshToken)
  return accessToken
}

// 单航班：失效瞬间多个请求同时失败时只刷新一次，各请求 await 同一个 promise 后自行重放
let refreshPromise: Promise<string> | null = null

function doRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      // 容器内、且本次加载没能用宿主当前身份核验过（冷启动那一枪桥超时或接口失败）：
      // 先问联盟侧。fusion refresh 只会给「本地缓存的那个账号」续期——宿主此刻若已换人，
      // 后端认下旧账号的 refreshToken，就把旧账号一路续下去，新账号永远进不来。
      // 只在未核验的会话里付这份代价（多一次桥调用 + 一次请求），正常会话完全不走这里
      if ((window as any).ThirdServiceBridge && !isAccountVerified()) {
        try {
          return await refreshViaUnion()
        } catch {
          // 桥仍未就绪：退回 fusion refresh，至少让当前账号能继续用，别把人卡死在这
        }
      }

      try {
        const rt = localStorage.getItem('fusion_refreshToken')
        if (!rt) throw new Error('no fusion refresh token')
        const { data: body } = await axios.post<ApiResponse>(
          baseURL + refreshTokenApi,
          { refreshToken: rt },
          { timeout: 10000 },
        )
        if (body?.code !== 0 || !body.data?.accessToken) {
          throw new Error(`fusion refresh failed: code=${body?.code}`)
        }
        saveTokens(body.data)
        return body.data.accessToken as string
      } catch {
        return refreshViaUnion()
      }
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

// 请求拦截：自动加 token
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('fusion_accessToken')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

/**
 * 结构化的请求失败：调用方可按 `code` / `reason` 分支（契约要求优先认 `reason`）。
 *
 * <p>`message` 仍是后端 msg（或原错误文案），只读 `error.message` 的老调用方不受影响。
 * 没有业务码时（网络失败、无信封的 HTTP 错误）`code` 为 -1。
 */
export class ApiError extends Error {
  /** 业务码；没有业务码时为 -1 */
  readonly code: number
  /** 后端错误常量名，如 INSUFFICIENT_POINTS；旧接口可能不带 */
  readonly reason?: string
  /** 走 HTTP 错误分支时的状态码（业务失败一律 HTTP 200，不填） */
  readonly httpStatus?: number
  /** 传输层失败（超时 / 断网 / 中断，没拿到响应）：请求是否已被服务端处理未知 */
  readonly isNetwork: boolean

  constructor(message: string, init: { code: number; reason?: string; httpStatus?: number; isNetwork?: boolean }) {
    super(message)
    this.name = 'ApiError'
    this.code = init.code
    this.reason = init.reason
    this.httpStatus = init.httpStatus
    this.isNetwork = init.isNetwork ?? false
  }
}

function fromBody(body: ApiResponse | undefined, fallbackMsg: string, httpStatus?: number): ApiError {
  const b = body as (ApiResponse & { reason?: unknown }) | undefined
  const code = typeof b?.code === 'number' && b.code !== 0 ? b.code : -1
  return new ApiError(code !== -1 && b?.msg ? b.msg : fallbackMsg, {
    code,
    reason: code !== -1 && typeof b?.reason === 'string' ? b.reason : undefined,
    httpStatus,
  })
}

/**
 * 把任意请求失败归一成 ApiError；无法识别的（非请求层抛出的）返回 null。
 *
 * <p>HTTP 错误分支为兼容老调用方仍 reject 原 AxiosError（有地方认 `err.code === 'ECONNABORTED'`、
 * `err.response.status`、`err.isAxiosError`），需要结构化信息时用本函数转换。
 */
export function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err
  if (axios.isAxiosError(err)) {
    const res = err.response as AxiosResponse<ApiResponse> | undefined
    if (!res) return new ApiError(err.message, { code: -1, isNetwork: true })
    return fromBody(res.data, err.message, res.status)
  }
  if (axios.isCancel(err)) return new ApiError('canceled', { code: -1, isNetwork: true })
  return null
}

const TOKEN_EXPIRED_CODES = new Set([2001, 2002, 2003])
// msg 关键词兜底：后端存在白名单外的失效码（表现为只弹"令牌失效"不刷新）。
// 窄匹配（须同时含「令牌/token」与「失效/过期/无效」）压低误伤普通业务错误的概率；
// 误判有 _retried 一次性保险丝兜底，代价上限是多一次刷新尝试
const TOKEN_INVALID_MSG = /(令牌|token).{0,6}(失效|过期|无效|expired|invalid)/i

function isTokenInvalid(body: ApiResponse | undefined): boolean {
  if (!body || body.code === 0) return false
  if (TOKEN_EXPIRED_CODES.has(body.code)) return true
  if (typeof body.msg === 'string' && TOKEN_INVALID_MSG.test(body.msg)) {
    // 打出真实 code，便于补进 TOKEN_EXPIRED_CODES 后收窄兜底
    console.warn('[auth] 按 msg 兜底识别为令牌失效, code =', body.code, ', msg =', body.msg)
    return true
  }
  return false
}

// 令牌失效统一处理：单航班刷新成功后重放原请求；重放后仍失效、或刷新链路彻底失败才登出
async function handleTokenExpired(config: InternalAxiosRequestConfig, httpStatus?: number): Promise<any> {
  const cfg = config as InternalAxiosRequestConfig & { _retried?: boolean }
  if (cfg._retried) {
    logoutToLogin()
    // 重放后仍被鉴权拒绝：原请求没有被执行，对调用方是确定的 2001
    return Promise.reject(
      new ApiError('token still invalid after refresh', { code: 2001, reason: 'UNAUTHORIZED', httpStatus }),
    )
  }
  cfg._retried = true
  try {
    await doRefresh()
  } catch (e) {
    logoutToLogin()
    return Promise.reject(e)
  }
  // 重放走完整拦截器链，请求拦截器会注入 localStorage 里的新 token
  return service(cfg)
}

// 业务失败(code!==0)不弹全局 toast 的接口白名单：由调用方自行降级展示（如询价预览失败显示「获取失败」）
const SILENT_ERROR_URLS = [
  '/billing/quote/preview',
  '/studio/tryon/quote',
  '/studio/pose/quote',
  '/studio/image-generate/quote',
  // 姿态复刻「识别人物与配对」：失败原因（4002 并发、未成年、无人物）由面板就地展示，不再弹全局 toast
  '/studio/pose/preview',
  // 智能体出图报价 / 批量托管估价：失败就隐藏点数行，不打扰
  '/agent/image-quote',
  '/batch-hosting/ecom-image/quote',
]

// 走「引导购买」弹框而非 toast 的接口白名单：前端在用的全部创作提交口。
// 限定到提交口而不是全局认 code：3003 在后端还被复用在预扣冻结、退点等内部环节上，
// 不限定的话某个无关接口偶然回一个 3003，用户就会莫名其妙看到一个充值弹框
const BILLING_GUARD_URLS = [
  '/creation/submit',
  '/creation/ecommerce/submit',
  '/creation/face-recognition/submit',
  // 商拍工作室（Go /api/v1/studio）三个提交口：点数不足同样走引导购买弹框
  '/studio/tryon/submit',
  '/studio/pose/submit',
  '/studio/image-generate/submit',
  // 工具箱（Java v1 /api/v1/tools/*）：12 个工具提交口 + 文字替换的识别（OCR 同样扣点）
  '/v1/tools/ai-',
  '/v1/tools/cutout',
  '/v1/tools/ocr',
]
// 按路径规则匹配的扣点口：商拍工作室单张重试 POST /studio/tasks/{id}/retry（重新冻结这 1 张的点数）、
// 智能体结果卡「重试这 n 张」POST /agent/conversations/{id}/generation-retry（逐张重新冻结）
const BILLING_GUARD_PATTERNS = [
  /\/studio\/tasks\/[^/?]+\/retry(?:$|\?)/,
  /\/agent\/conversations\/[^/?]+\/generation-retry(?:$|\?)/,
]

function isBillingBlock(body: ApiResponse, url?: string): boolean {
  if (!BILLING_BLOCK_CODES.has(body.code) || !url) return false
  return BILLING_GUARD_URLS.some((u) => url.includes(u)) || BILLING_GUARD_PATTERNS.some((re) => re.test(url))
}

// 响应拦截。令牌语义对齐 App 端 auth_interceptor：401/业务失效码 → 先刷新重放；403 → 直接重新登录
service.interceptors.response.use(
  (res: AxiosResponse<ApiResponse>) => {
    const data = res.data

    if (isTokenInvalid(data)) {
      return handleTokenExpired(res.config)
    }

    if (data.code !== 0) {
      if (isBillingBlock(data, res.config.url)) {
        // 点数不足/权益到期：交给 BillingGuideHost 弹带购买入口的引导框。
        // 这里刻意不 toast 后端 msg —— 一是它是内部定位串（带 modelId/entryCode），
        // 二是弹框已经把话说清楚了，再叠一条 toast 只是噪音
        emitBillingBlock(data.code)
      } else if (!SILENT_ERROR_URLS.some((u) => res.config.url?.includes(u))) {
        // 静默接口（如询价预览）业务失败不弹全局 toast，交由调用方自行降级展示
        message.error(data.msg)
      }
      return Promise.reject(fromBody(data, data.msg))
    }
    return data as unknown as AxiosResponse<ApiResponse<unknown>>
  },
  (error: AxiosError<ApiResponse>) => {
    const { response, config } = error || {}
    if (response?.status === 401 && config) {
      return handleTokenExpired(config, 401)
    }
    if (response?.status === 403) {
      logoutToLogin()
    }
    // 刻意 reject 原 AxiosError（老调用方认它的 code/response/isAxiosError），结构化信息用 toApiError 取
    return Promise.reject(error)
  },
)

let loggingOut = false
function logoutToLogin() {
  if (loggingOut) return // 并发失败的多个请求只登出一次、只弹一次
  loggingOut = true
  message.error('登录已过期，请重新登录')

  // 只清凭证，<b>不动业务缓存、也不动 fusion_identity</b>。
  //
  // 登出不等于换人：同一个人令牌过期后重新登进来，电商标签和会话记录该原样在。
  // 「要不要清缓存」这个决策唯一收敛在 authSession 的指纹比对上——下次冷启动拿新 token
  // 的身份跟留下来的 fusion_identity 一比，同人就留、换人才清，比「登出即清」精确得多。
  // 指纹留着正是为了那次比对：清了它就等于把唯一的判据丢了，换号也比不出来
  localStorage.removeItem('fusion_accessToken')
  localStorage.removeItem('fusion_refreshToken')
  localStorage.removeItem('union_token')
  localStorage.removeItem('union_refreshToken')

  const bridge = (window as any).ThirdServiceBridge
  if (!bridge) {
    // hash 跳转不重载页面，内存里的用户信息得手动清，否则旧账号的积分/头像会一直挂在导航栏。
    // 用动态 import 而不是顶层 import：stores/userInfo → api/methods → api/index 是一条环，
    // 静态引入会把它闭合成循环依赖
    void import('@/stores/userInfo').then(({ useUserInfoStore }) => useUserInfoStore().reset()).catch(() => {})
    window.location.hash = '#/login'
    // hash 跳转不重载页面，复位门闩以便下次会话过期仍能登出
    setTimeout(() => {
      loggingOut = false
    }, 2000)
    return
  }

  // 容器内没有注册 /login 路由：清 token 后整页重载，让路由守卫重新向桥要 unionToken 静默登录。
  // 若 unionToken 也已失效会再次走到这里，用 sessionStorage 时间戳挡住 30s 内的重复 reload 防死循环
  const lastReloadAt = Number(sessionStorage.getItem('fusion_logout_reload_at') || 0)
  if (Date.now() - lastReloadAt < 30_000) {
    loggingOut = false
    return
  }
  sessionStorage.setItem('fusion_logout_reload_at', String(Date.now()))
  // 留出 toast 展示时间
  setTimeout(() => window.location.reload(), 500)
}

export function post<T = any>(url: string, data: any, headers?: any, timeout?: number): Promise<ApiResponse<T>> {
  return service({
    method: 'post',
    url,
    data,
    headers,
    ...(timeout ? { timeout } : {}),
  })
}

export function get<T = any>(url: string, params?: any, headers?: any): Promise<ApiResponse<T>> {
  return service({
    method: 'get',
    url,
    params,
    headers,
  })
}

export function put<T = any>(url: string, data: any, headers?: any, timeout?: number): Promise<ApiResponse<T>> {
  return service({
    method: 'put',
    url,
    data,
    headers,
    ...(timeout ? { timeout } : {}),
  })
}

export function del<T = any>(url: string, params?: any): Promise<ApiResponse<T>> {
  return service({
    method: 'delete',
    url,
    params,
  })
}

export function patch<T = any>(url: string, data: any, headers?: any): Promise<ApiResponse<T>> {
  return service({
    method: 'patch',
    url,
    data,
    headers,
  })
}

/**
 * 带 fusion token 的裸 fetch（给 axios 收不了的流式接口用，如智能体 SSE）。
 *
 * <p>与 axios 实例同一个 baseURL 与 Bearer 注入；正在刷新时先等刷新结束。
 * 只在 HTTP 401 时刷新后重放一次 —— 401 说明请求没被受理，重放不会重复执行；
 * 其它失败一律原样交回调用方，<b>不做任何自动重试</b>（计费接口结果未知时不能重放）。
 */
export async function authorizedFetch(url: string, init: RequestInit): Promise<Response> {
  const doFetch = () => {
    const token = localStorage.getItem('fusion_accessToken')
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', 'Bearer ' + token)
    return fetch(baseURL + url, { ...init, headers })
  }
  if (refreshPromise) await refreshPromise.catch(() => {})
  const resp = await doFetch()
  if (resp.status !== 401) return resp
  try {
    await doRefresh()
  } catch (err) {
    logoutToLogin()
    throw err
  }
  return doFetch()
}

export interface SsePostHandlers {
  onDelta: (delta: string) => void
  /**
   * 流结束回调。fullText 为「整段原始字节一次性权威解码」后重新解析出的完整正文，
   * 上层应以它为准覆盖增量累加结果——增量阶段在部分宿主 webview 里可能丢字/乱码，
   * 而非增量的整段解码在所有 webview 都稳。abort 中断时不带 fullText。
   */
  onDone?: (fullText?: string) => void
  onError?: (err: unknown) => void
}

/**
 * 解码单条 SSE data 值。后端将正文按 JSON 字符串编码下发（带引号、`\n` 等转义），
 * 需 JSON.parse 还原为真实文本（引号去除、转义还原）；解析失败时按纯文本原样返回，
 * 兼容旧的纯文本格式。每条 data 都是完整一行（JSON 里换行被转义为 `\n`，不会跨行），故可逐行解析。
 */
function decodeSseData(raw: string): string {
  if (raw.charCodeAt(0) === 34 /* 双引号 " */) {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') return parsed
    } catch {
      // 非完整/合法 JSON 字符串，回退纯文本
    }
  }
  return raw
}

/**
 * 从完整 SSE 文本中提取拼接后的正文（与增量 onDelta 的拼接结果一致）。
 * 用于流结束时对「整段原始字节一次性解码」出的字符串做权威重解析，规避各宿主 webview
 * 增量解码（TextDecoder stream 模式）在多字节字符 chunk 边界上的丢字/乱码差异。
 */
function parseSseDeltas(text: string): string {
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let ev = 'message'
  let out = ''
  for (const line of norm.split('\n')) {
    if (!line.trim()) {
      ev = 'message'
      continue
    }
    const di = line.indexOf('data:')
    if (di === -1) {
      if (line.startsWith('event:')) ev = line.slice(6).trim()
      continue
    }
    const head = line.slice(0, di)
    if (head.startsWith('event:')) ev = head.slice(6).trim()
    if (ev === 'done') break
    if (ev === 'delta' || ev === 'message') out += decodeSseData(line.slice(di + 5).replace(/^ /, ''))
  }
  return out
}

/**
 * 以 SSE 流式消费一个 POST 接口（EventSource 不支持 POST/自定义头，故用 fetch + ReadableStream 手动解析）。
 * 复用与 axios 相同的 baseURL 与 Bearer token。返回一个可用于中断的 abort 函数。
 * 解析后端 ServerSentEvent：event=delta 的 data 为正文增量，event=done 表示结束。
 */
export function ssePost(url: string, data: any, handlers: SsePostHandlers): () => void {
  const controller = new AbortController()
  let doneFired = false
  const fireDone = (fullText?: string) => {
    if (doneFired) return
    doneFired = true
    handlers.onDone?.(fullText)
  }

  const doFetch = () => {
    const token = localStorage.getItem('fusion_accessToken')
    return fetch(baseURL + url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    })
  }

  ;(async () => {
    try {
      // 正在刷新 token 时等它结束再取 token，避免用刚失效的旧 token 开流
      if (refreshPromise) await refreshPromise.catch(() => {})
      let resp = await doFetch()
      if (resp.status === 401) {
        // 令牌失效：刷新成功后用新 token 重试一次；刷新失败则登出
        try {
          await doRefresh()
        } catch (err) {
          logoutToLogin()
          throw err
        }
        resp = await doFetch()
      }
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE request failed: ${resp.status}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // 保存全部原始字节：结束时用一次性（非增量）解码得到权威全文，
      // 覆盖增量阶段在部分宿主 webview 里可能出现的丢字/乱码
      const rawChunks: Uint8Array[] = []

      // 结束：以整段原始字节权威解码出的全文交给上层覆盖增量结果
      const finishDone = () => {
        if (doneFired) return
        let total = 0
        for (const c of rawChunks) total += c.byteLength
        const merged = new Uint8Array(total)
        let off = 0
        for (const c of rawChunks) {
          merged.set(c, off)
          off += c.byteLength
        }
        fireDone(parseSseDeltas(new TextDecoder().decode(merged)))
      }

      // 后端输出不是规范 SSE：event 与 data 常写在同一行（event:deltadata:xxx）、
      // 事件间仅单个换行、无空行分帧。故不按「空行分帧」解析，而是逐行容错处理：
      // 行内先定位 data:，其前若粘着 event:xxx 则单独摘出，每个 data 立即派发
      let curEvent = 'message'
      const handleLine = (line: string) => {
        if (!line.trim()) {
          curEvent = 'message' // 空行 = 规范 SSE 的帧结束，重置事件名
          return
        }
        const dataIdx = line.indexOf('data:')
        if (dataIdx === -1) {
          if (line.startsWith('event:')) {
            curEvent = line.slice(6).trim()
            if (curEvent === 'done') finishDone()
          }
          return
        }
        const head = line.slice(0, dataIdx)
        if (head.startsWith('event:')) curEvent = head.slice(6).trim()
        const data = line.slice(dataIdx + 5).replace(/^ /, '')
        if (curEvent === 'done') {
          finishDone()
        } else if (curEvent === 'delta' || curEvent === 'message') {
          if (data) handlers.onDelta(decodeSseData(data))
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) rawChunks.push(value)
        buffer += decoder.decode(value, { stream: true })
        // 行分隔符归一为 LF（兼容 CRLF/CR）；末尾裸 \r 可能是被分包劈开的 CRLF 前半，
        // 留待下一个 chunk 拼接后再归一
        buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
        let sep: number
        while ((sep = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 1)
          handleLine(line)
        }
      }
      // flush 解码器：收尾被 chunk 边界劈开的多字节序列，避免尾字丢失
      buffer += decoder.decode()
      buffer = buffer.replace(/\r/g, '\n')
      for (const line of buffer.split('\n')) handleLine(line)
      finishDone()
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') handlers.onError?.(err)
    }
  })()

  return () => controller.abort()
}
