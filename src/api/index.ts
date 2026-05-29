import axios from 'axios'

const service = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// 请求拦截：自动加 token
service.interceptors.request.use((config) => {
  // const token = localStorage.getItem('token')
  // if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

// 响应拦截
service.interceptors.response.use(
  (res) => res.data,
  (err) => {
    alert('请求错误：' + err.message)
    return Promise.reject(err)
  },
)

export default {
  post(url: string, data: any) {
    return service({
      method: 'post',
      url,
      data,
    })
  },
  get(url: string, params?: any) {
    return service({
      method: 'get',
      url,
      params,
    })
  },
}
