/**
 * 全站「页面渲染失败」兜底的共享状态。
 *
 * <p>两个来源：1) 路由懒加载失败（发版后旧 chunk 404 / 断网），由 router.onError 记下；
 * 2) 页面渲染 / 生命周期里抛错，由 RouteErrorBoundary（onErrorCaptured）记下。
 * 展示统一用 PageLoadError（标题「页面渲染失败」+ 错误摘要 + 「重新加载」）。
 */
import { ref } from 'vue'

/** 最近一次路由加载失败的摘要；导航成功（afterEach）后清空 */
export const routeLoadFailure = ref('')

const CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
]

/** 是不是动态 import / 分包加载失败 */
export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null
  const text = `${typeof e?.name === 'string' ? e.name : ''} ${typeof e?.message === 'string' ? e.message : String(err ?? '')}`
  return CHUNK_PATTERNS.some((p) => p.test(text))
}

/** 错误摘要：一行、≤200 字，不带堆栈（堆栈只进控制台） */
export function summarizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : String(err ?? '未知错误')
  const line = (raw.split('\n')[0] ?? '').trim()
  return line.length > 200 ? `${line.slice(0, 200)}…` : line || '未知错误'
}

export function reloadPage() {
  window.location.reload()
}
