import { createRouter, createWebHashHistory } from 'vue-router'
import { login, unionTokenLogin } from '@/api/methods.ts'
import { ensureModelCatalog } from '@/utils/modelCatalog'
import eCommerceRouter from './e-commerce'

const hasBridge = !!(window as any).ThirdServiceBridge

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    ...(!hasBridge
      ? [
          {
            path: '/login',
            name: 'login',
            component: () => import('@/views/login/index.vue'),
          },
        ]
      : []),
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
router.beforeEach(async (to) => {
  // 检查 localStorage 中是否有 token
  const token = localStorage.getItem('fusion_accessToken')

  // 已登录即预热模型目录（模块内做了单飞与失败重试，重复导航不会重复请求）。
  // 不 await：模型列表只影响下拉渲染，让它挡住导航等于把首屏卡在一个非关键请求上。
  if (token) {
    void ensureModelCatalog().catch(() => {
      // 忽略：失败不缓存，下次导航会重试；期间下拉为空而非展示不可用模型
    })
  }

  // 如果没有 token，进行模拟登录
  if (!token) {
    const unionToken = getUrlQuery('unionToken')
    const baseURL = import.meta.env.VITE_FUSION_API_BASE ?? ''

    // 独立运行时（不在 APP 容器内），跳转登录页
    if (!(window as any).ThirdServiceBridge) {
      if (to.name !== 'login') {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
      return
    }

    // 静默登录失败不阻断导航（拦截器已提示），放行后由请求层的 401 刷新流程接管
    try {
      if (!!baseURL) {
        const res = await unionTokenLogin({ token: unionToken! })
        if (res.code === 0) {
          localStorage.setItem('fusion_accessToken', res.data.accessToken)
          localStorage.setItem('fusion_refreshToken', res.data.refreshToken)
        }
      } else {
        const res = await login({
          username: 'adad',
          password: 'admin123',
        })
        if (res.code === 0) {
          localStorage.setItem('fusion_accessToken', res.data.accessToken)
          localStorage.setItem('fusion_refreshToken', res.data.refreshToken)
        }
      }
    } catch {
      // 忽略：token 缺失时后续请求会走 401 → 刷新/登出 流程
    }
    // 静默登录刚拿到 token：这次导航开头那道预热被 !token 跳过了，补一次，
    // 否则首屏落在生成页时模型下拉是空的，要等用户再切一次路由才填上。
    if (localStorage.getItem('fusion_accessToken')) {
      void ensureModelCatalog().catch(() => {})
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
