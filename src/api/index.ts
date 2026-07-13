import axios from 'axios'
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from './types'
import { createDiscreteApi } from 'naive-ui'
import { getUserInfo } from '@/api/methods.ts'
import { refreshToken, getAuthToken } from '@/api/union'

const { message } = createDiscreteApi(['message'])
const refreshTokenApi = '/api/v1/auth/refresh'
const unionTokenLoginApi = '/api/v1/auth/union-token-login'

const baseURL = import.meta.env.VITE_FUSION_API_BASE ?? ''
const service = axios.create({
  baseURL,
  timeout: 10000,
})

function saveTokens(data: { accessToken: string; refreshToken: string }) {
  localStorage.setItem('fusion_accessToken', data.accessToken)
  localStorage.setItem('fusion_refreshToken', data.refreshToken)
}

// 刷新链路内的 fusion 接口一律用裸 axios（不走 service 拦截器）：
// 结构性避免「刷新接口的响应再次触发刷新」的重入死锁，也不依赖拦截器改写后的响应形状
async function unionTokenLoginRaw(token: string): Promise<string> {
  const { data: body } = await axios.post<ApiResponse>(baseURL + unionTokenLoginApi, { token }, { timeout: 10000 })
  if (body?.code !== 0 || !body.data?.accessToken) {
    throw new Error(`union-token-login failed: code=${body?.code}`)
  }
  saveTokens(body.data)
  return body.data.accessToken
}

// fusion refresh 失败后的兜底：用联盟侧凭证换新的 fusion token。
// 失败只 throw，登出决策统一收敛在 handleTokenExpired，避免双 toast/双跳转
async function refreshViaUnion(): Promise<string> {
  const bridge = (window as any).ThirdServiceBridge

  // 容器内：走桥接刷新
  if (bridge?.refreshUnionToken) {
    const token = await bridge.refreshUnionToken()
    return unionTokenLoginRaw(token)
  }

  // 独立运行：用联盟 refreshToken 刷新
  const unionRefresh = localStorage.getItem('union_refreshToken')
  if (!unionRefresh) {
    throw new Error('no union refresh token')
  }
  const newUnion = await refreshToken(unionRefresh)
  localStorage.setItem('union_token', newUnion.token)
  localStorage.setItem('union_refreshToken', newUnion.refreshToken)
  const authRes = await getAuthToken(newUnion.token)
  return unionTokenLoginRaw(authRes.tempToken)
}

// 单航班：失效瞬间多个请求同时失败时只刷新一次，各请求 await 同一个 promise 后自行重放
let refreshPromise: Promise<string> | null = null

function doRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const rt = localStorage.getItem('fusion_refreshToken')
        if (!rt) throw new Error('no fusion refresh token')
        const { data: body } = await axios.post<ApiResponse>(baseURL + refreshTokenApi, { refreshToken: rt }, { timeout: 10000 })
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
    // 刷新成功后异步补拉用户信息（头像缓存），不阻塞请求重放、失败忽略
    refreshPromise
      .then(async () => {
        const { code, data } = await getUserInfo()
        if (code === 0) {
          localStorage.setItem('userInfo', JSON.stringify({ avatar: data.avatar }))
        }
      })
      .catch(() => {})
  }
  return refreshPromise
}

// 请求拦截：自动加 token
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('fusion_accessToken')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

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
async function handleTokenExpired(config: InternalAxiosRequestConfig): Promise<any> {
  const cfg = config as InternalAxiosRequestConfig & { _retried?: boolean }
  if (cfg._retried) {
    logoutToLogin()
    return Promise.reject(new Error('token still invalid after refresh'))
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

// 响应拦截。令牌语义对齐 App 端 auth_interceptor：401/业务失效码 → 先刷新重放；403 → 直接重新登录
service.interceptors.response.use(
  (res: AxiosResponse<ApiResponse>) => {
    const data = res.data

    if (isTokenInvalid(data)) {
      return handleTokenExpired(res.config)
    }

    if (data.code !== 0) {
      message.error(data.msg)
      return Promise.reject(new Error(data.msg))
    }
    return data as unknown as AxiosResponse<ApiResponse<unknown>>
  },
  (error: AxiosError<ApiResponse>) => {
    const { response, config } = error || {}
    if (response?.status === 401 && config) {
      return handleTokenExpired(config)
    }
    if (response?.status === 403) {
      logoutToLogin()
    }
    return Promise.reject(error)
  },
)

let loggingOut = false
function logoutToLogin() {
  if (loggingOut) return // 并发失败的多个请求只登出一次、只弹一次
  loggingOut = true
  message.error('登录已过期，请重新登录')
  localStorage.removeItem('fusion_accessToken')
  localStorage.removeItem('fusion_refreshToken')
  localStorage.removeItem('union_token')
  localStorage.removeItem('union_refreshToken')

  const bridge = (window as any).ThirdServiceBridge
  if (!bridge) {
    window.location.hash = '#/login'
    // hash 跳转不重载页面，复位门闩以便下次会话过期仍能登出
    setTimeout(() => {
      loggingOut = false
    }, 2000)
    return
  }

  // 容器内没有注册 /login 路由：清 token 后整页重载，让路由守卫用 URL 上的 unionToken 重新静默登录。
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

export function post(url: string, data: any, headers?: any, timeout?: number): Promise<ApiResponse> {
  return service({
    method: 'post',
    url,
    data,
    headers,
    ...(timeout ? { timeout } : {}),
  })
}

export function get(url: string, params?: any, headers?: any): Promise<ApiResponse> {
  return service({
    method: 'get',
    url,
    params,
    headers,
  })
}

export interface SsePostHandlers {
  onDelta: (delta: string) => void
  onDone?: () => void
  onError?: (err: unknown) => void
}

/**
 * 以 SSE 流式消费一个 POST 接口（EventSource 不支持 POST/自定义头，故用 fetch + ReadableStream 手动解析）。
 * 复用与 axios 相同的 baseURL 与 Bearer token。返回一个可用于中断的 abort 函数。
 * 解析后端 ServerSentEvent：event=delta 的 data 为正文增量，event=done 表示结束。
 */
export function ssePost(url: string, data: any, handlers: SsePostHandlers): () => void {
  const controller = new AbortController()
  let doneFired = false
  const fireDone = () => {
    if (doneFired) return
    doneFired = true
    handlers.onDone?.()
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
            if (curEvent === 'done') fireDone()
          }
          return
        }
        const head = line.slice(0, dataIdx)
        if (head.startsWith('event:')) curEvent = head.slice(6).trim()
        const data = line.slice(dataIdx + 5).replace(/^ /, '')
        if (curEvent === 'done') {
          fireDone()
        } else if (curEvent === 'delta' || curEvent === 'message') {
          if (data) handlers.onDelta(data)
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
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
      buffer = buffer.replace(/\r/g, '\n')
      for (const line of buffer.split('\n')) handleLine(line)
      fireDone()
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') handlers.onError?.(err)
    }
  })()

  return () => controller.abort()
}
