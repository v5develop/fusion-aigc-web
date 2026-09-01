/**
 * 向宿主容器索取 unionToken 的公共入口（带超时与熔断）。
 *
 * <p>改造前 router 守卫与 `src/api/index.ts` 的刷新链路各有一份桥调用，且只有守卫那份
 * 做了超时保护：刷新链路里桥一旦不回调，`refreshPromise` 单航班会永久挂起，
 * 连带 `ssePost` 里 `await refreshPromise` 的流一起挂死。两边合并到这里，超时只写一次。
 */

/** 问桥的等待上限。超了就走 URL 兜底，绝不让调用方一直挂着 */
const BRIDGE_TOKEN_TIMEOUT = 3000

/**
 * 桥超时后的冷却期。冷却期内直接跳过问桥，不再白等一轮超时。
 *
 * <p>刻意不做成「一次超时就终身放弃」：URL 上那个 unionToken <b>只在首屏有效</b> ——
 * 站内导航（`Navigation` 的 `router.push(item.path)`、电商标签的
 * `router.push({ name, query: { tab } })`）都不带 `...route.query`，跳一次 query 就整个没了。
 * 永久熔断等于把唯一可靠的 token 来源永久关掉，代价远大于偶尔多等一次超时。
 */
const BRIDGE_COOLDOWN = 60_000

/** 区分「桥超时」与「桥自己抛错」：前者说明桥根本不回调，值得冷却；后者只是这一次失败 */
const BRIDGE_TIMEOUT_MARK = 'bridge timeout'

/** 上次桥超时的时刻（epoch ms），0 表示没超时过 */
let bridgeTimedOutAt = 0

/**
 * 问桥要当前有效的 unionToken。桥不存在、超时、冷却期内、或桥自己拒绝，都返回 null。
 *
 * <p>桥才是「当前有效」的那份：URL 上的是容器打开页面那一刻拼进去的，
 * 页面搁久了它可能已经过期。
 */
async function requestUnionToken(): Promise<string | null> {
  const bridge = window.ThirdServiceBridge
  if (!bridge?.refreshUnionToken) return null
  if (bridgeTimedOutAt && Date.now() - bridgeTimedOutAt < BRIDGE_COOLDOWN) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const token = await Promise.race([
      // 桥的实现可能是同步返回，统一包一层
      Promise.resolve(bridge.refreshUnionToken()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(BRIDGE_TIMEOUT_MARK)), BRIDGE_TOKEN_TIMEOUT)
      }),
    ])
    if (token) {
      // 这一次通了，说明桥活着，把冷却撤掉
      bridgeTimedOutAt = 0
      return token as string
    }
  } catch (e) {
    // 只有超时才进冷却：那说明桥不回调，短时间内再问也是白等。
    // 桥自己 reject（token 过期、宿主临时拒绝）属于这一次的失败，下次仍值得问
    if ((e as Error)?.message === BRIDGE_TIMEOUT_MARK) bridgeTimedOutAt = Date.now()
  } finally {
    // 桥先返回时把定时器撤掉，别让它空转到超时点
    clearTimeout(timer)
  }
  return null
}

/** 取 URL 上的 query 参数，兼容 history（location.search）与 hash（`#/...?k=v`）两种位置 */
function getUrlQuery(key: string): string | null {
  if (window.location.search) {
    return new URLSearchParams(window.location.search).get(key)
  }
  const hash = window.location.hash
  if (!hash.includes('?')) return null
  return new URLSearchParams(hash.slice(hash.indexOf('?'))).get(key)
}

/**
 * 进入页面那一刻 URL 上的 unionToken 快照。
 *
 * <p>必须在模块加载期抓一份：深链带来的 unionToken 只活到<b>第一次站内跳转</b>——
 * 导航栏的 `router.push(item.path)` 和电商标签的 `router.push({ name, query: { tab } })`
 * 都不带 `...route.query`，跳一次整个 query 就没了。等到 401 兜底想读时早已读不到，
 * 「URL 兜底」会退化成一句空话。
 */
const entryUnionToken = getUrlQuery('unionToken')

/**
 * 取 unionToken：桥优先，URL 兜底（当前 URL → 入口快照）。
 *
 * <p>桥才是「当前有效」的那份；URL 上的是容器打开页面那一刻拼进去的，
 * 页面搁久了可能已经过期，只配当兜底。
 */
export async function resolveUnionToken(): Promise<string | null> {
  return (await requestUnionToken()) ?? getUrlQuery('unionToken') ?? entryUnionToken
}
