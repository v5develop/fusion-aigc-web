/**
 * 受控工具（tools 注册表里标 `gated: true`）的后端可用性。
 *
 * 判据：GET /api/v1/features/image-model-configs?route=<工具路由>。后端 CompatFeaturePricingService 只在该路由的
 * 能力绑定「enabled=true」且至少一档定价存在时才出清单；绑定被运营关停 / 回滚 → 空数组。空清单 = 页面表单必然
 * 无模型可选、提交必败，所以按「不可用」处理。没有更轻的现成端点：/api/v2/features 只是静态分组标题，不反映绑定开关。
 *
 * 约定：
 * - 未知（还没探到 / 请求失败）一律按「可用」处理（列表 fail-open，免得瞬时错误把真工具藏起来、也免闪烁）；
 *   探到「不可用」后若后续请求失败，保留上一次结果。
 * - 会话内缓存，窗口重新聚焦 / 标签页可见时若距上次成功超过 5 分钟再刷新；失败 15 秒内不重试。
 * - 目前探针只认「图片别名模型」路由（后端 IMAGE_MODEL_ROUTES）。新增受控工具若不在其中，要在 probe 里补对应探针。
 */
import { reactive } from 'vue'
import { imageModelConfigs } from '@/api/tools'
import { tools } from '@/views/home/tools'

const FRESH_MS = 5 * 60_000
const RETRY_MS = 15_000

const gatedRoutes = tools.filter((t) => t.gated && t.route).map((t) => t.route as string)
/** route → 是否可用；没有键 = 未知 */
const enabledByRoute = reactive<Record<string, boolean>>({})

let lastOk = 0
let lastTry = 0
let inflight: Promise<void> | null = null
let listening = false

async function probe(route: string): Promise<boolean> {
  try {
    const res = await imageModelConfigs(route)
    enabledByRoute[route] = (res.data ?? []).length > 0
    return true
  } catch {
    return false
  }
}

/** 刷新受控工具的可用性；缓存未过期不请求，force 跳过缓存（仍并发去重） */
export function refreshToolAvailability(force = false): Promise<void> {
  if (!gatedRoutes.length) return Promise.resolve()
  // 匿名浏览公开页：探测接口要登录，没有 token 不探（按「未知 = 可用」处理，登录后聚焦 / 可见时再探）
  if (!localStorage.getItem('fusion_accessToken')) return Promise.resolve()
  if (inflight) return inflight
  const now = Date.now()
  if (!force && now - lastOk < FRESH_MS) return Promise.resolve()
  if (now - lastTry < RETRY_MS) return Promise.resolve()
  lastTry = now
  inflight = Promise.all(gatedRoutes.map(probe))
    .then((oks) => {
      if (oks.every(Boolean)) lastOk = Date.now()
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** 进入用到受控工具的页面时调用：首次探测，并挂一次聚焦 / 可见刷新（SPA 生命周期内只挂一份） */
export function useToolAvailability() {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    const onWake = () => {
      if (document.visibilityState !== 'hidden') void refreshToolAvailability()
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
  }
  void refreshToolAvailability()
  return { isRouteDisabled, withoutDisabled, withoutDisabledGroups, withoutDisabledSections }
}

/** 已知不可用才为 true；未知 / 非受控路由都为 false */
export function isRouteDisabled(route?: string): boolean {
  if (!route) return false
  return enabledByRoute[route.split('?')[0]!] === false
}

export function withoutDisabled<T extends { route?: string }>(items: T[]): T[] {
  return items.filter((i) => !isRouteDisabled(i.route))
}

/** 目录分组：去掉不可用条目，空组一并去掉 */
export function withoutDisabledGroups<G extends { entries: { route?: string }[] }>(groups: G[]): G[] {
  return groups.flatMap((g) => {
    const entries = withoutDisabled(g.entries)
    return entries.length ? [{ ...g, entries }] : []
  })
}

/** 落地页分区：去掉不可用卡片，空区一并去掉 */
export function withoutDisabledSections<S extends { tools: { route?: string }[] }>(sections: S[]): S[] {
  return sections.flatMap((s) => {
    const items = withoutDisabled(s.tools)
    return items.length ? [{ ...s, tools: items }] : []
  })
}
