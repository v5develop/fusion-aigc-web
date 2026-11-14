/**
 * 画布 mock 开关：`?mock=canvas`（或 VITE_MOCK_API / localStorage `fusion:mock-api` 里含 canvas / all）。
 *
 * <p>与 mock-switch.ts 同一个存储键、同一套写法（地址栏的值记进 localStorage，`?mock=off` 关掉），
 * 单独一个文件是因为 mock-switch.ts 的 MockName 由别的模块维护，这里不去改它的类型。
 * 打开后画布详情 / 保存 / 目录 / 变更事件 / 画布助手都走 canvas-mock.ts（动态 import，不进主包）。
 */
const KEY = 'fusion:mock-api'

/** 只有开发构建或显式 VITE_ALLOW_MOCK=true 才允许读 URL / localStorage 的 mock 开关；生产忽略并清掉旧键 */
const MOCK_ALLOWED = import.meta.env.DEV || String(import.meta.env.VITE_ALLOW_MOCK) === 'true'

function parse(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

let queryApplied = false

function applyQuery(): void {
  if (queryApplied) return
  queryApplied = true
  if (!MOCK_ALLOWED) {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // ignore
    }
    return
  }
  try {
    // hash 路由下 query 可能在 # 之后：两处都看
    const fromSearch = new URLSearchParams(window.location.search).get('mock')
    const hashQuery = window.location.hash.split('?')[1] ?? ''
    const fromHash = new URLSearchParams(hashQuery).get('mock')
    const q = fromSearch ?? fromHash
    if (q == null) return
    if (q === 'off' || q === '0' || q === '') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, q)
  } catch {
    // 无痕 / 禁用存储：本次不生效
  }
}

export function isCanvasMock(): boolean {
  applyQuery()
  if (!MOCK_ALLOWED) return false
  const sets = [parse(import.meta.env.VITE_MOCK_API)]
  try {
    sets.push(parse(localStorage.getItem(KEY)))
  } catch {
    // ignore
  }
  return sets.some((s) => s.has('all') || s.has('canvas'))
}
