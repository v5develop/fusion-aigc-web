import { createRouter, createWebHashHistory } from 'vue-router'
import { unionTokenLogin } from '@/api/methods.ts'
import { ensureModelCatalog } from '@/utils/modelCatalog'
import { closeAllOverlays } from '@/utils/overlayGuard'
import eCommerceRouter from './e-commerce'

const hasBridge = !!(window as any).ThirdServiceBridge

/** 问桥要 token 的等待上限。超了就走 URL 兜底，绝不让导航一直挂着 */
const BRIDGE_TOKEN_TIMEOUT = 3000

/** 桥卡死过一次就别再问：否则此后<b>每次</b>无 token 的导航都要白等一轮超时 */
let bridgeTokenGaveUp = false

/** 区分「桥超时」与「桥自己抛错」，两者的后续策略不同 */
const BRIDGE_TIMEOUT_MARK = 'bridge timeout'

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

// 导航前先关掉 Teleport 在 body 上的遮罩浮层。
// 挂全局而不是组件级 onBeforeRouteLeave：同类目多开后两个标签互切是同一条 record，
// 离开守卫不触发，遮罩会残留下来盖住新标签。详见 utils/overlayGuard.ts
router.beforeEach(async () => {
  await closeAllOverlays()
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

  // 如果没有 token，进行静默登录
  if (!token) {
    // 独立运行时（不在 APP 容器内），跳转登录页
    if (!(window as any).ThirdServiceBridge) {
      if (to.name !== 'login') {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
      return
    }

    // 静默登录失败不阻断导航（拦截器已提示），放行后由请求层的 401 刷新流程接管
    try {
      const unionToken = await resolveUnionToken()
      // 两个来源都空就别发这一枪：必然 401，白等一个来回。直接放行，
      // 由请求层的刷新流程接管（它会再问一次桥，那时可能已经就绪）
      if (unionToken) {
        const res = await unionTokenLogin({ token: unionToken })
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

/**
 * 容器内取 unionToken：<b>优先问桥，URL 兜底</b>。
 *
 * <p>桥才是「当前有效」的那份：URL 上的 unionToken 是容器打开页面那一刻拼进去的，
 * 页面在后台搁久了、或容器复用同一个 WebView 再次进来时它已经过期，
 * 拿它登录必失败，要绕一圈 401 → 桥刷新 才恢复——首屏白等一个来回。
 *
 * <p>超时不是防慢、是防<b>不回调</b>：桥后面是原生实现，一旦它不 resolve，
 * 守卫里的 await 会把这次导航永久挂起，整个首屏白屏，比登录失败严重得多。
 * 超时就退回 URL 那条老路。
 */
async function resolveUnionToken(): Promise<string | null> {
  const bridge = (window as any).ThirdServiceBridge
  if (bridge?.refreshUnionToken && !bridgeTokenGaveUp) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const token = await Promise.race([
        Promise.resolve(bridge.refreshUnionToken()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(BRIDGE_TIMEOUT_MARK)), BRIDGE_TOKEN_TIMEOUT)
        }),
      ])
      if (token) return token as string
    } catch (e) {
      // 只有<b>超时</b>才放弃后续尝试：那说明桥根本不回调，再问多少次都是白等一轮。
      // 桥自己 reject 属于这一次的失败（token 过期、宿主临时拒绝），下次仍值得问
      if ((e as Error)?.message === BRIDGE_TIMEOUT_MARK) bridgeTokenGaveUp = true
    } finally {
      // 桥先返回时把定时器撤掉，别让它空转到超时点
      clearTimeout(timer)
    }
  }
  return getUrlQuery('unionToken')
}

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
