import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { login, unionTokenLogin, getUserInfo } from '@/api/methods.ts'
import eCommerceRouter from './e-commerce'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/views/layout/index.vue'),
      children: [
        {
          path: '/',
          name: 'home',
          component: () => import('@/views/home/index.vue'),
        },
        {
          path: '/picture',
          name: 'picture',
          component: () => import('@/views/picture/index.vue'),
        },
        {
          path: '/video',
          name: 'video',
          component: () => import('@/views/video/index.vue'),
        },
        ...eCommerceRouter,
        {
          path: '/asset',
          name: 'asset',
          component: () => import('@/views/asset/index.vue'),
        },
      ],
    },
  ],
})

// 路由守卫：登录验证
router.beforeEach(async (to, from) => {
  // 检查 localStorage 中是否有 token
  const token = localStorage.getItem('fusion_accessToken')

  // 如果没有 token，进行模拟登录
  if (!token) {
    const unionToken = getUrlQuery('unionToken')
    const baseURL = import.meta.env.PROD ? 'https://aigc.pengqiwl.com' : 'A'
    if (!!baseURL) {
      await unionTokenLogin({ token: unionToken! }).then((res) => {
        if (res.code === 0) {
          localStorage.setItem('fusion_accessToken', res.data.accessToken)
          localStorage.setItem('fusion_refreshToken', res.data.refreshToken)
        }
      })
    } else {
      await login({
        username: 'adad',
        password: 'admin123',
      }).then((res) => {
        if (res.code === 0) {
          localStorage.setItem('fusion_accessToken', res.data.accessToken)
          localStorage.setItem('fusion_refreshToken', res.data.refreshToken)
        }
      })
    }

  }
})

function getUrlQuery(key: string): string | null {
  // history模式：参数在location.search
  if (window.location.search) {
    return new URLSearchParams(window.location.search).get(key)
  }
  // hash模式：参数在#内
  const hash = window.location.hash
  if (!hash.includes('?')) return null
  const searchStr = hash.slice(hash.indexOf('?'))
  return new URLSearchParams(searchStr).get(key)
}


export default router

