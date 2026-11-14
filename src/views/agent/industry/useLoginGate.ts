/**
 * 登录半屏的全局开关与「现场」保存（agent-template-industry EXPERIENCE 2.2 第 17 步 / 3.8.7 / M-16、F-05）。
 *
 * - 浏览、选行业、看头条、看预览都匿名；需要账号的动作（点「做同款」、收藏、我的模板）才弹登录半屏（弹层，不跳页）；
 * - 点「做同款」时先把现场（模板 id、所在行业、已填入参、草稿、版数）存起来，登录后还原**并回到原位置，不自动发送**；
 * - 现场用 localStorage + sessionStorage 双写、24 小时有效：微信 / 第三方授权会换 WebView（sessionStorage 可能丢），
 *   换号登录会整页重载并按白名单清 localStorage（sessionStorage 不受影响），两处互为备份；取用一次即清。
 * - 页面里只放一个 <LoginSheet />（agent/index.vue），其它地方通过本模块请求弹出，不各自渲染。
 */
import { ref } from 'vue'
import { currentAccountId } from '@/utils/auth-session.ts'

export type LoginReason = 'pick' | 'favorite' | 'mine'

/** 当前打开的登录半屏；null = 关着 */
export const loginSheet = ref<{ reason: LoginReason; onSkip?: () => void } | null>(null)
/** 每次登录成功 +1：依赖登录态的子组件（接着做条、收藏 / 我的模板）据此重取 */
export const loginVersion = ref(0)

export function isLoggedIn(): boolean {
  try {
    return !!localStorage.getItem('fusion_accessToken')
  } catch {
    return false
  }
}

/** 已登录返回 true；未登录弹登录半屏并返回 false（onSkip = 用户点「先看看」时照常继续的动作） */
export function requireLogin(reason: LoginReason, onSkip?: () => void): boolean {
  if (isLoggedIn()) return true
  loginSheet.value = { reason, onSkip }
  return false
}

export function closeLoginSheet() {
  loginSheet.value = null
}

// ---------------- 现场 ----------------

const SCENE_KEY = 'fusion:plaza-login-scene'
const SCENE_TTL_MS = 24 * 3600 * 1000

export interface IPlazaScene {
  templateId: number
  scope: { industry: string; subIndustry?: string } | null
  /** 槽位值（只存可 JSON 化的；放图位登录后才能放，所以这里不会有图） */
  values?: Record<string, unknown>
  draft?: string
  variants?: number
  /** 写入时间（毫秒） */
  ts: number
  /** 存现场时的账号（匿名为空串）：恢复时账号不同就丢弃，匿名存的不比 */
  accountId?: string
}

export function saveScene(scene: Omit<IPlazaScene, 'ts' | 'accountId'>) {
  const raw = JSON.stringify({ ...scene, ts: Date.now(), accountId: currentAccountId() || '' } satisfies IPlazaScene)
  try {
    localStorage.setItem(SCENE_KEY, raw)
  } catch {
    // 无痕 / 配额满：靠 sessionStorage
  }
  try {
    sessionStorage.setItem(SCENE_KEY, raw)
  } catch {
    // ignore
  }
}

function readScene(): IPlazaScene | null {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      const raw = store().getItem(SCENE_KEY)
      if (!raw) continue
      const v = JSON.parse(raw) as IPlazaScene
      if (v && Number.isFinite(v.templateId) && Date.now() - (v.ts ?? 0) <= SCENE_TTL_MS) return v
    } catch {
      // 坏数据当没有
    }
  }
  return null
}

export function clearScene() {
  try {
    localStorage.removeItem(SCENE_KEY)
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(SCENE_KEY)
  } catch {
    // ignore
  }
}

/**
 * 取出现场（只取一次：取到就清，无论能不能用都清）；过期 / 没有返回 null。
 * 存现场时有账号（非匿名）且恢复时的账号不同 → 丢弃不恢复（别把 A 的草稿放进 B 的输入框）；存时为匿名则不比。
 */
export function takeScene(): IPlazaScene | null {
  const v = readScene()
  clearScene()
  if (!v) return null
  const now = currentAccountId()
  if (v.accountId && now && v.accountId !== now) return null
  return v
}

export function hasScene(): boolean {
  return readScene() !== null
}
