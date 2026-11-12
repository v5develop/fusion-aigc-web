import { createRouter, createWebHashHistory } from 'vue-router'
import { ensureModelCatalog } from '@/utils/model-catalog'
import { closeAllOverlays } from '@/utils/overlay-guard'
import { resolveUnionToken } from '@/utils/union-bridge'
import { exchangeUnionToken } from '@/api'
import { markAccountVerified } from '@/utils/auth-session'
import eCommerceRouter from './e-commerce'
import localLifeRouter from './local-life'
import toolsRouter from './tools'
import assetLibraryRouter from './asset-library'
import taskCenterRouter from './task-center'
import studioRouter from './studio'
import workflowRouter from './workflow'
import { generatorRedirect, studioToolRedirect } from './generator'
import { isChunkLoadError, routeLoadFailure, summarizeError } from '@/utils/render-failure'

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
    // 智能体会话分享页：免登录（GET /api/v1/agent/messages/share 凭 token 读），不挂布局
    {
      path: '/agent/share',
      name: 'agent-share',
      meta: { title: '智能体对话分享', public: true },
      component: () => import('@/views/agent/share.vue'),
    },
    {
      path: '/',
      component: () => import('@/views/layout/index.vue'),
      children: [
        // 默认落地 = AI 图片（/image），工具箱仍在 /tools；
        // 根路径 / 重定向过来：登录回跳、书签与容器初始地址都还写着 /
        { path: '/', redirect: '/image' },
        {
          path: '/tools',
          name: 'home',
          component: () => import('@/views/home/index.vue'),
        },
        {
          path: '/image',
          name: 'image',
          meta: { title: 'AI 图片' },
          component: () => import('@/views/image/index.vue'),
        },
        {
          path: '/image/generate',
          name: 'image-generate',
          meta: { title: '图片生成' },
          component: () => import('@/views/image/PictureGenerator.vue'),
        },
        {
          path: '/video',
          name: 'video',
          meta: { title: 'AI 视频' },
          component: () => import('@/views/video/index.vue'),
        },
        {
          path: '/video/generate',
          name: 'video-generate',
          meta: { title: '视频生成' },
          component: () => import('@/views/video/VideoGenerator.vue'),
        },
        ...eCommerceRouter,
        ...localLifeRouter,
        ...toolsRouter,
        ...assetLibraryRouter,
        ...taskCenterRouter,
        ...studioRouter,
        ...workflowRouter,
        {
          path: '/plaza',
          name: 'plaza',
          meta: { title: '创意广场' },
          component: () => import('@/views/plaza/index.vue'),
        },
        {
          path: '/agent',
          name: 'agent',
          meta: { title: '智能体' },
          component: () => import('@/views/agent/index.vue'),
        },
        {
          path: '/asset',
          name: 'asset',
          component: () => import('@/views/asset/index.vue'),
        },
        {
          path: '/user-center',
          name: 'user-center',
          meta: { title: '用户中心' },
          component: () => import('@/views/user-center/index.vue'),
        },
        // 兜底：不认识的地址显示「页面不存在」而不是悄悄跳走，错链才看得见。
        // 登录守卫是全局 beforeEach，照常先于它执行（未登录的错链仍先去登录）
        {
          path: '/:pathMatch(.*)*',
          name: 'not-found',
          meta: { title: '页面不存在' },
          component: () => import('@/views/not-found/index.vue'),
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
  // 容器内冷启动：无条件用宿主<b>当前</b>的 unionToken 重换一次 fusion token。
  // 不能沿用改造前的「本地没 token 才登录」——本地那份可能属于宿主上一个账号，
  // 而它「还没过期」恰恰是最坏的情况：不校验就一路用旧账号跑下去，
  // 积分、素材、电商标签全是别人的，直到 token 自然过期才可能被发现
  await ensureBootAuth()

  // 检查 localStorage 中是否有 token
  const token = localStorage.getItem('fusion_accessToken')

  // 已登录即预热模型目录（模块内做了单飞与失败重试，重复导航不会重复请求）。
  // 不 await：模型列表只影响下拉渲染，让它挡住导航等于把首屏卡在一个非关键请求上。
  if (token) {
    void ensureModelCatalog().catch(() => {
      // 忽略：失败不缓存，下次导航会重试；期间下拉为空而非展示不可用模型
    })
    return
  }

  // 没有 token 且不在容器内：跳登录页走短信登录
  if (!hasBridge) {
    if (to.name !== 'login' && !to.meta.public) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }
    return
  }
  // 容器内走到这里说明 ensureBootAuth 没换到 token（桥超时 + URL 也没有、或接口失败）。
  // 不阻断导航：放行后由请求层的 401 刷新流程接管，它会再问一次桥，那时可能已经就绪
})

