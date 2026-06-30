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
