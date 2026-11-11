/**
 * 资产选择器「最近」：本机最近选过的资产，按账号隔离存 localStorage。
 *
 * <p>key 带账号 id（auth-session 的 currentAccountId，即后端用户 id），换号不会串；
 * 登出时清当前账号那份；资产被删除后同步剔除，免得「最近」里留着已删素材。
 * 不依赖任何请求模块，api/index.ts 可直接引用而不构成循环。
 */
import { currentAccountId } from '@/utils/auth-session.ts'

export interface IRecentAsset {
  id: string
  url: string
  media: 'image' | 'video'
  title: string
  /** 封面图（视频必备，用来代替 <video preload=metadata>） */
  poster?: string
}

const RECENT_PREFIX = 'xq-asset-recent'
export const RECENT_MAX = 30
const isHttp = (url: string) => /^https?:\/\//i.test(url)

function recentKey(): string {
  // 取不到身份（老会话还没拉到用户信息）：落到匿名 key，登出时同样会清
  const who = currentAccountId()
  return who ? `${RECENT_PREFIX}:${who}` : RECENT_PREFIX
}

/**
 * 匿名 key 里的记录并入当前账号：身份修好之前账号 id 恒为空，所有「最近」都落在匿名 key；
 * 身份未知窗口（老会话还没拉到用户信息）写的也在这里。匿名 key 在登出（clearRecentAssets）和换号
 * （resetAccountScope 白名单清理）时都会被清，所以里面的记录只可能属于当前 token 的主人，并过来不会串号。
 * 只在账号自己那份还不存在时并入，不覆盖。
 */
function adoptAnonymous(key: string) {
  if (key === RECENT_PREFIX) return
  const anon = localStorage.getItem(RECENT_PREFIX)
  if (anon == null) return
  if (localStorage.getItem(key) == null) localStorage.setItem(key, anon)
  localStorage.removeItem(RECENT_PREFIX)
}

export function readRecentAssets(): IRecentAsset[] {
  try {
    const key = recentKey()
    adoptAnonymous(key)
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r.url === 'string' && isHttp(r.url) && (r.media === 'image' || r.media === 'video'))
      .map((r) => ({
        id: String(r.id ?? ''),
        url: r.url,
        media: r.media,
        title: String(r.title ?? ''),
        ...(typeof r.poster === 'string' && isHttp(r.poster) ? { poster: r.poster } : {}),
      }))
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

export function writeRecentAssets(list: IRecentAsset[]) {
  try {
    localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {
    /* 隐私模式 / 配额：最近只是便利功能，忽略 */
  }
}

/** 登出：清当前账号的「最近」（key 按账号 id 算，登出不清 id，调用先后不影响） */
export function clearRecentAssets() {
  try {
    localStorage.removeItem(recentKey())
    localStorage.removeItem(RECENT_PREFIX)
  } catch {
    /* ignore */
  }
}

/** 资产删除后剔除：按资产 id 或地址匹配 */
export function removeRecentAssets(ids: Array<number | string>, urls: string[] = []) {
  const idSet = new Set(ids.map(String))
  const urlSet = new Set(urls.filter(Boolean))
  const list = readRecentAssets()
  const next = list.filter((r) => !idSet.has(r.id) && !urlSet.has(r.url))
  if (next.length !== list.length) writeRecentAssets(next)
}
