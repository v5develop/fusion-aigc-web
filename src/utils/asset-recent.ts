/**
 * 资产选择器「最近」：本机最近选过的资产，按账号隔离存 localStorage。
 *
 * <p>key 带账号指纹（取自 fusion accessToken，用户 store 里没有 id），换号不会串；
 * 登出时清当前账号那份；资产被删除后同步剔除，免得「最近」里留着已删素材。
 * 不依赖任何请求模块，api/index.ts 可直接引用而不构成循环。
 */
import { identityOf } from '@/utils/auth-session.ts'

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
  let who = ''
  try {
    const token = localStorage.getItem('fusion_accessToken')
    who = (token && identityOf(token)) || ''
  } catch {
    /* 取不到身份：落到匿名 key，登出时同样会清 */
  }
  return who ? `${RECENT_PREFIX}:${who}` : RECENT_PREFIX
}

export function readRecentAssets(): IRecentAsset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey()) || '[]')
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

/** 登出：清当前账号的「最近」（要在 token 被移除之前调用，才能算对 key） */
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
