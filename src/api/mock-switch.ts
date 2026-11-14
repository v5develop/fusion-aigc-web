/**
 * 后端尚未就绪的接口的本地 mock 开关（只在 api 层判断，页面代码不感知）。
 *
 * <p>打开方式（任选其一，名字用逗号分隔，`all` = 全部）：
 * - 构建期：`.env.local` 写 `VITE_MOCK_API=plaza,replicate`；
 * - 运行期：地址栏带 `?mock=plaza,replicate`（会记到 localStorage，之后刷新仍生效），`?mock=off` 关掉；
 * - 控制台：`localStorage.setItem('fusion:mock-api', 'all')`。
 *
 * <p>默认全关：关闭时一律走真实接口，mock 代码不参与（动态 import，不进主包）。
 */
export type MockName = 'plaza' | 'replicate' | 'asset'

const KEY = 'fusion:mock-api'

/** 只有开发构建或显式 VITE_ALLOW_MOCK=true 才允许读 URL / localStorage 的 mock 开关；生产忽略并清掉旧键 */
const MOCK_ALLOWED = import.meta.env.DEV || String(import.meta.env.VITE_ALLOW_MOCK) === 'true'

function purgeStored(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

function parse(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

function fromQuery(): void {
  if (!MOCK_ALLOWED) return purgeStored()
  try {
    const q = new URLSearchParams(window.location.search).get('mock')
    if (q == null) return
    if (q === 'off' || q === '0' || q === '') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, q)
  } catch {
    // 无痕 / 禁用存储：本次不生效，不影响页面
  }
}

let queryApplied = false

export function isMock(name: MockName): boolean {
  if (!queryApplied) {
    queryApplied = true
    fromQuery()
  }
  if (!MOCK_ALLOWED) return false
  const sets = [parse(import.meta.env.VITE_MOCK_API)]
  try {
    sets.push(parse(localStorage.getItem(KEY)))
  } catch {
    // ignore
  }
  return sets.some((s) => s.has('all') || s.has(name))
}