/**
 * 本次页面加载是否已经做过换号校验。
 *
 * <p>只做一次就够，前提是<b>宿主每次进 AIGC 都整页重新加载页面</b>（带新 unionToken 的 URL）。
 * 若宿主哪天改成复用 WebView、不重载就换账号，这里必须补一套
 * visibilitychange / focus 的运行期检测，否则换号又会检测不到。
 */
let bootAuthChecked = false

/**
 * 容器内冷启动的换号校验：拿宿主当前的 unionToken 重换 fusion token，指纹变了就清掉旧账号缓存。
 *
 * <p><b>必须 await、必须在 beforeEach 里做</b>，这是正确性要求不是保守：
 * 清 localStorage 得赶在任何人读它之前。全部路由组件都是懒加载，动态 import 发生在守卫跑完
 * 之后的导航解析阶段，所以此刻 `useEcTabsStore` / `useSessionIdStore` / `useUserInfoStore`
 * 都还没实例化，`CustomModelNotice/useData.ts` 那个模块顶层的 getItem 也还没求值。
 * 一旦挪到 beforeResolve 或组件内部，就会变成「清了 localStorage 但内存里还是旧账号」。
 */
async function ensureBootAuth() {
  if (!hasBridge || bootAuthChecked) return
  bootAuthChecked = true

  const unionToken = await resolveUnionToken()
  // 两个来源都空就别发这一枪：必然 401，白等一个来回
  if (!unionToken) return

  try {
    // 用裸请求版而不是 methods 里那个走拦截器的 unionTokenLogin：本地那份 token 可能
    // 已属于上一个账号且过期，带着它请求会被拦截器判成令牌失效，凭空拽出一条刷新链。
    // 它内部完成「判换人 → 清旧账号缓存 → 落 token → 记指纹」的完整时序
    const { switched } = await exchangeUnionToken(unionToken)
    // 本地 token 已确定属于宿主当前账号。没走到这一行（桥超时、接口失败）时标记保持 false，
    // 请求层的刷新链路会据此改走联盟侧，不再拿可能属于旧账号的 refreshToken 去续期
    markAccountVerified()
    if (switched) {
      console.info('[auth] 检测到宿主已换账号，已清空上一个账号的本地缓存')
    }
  } catch {
    // 换取失败（接口 5xx、断网）：保留现有 token 放行，交给请求层 401 兜底。
    // 绝不能因为这一枪失败就清 token —— 那等于把一次网络抖动变成强制登出
  }
}

// 路由懒加载失败（发版后旧分包 404、断网）：导航会被取消，页面停在原处没有任何反馈。
// 记下摘要交给 layout 的错误边界显示「页面渲染失败 / 重新加载」；其它路由错误只记日志
router.onError((err, to) => {
  console.error('[router] 导航出错', to?.fullPath, err)
  if (isChunkLoadError(err)) routeLoadFailure.value = summarizeError(err)
})
router.afterEach((_to, _from, failure) => {
  if (!failure) routeLoadFailure.value = ''
})

// 入口参数 /image?entryCode=…、/video?… 转到生成页（排在登录守卫之后；见 generator.ts）
router.beforeEach(generatorRedirect)
router.beforeEach(studioToolRedirect)

export default router
