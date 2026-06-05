import axios from 'axios'
import type { AxiosResponse, AxiosError } from 'axios'
import type { ApiResponse } from './types'
import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(['message'])
let isRefreshing = false // 刷新锁：防止并发刷新
let requestQueue: any[] = []    // 请求队列：缓存过期的请求
const refreshTokenApi = '/api/v1/auth/refresh'

const service = axios.create({
  baseURL: '',
  timeout: 10000,
})

// 请求拦截：自动加 token
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('fusion_accessToken')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

// 响应拦截
service.interceptors.response.use(
  (res: AxiosResponse<ApiResponse>) => {
    const data = res.data

    // 这里可以添加 token 失效等特殊处理逻辑
    // if ([2001, 2002, 2003, 2004].includes(response.code)) {
    //   clearToken()
    //   router.push('/login')
    //   return
    // }

    if (data.code !== 0) {
      message.error(data.msg)
      return Promise.reject()
    }
    return data as unknown as AxiosResponse<ApiResponse<unknown>>
  },
  async (error: AxiosError<ApiResponse>) => {
    const { response, config } = error || {}
      if (!response || response.status !== 401 || config?.url === refreshTokenApi) {
        if (config?.url === '/api/refresh-token') {
          logoutToLogin()
        }
        return Promise.reject(error)
      }
    // 401 = AccessToken 过期 → 开始无感刷新
    try {
      if (isRefreshing) {
        // 🔥 正在刷新：把当前请求加入队列，等待刷新完成后重试
        return new Promise((resolve) => {
          requestQueue.push((newToken: string) => {
            config!.headers.Authorization = `Bearer ${newToken}`
            resolve(service(config!))
          })
        })
      }

      // 🔥 加锁，开始刷新 Token
      isRefreshing = true

      // 调用后端刷新接口
      const { data } = await axios.post(refreshTokenApi, {
        refreshToken: localStorage.getItem('fusion_refreshToken'),
      })
      const newAccessToken = data.data.accessToken
      const newRefreshToken = data.data.refreshToken

      // 保存新 Token
      localStorage.setItem('fusion_accessToken', newAccessToken)
      localStorage.setItem('fusion_refreshToken', newRefreshToken)

      // 🔥 刷新成功：执行队列里所有请求
      requestQueue.forEach((cb) => cb(newAccessToken))
      // 清空队列 + 解锁
      requestQueue = []
      isRefreshing = false

      // 重试当前失败的请求
      config!.headers.Authorization = `Bearer ${newAccessToken}`
      return service(config!)
    } catch (err) {
      // 【3】刷新 Token 彻底失败 = 登录过期
      logoutToLogin()
      requestQueue = []
      isRefreshing = false
      return Promise.reject(err)
    }
  },
)

function logoutToLogin() {
  localStorage.removeItem('fusion_accessToken')
  localStorage.removeItem('fusion_refreshToken')
  // 跳转到登录（根据你的项目改）
  // window.location.href = '/login'
}

export function post(url: string, data: any): Promise<ApiResponse> {
  return service({
    method: 'post',
    url,
    data,
  })
}

export function get(url: string, params?: any): Promise<ApiResponse> {
  return service({
    method: 'get',
    url,
    params,
  })
}
