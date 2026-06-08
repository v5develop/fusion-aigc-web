import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { login } from '@/api/methods.ts'
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
})

export default router
