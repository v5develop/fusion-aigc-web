/**
 * 「导航前关掉浮层」的注册表。
 *
 * 背景：n-modal / n-image 预览这类带遮罩的浮层是 Teleport 到 body 的，不在 keep-alive 的缓存子树里。
 * 标签切走后组件不卸载，遮罩就会一直盖在新标签上并吃掉全部点击，只能刷新页面才能恢复。
 *
 * 两条硬约束决定了必须在导航「之前」关：
 * 1. Vue 3.5 的 KeepAlive 会暂停失活子树的渲染 effect，等到 onDeactivated 里再改状态，DOM 不会再更新
 * 2. 还要等离场过渡真正走完，否则遮罩会停在过渡中间
 *
 * 为什么不用组件级的 onBeforeRouteLeave：同类目多开后，两个标签互切走的是同一条路由 record，
 * 只有 query.tab 变，离开守卫根本不触发。这里改挂全局 beforeEach，任何导航都覆盖得到。
 */
type OverlayCloser = () => void | Promise<void>

const closers = new Set<OverlayCloser>()

/** 注册一个关闭函数，返回注销函数（组件卸载时调用） */
export function registerOverlayCloser(closer: OverlayCloser) {
  closers.add(closer)
  return () => closers.delete(closer)
}

/** 关掉所有已注册的浮层，等它们的离场过渡走完 */
export async function closeAllOverlays() {
  if (!closers.size) return
  await Promise.all([...closers].map((closer) => closer()))
}
