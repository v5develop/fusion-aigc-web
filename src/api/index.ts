import axios from 'axios'
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from './types'
import { createDiscreteApi } from 'naive-ui'
import { getUserInfo, unionTokenLogin } from '@/api/methods.ts'
import { refreshToken, getAuthToken } from '@/api/union'

const { message } = createDiscreteApi(['message'])
let isRefreshing = false
let requestQueue: { resolve: (value: any) => void; reject: (reason?: any) => void; config: InternalAxiosRequestConfig }[] = []
const refreshTokenApi = '/api/v1/auth/refresh'

const baseURL = import.meta.env.VITE_FUSION_API_BASE ?? ''
const service = axios.create({
  baseURL,
  timeout: 10000,
})

// 单航班：失效瞬间多个请求同时失败时，只调用一次桥
let refreshing: Promise<string> | null = null
async function refreshUnionToken() {
  const bridge = (window as any).ThirdServiceBridge

  // 容器内：走桥接刷新
  if (bridge?.refreshUnionToken) {
    if (!refreshing) {
      refreshing = bridge.refreshUnionToken().finally(() => {
        refreshing = null
      })
    }
    const token = await refreshing!
    const res = await unionTokenLogin({ token })
    localStorage.setItem('fusion_accessToken', res.data.accessToken)
    localStorage.setItem('fusion_refreshToken', res.data.refreshToken)
    const { code, data } = await getUserInfo()
    if (code === 0) {
      localStorage.setItem('userInfo', JSON.stringify({ avatar: data.avatar }))
    }
    return
  }

  // 独立运行：用联盟 refreshToken 刷新
  const unionRefresh = localStorage.getItem('union_refreshToken')
  if (!unionRefresh) {
    logoutToLogin()
    return Promise.reject(new Error('no union refresh token'))
  }

  if (!refreshing) {
    refreshing = (async () => {
      const newUnion = await refreshToken(unionRefresh)
      localStorage.setItem('union_token', newUnion.token)
      localStorage.setItem('union_refreshToken', newUnion.refreshToken)
      const authRes = await getAuthToken(newUnion.token)
      const res = await unionTokenLogin({ token: authRes.temp_token })
      localStorage.setItem('fusion_accessToken', res.data.accessToken)
      localStorage.setItem('fusion_refreshToken', res.data.refreshToken)
      return res.data.accessToken
    })().finally(() => {
      refreshing = null
    })
  }
  await refreshing
}

// 请求拦截：自动加 token
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('fusion_accessToken')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

const TOKEN_EXPIRED_CODES = [2001, 2002, 2003]

// 无感刷新核心逻辑，成功回调和错误回调共用
async function silentRefresh(config: InternalAxiosRequestConfig) {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      requestQueue.push({ resolve, reject, config })
    })
  }

  isRefreshing = true

  try {
    const { data } = await service.post(refreshTokenApi, {
      refreshToken: localStorage.getItem('fusion_refreshToken'),
    })
    const newAccessToken = data.data.accessToken
    const newRefreshToken = data.data.refreshToken

    localStorage.setItem('fusion_accessToken', newAccessToken)
    localStorage.setItem('fusion_refreshToken', newRefreshToken)

    requestQueue.forEach(({ resolve, config: queuedConfig }) => {
      queuedConfig.headers.Authorization = `Bearer ${newAccessToken}`
      resolve(service(queuedConfig))
    })
    requestQueue = []
    isRefreshing = false

    config.headers.Authorization = `Bearer ${newAccessToken}`
    return service(config)
  } catch {
    try {
      await refreshUnionToken()

      const freshToken = localStorage.getItem('fusion_accessToken')
      requestQueue.forEach(({ resolve, config: queuedConfig }) => {
        queuedConfig.headers.Authorization = `Bearer ${freshToken}`
        resolve(service(queuedConfig))
      })
      requestQueue = []
      isRefreshing = false

      config.headers.Authorization = `Bearer ${freshToken}`
      return service(config)
    } catch {
      requestQueue.forEach(({ reject }) => reject(new Error('token refresh failed')))
      requestQueue = []
      isRefreshing = false
      logoutToLogin()
      return Promise.reject(new Error('token refresh failed'))
    }
  }
}

// 响应拦截
service.interceptors.response.use(
  async (res: AxiosResponse<ApiResponse>) => {
    const data = res.data

    if (TOKEN_EXPIRED_CODES.includes(data.code)) {
      return await silentRefresh(res.config) as any
    }

    if (data.code !== 0) {
      message.error(data.msg)
      return Promise.reject()
    }
    return data as unknown as AxiosResponse<ApiResponse<unknown>>
  },
  async (error: AxiosError<ApiResponse>) => {
    const { response, config } = error || {}
    if (!response || response.status !== 401 || config?.url === refreshTokenApi) {
      return Promise.reject(error)
    }
    return silentRefresh(config!)
  },
)

function logoutToLogin() {
  localStorage.removeItem('fusion_accessToken')
  localStorage.removeItem('fusion_refreshToken')
  localStorage.removeItem('union_token')
  localStorage.removeItem('union_refreshToken')
  window.location.hash = '#/login'
}

export function post(url: string, data: any, headers?: any): Promise<ApiResponse> {
  return service({
    method: 'post',
    url,
    data,
    headers,
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
  const token = localStorage.getItem('fusion_accessToken')
  let doneFired = false
  const fireDone = () => {
    if (doneFired) return
    doneFired = true
    handlers.onDone?.()
  }

  ;(async () => {
    try {
      const resp = await fetch(baseURL + url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      })
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE request failed: ${resp.status}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // SSE 帧以空行分隔；逐帧解析 event 与 data 字段
      const flushFrame = (frame: string) => {
        let event = 'message'
        const dataLines: string[] = []
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
        }
        const data = dataLines.join('\n')
        if (event === 'done') {
          fireDone()
        } else if (event === 'delta' || event === 'message') {
          if (data) handlers.onDelta(data)
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          if (frame.trim()) flushFrame(frame)
        }
      }
      if (buffer.trim()) flushFrame(buffer)
      fireDone()
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') handlers.onError?.(err)
    }
  })()

  return () => controller.abort()
}
