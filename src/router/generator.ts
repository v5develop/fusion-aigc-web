// /image、/video 现在是导航首页；通用生图 / 生视频页挪到 /image/generate、/video/generate。
// 入口参数（容器深链 entryCode、做同款 sameStyleId/sameStyleSource、从首页带入表单）仍可写在 /image?…、/video?… 上，
// 由这个全局守卫原样（query + hash）转过去，书签与站外链接照常可开。
//
// 用全局 beforeEach 而不是路由的 beforeEnter：已经停在 /image 时只改 query / hash（容器宿主改 hash、
// 用户在地址栏补参数），beforeEnter 不会再执行，页面会停在导航首页。
// 返回值不带 replace：守卫重定向会沿用原导航的 push / replace，带上 replace 会把来源页从历史里挤掉，
// 返回键回不到「做同款」所在的页面。
import type { RouteLocationNormalized } from 'vue-router'
import { useHomeStore } from '@/stores/home'
import { hasRefill } from '@/utils/refillHandoff'

const GENERATOR_QUERY_KEYS = ['entryCode', 'sameStyleId', 'sameStyleSource'] as const
const TARGET: Record<string, string> = { image: '/image/generate', video: '/video/generate' }

function isGeneratorEntry(query: RouteLocationNormalized['query']): boolean {
  return GENERATOR_QUERY_KEYS.some((k) => query[k] != null && query[k] !== '')
}

/** 全局守卫：去 /image、/video 且带生成页入口参数（或首页带入了表单）时，转到对应生成页 */
export function generatorRedirect(to: RouteLocationNormalized) {
  const target = typeof to.name === 'string' ? TARGET[to.name] : undefined
  if (!target) return true
  // 首页带入的表单只在进场那一刻有效（生成页 setup 会 reset），所以在这里判
  if (isGeneratorEntry(to.query) || useHomeStore().global_formData.home) {
    return { path: target, query: to.query, hash: to.hash }
  }
  return true
}

// 工具页里的商拍换装 / 姿态复刻是简版，商拍工作室的完整版才是正式页面：老链接原样（query + hash）转过去。
// 例外：任务中心对这两个工具的老任务「做同款 / 参数回填」交接的是简版工具的提交体，工作室读不了，
// 这时放行到简版工具页，让它照常回填（交接 2 分钟内有效，过期就照常转走）。
const STUDIO_TOOL: Record<string, { target: string; historyTitle: string }> = {
  '/tools/ai-digital-model': { target: '/studio/ai-digital-model', historyTitle: 'ai-model-tryon' },
  '/tools/ai-posture-fission': { target: '/studio/ai-posture-fission', historyTitle: 'ai-posture-fission' },
}

export function studioToolRedirect(to: RouteLocationNormalized) {
  const hit = STUDIO_TOOL[to.path]
  if (!hit || hasRefill('tool', hit.historyTitle)) return true
  return { path: hit.target, query: to.query, hash: to.hash }
}
