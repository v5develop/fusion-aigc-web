import axios from 'axios'
import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(['message'])

const service = axios.create({
  baseURL: '',
  timeout: 10000,
})

// 请求拦截：自动加 token
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') ?? '9abbddafe6ff4347beaa871394dd14e9'
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

// 响应拦截
service.interceptors.response.use(
  (res) => {
    const data = res.data;

    if ([2001, 2002, 2003, 2004, 401].includes(data.code)) {
      // 这里可以添加 token 失效等特殊处理逻辑
      // 比如跳转到登录页
      return Promise.reject()
    }

    if (data.code !== 0) {
      message.error(data.msg)
      return Promise.reject()
    }
    return data
  },
  (err) => {
    // console.log(err.response)
    message.error('请求错误：' + err.message)
    return Promise.reject(err)
  },
)

export function post(url: string, data: any) {
  return service({
    method: 'post',
    url,
    data,
  })
}

export function get(url: string, params?: any) {
  return service({
    method: 'get',
    url,
    params,
  })
}
