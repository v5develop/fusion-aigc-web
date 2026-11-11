/**
 * 「外观」偏好：浅色 / 深色 / 跟随系统 / 按时间（白天浅色、夜间深色），按账号存本机，挂载前套上（无闪烁）。
 *
 * <p>与「字体显示」（src/utils/textPrefs.ts）同一套存法：key 带账号 id（auth-session 的 currentAccountId），
 * 身份未知时改动先记在内存、身份一到落到该账号名下；别的标签页改动经 storage 事件同步。
 * 另外多存一份<b>本机最近一次</b>的设置（`xq-theme-device`）：没登录 / 身份未知时（登录页、老会话刚进站）
 * 用它，深色用户退出后看到的登录页不会突然变白。主题不涉及隐私，这份不按账号分。
 *
 * <p>落地：只在 `<html>` 上写 `data-theme="light|dark"`，颜色全部是 CSS 变量（src/theme/tokens.ts），
 * Naive 的主题由 App.vue 读 {@link activeTheme} 响应式切换。
 *
 * <p><b>首帧</b>：index.html 里有一段内联脚本先写好 data-theme（JS 模块加载前就生效），本模块在 main.ts 挂载前再算一遍并接管。
 * 两边的判定是同一个函数（src/theme/theme-decide.ts 的 decideTheme，构建期把源码嵌进 HTML），不会各改各的。
 */
import { nextTick, ref } from 'vue'
import type { ThemeName } from '@/theme/tokens.ts'
import { decideTheme, THEME_DEVICE_KEY, THEME_PREFS_KEY_PREFIX } from '@/theme/theme-decide.ts'
import { currentAccountId, onAccountChange } from '@/utils/auth-session.ts'

export type { ThemeName }
export type ThemeMode = 'light' | 'dark' | 'system' | 'schedule'

export interface ThemePrefs {
  mode: ThemeMode
  /** 按时间模式：这个时刻起切浅色（HH:MM，24 小时制） */
  dayStart: string
  /** 按时间模式：这个时刻起切深色 */
  nightStart: string
}

export const THEME_MODES: { value: ThemeMode; label: string; desc: string }[] = [
  { value: 'light', label: '浅色', desc: '始终使用浅色界面' },
  { value: 'dark', label: '深色', desc: '始终使用深色界面，夜间与暗环境更护眼' },
  { value: 'system', label: '跟随系统', desc: '与电脑的外观设置保持一致，系统切换时自动跟着变' },
  { value: 'schedule', label: '按时间', desc: '白天浅色、夜间深色，到点自动切换' },
]

export const DEFAULT_THEME_PREFS: Readonly<ThemePrefs> = { mode: 'light', dayStart: '07:00', nightStart: '19:00' }

/**
 * THEME_PREFS_KEY_PREFIX：auth-session 换号清缓存时保留（key 本身带账号 id，不会串号）；
 * THEME_DEVICE_KEY：本机最近一次设置（身份未知时用），auth-session 把它当设备级 key，换号也留着。
 * 定义在 theme-decide.ts，首帧内联脚本读的是同一组 key。
 */
export { THEME_DEVICE_KEY, THEME_PREFS_KEY_PREFIX }

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutesOf(hhmm: string, fallback: number): number {
  const m = TIME_RE.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}

function normalize(raw: unknown): ThemePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ThemePrefs>
  const mode = THEME_MODES.some((m) => m.value === r.mode) ? (r.mode as ThemeMode) : DEFAULT_THEME_PREFS.mode
  const dayStart = typeof r.dayStart === 'string' && TIME_RE.test(r.dayStart) ? r.dayStart : DEFAULT_THEME_PREFS.dayStart
  const nightStart =
    typeof r.nightStart === 'string' && TIME_RE.test(r.nightStart) ? r.nightStart : DEFAULT_THEME_PREFS.nightStart
  return { mode, dayStart, nightStart }
}

/* ---------------- 判定 ---------------- */

const systemQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

const minutesNow = (now: Date) => now.getHours() * 60 + now.getMinutes()

/** 按时间模式下 now 落在白天吗（起止相同 = 全天浅色；白天跨午夜也支持，如 20:00 起浅色、06:00 起深色） */
export function isDaytime(p: Pick<ThemePrefs, 'dayStart' | 'nightStart'>, now = new Date()): boolean {
  return decideTheme({ ...p, mode: 'schedule' }, false, minutesNow(now)) === 'light'
}

/** 偏好 → 此刻该用的主题（与 index.html 首帧脚本是同一个 decideTheme） */
export function resolveTheme(p: ThemePrefs, now = new Date()): ThemeName {
  return decideTheme(p, !!systemQuery?.matches, minutesNow(now))
}

/** 距下一个切换点的毫秒数（按时间模式定时器用） */
function msToNextBoundary(p: ThemePrefs, now = new Date()): number {
  const t = now.getHours() * 60 + now.getMinutes()
  const marks = [minutesOf(p.dayStart, 420), minutesOf(p.nightStart, 1140)]
  const ahead = Math.min(...marks.map((m) => (m - t + 1440) % 1440 || 1440))
  return ahead * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds()
}

/* ---------------- 运行时状态 ---------------- */

function initialTheme(): ThemeName {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** 当前偏好（设置页绑这个） */
export const themePrefs = ref<ThemePrefs>({ ...DEFAULT_THEME_PREFS })
/** 此刻生效的主题（App.vue 的 Naive 主题、画布小地图等 JS 取色处读这个） */
export const activeTheme = ref<ThemeName>(initialTheme())

let currentKey = ''
let synced = false
/** 身份未知期间改过偏好：身份一到落到该账号名下（同 textPrefs 的 pendingUnsaved） */
let pendingUnsaved = false
let scheduleTimer: ReturnType<typeof setTimeout> | undefined

function storageKey(): string {
  const who = currentAccountId()
  return who ? `${THEME_PREFS_KEY_PREFIX}${who}` : ''
}

function readJson(key: string): ThemePrefs | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** 账号的存档；账号未知时用本机最近一次设置 */
function readStored(key: string): ThemePrefs {
  return (key ? readJson(key) : readJson(THEME_DEVICE_KEY)) ?? { ...DEFAULT_THEME_PREFS }
}

function persist(key: string, p: ThemePrefs) {
  try {
    const json = JSON.stringify(p)
    localStorage.setItem(THEME_DEVICE_KEY, json)
    if (!key) return
    const isDefault =
      p.mode === DEFAULT_THEME_PREFS.mode &&
      p.dayStart === DEFAULT_THEME_PREFS.dayStart &&
      p.nightStart === DEFAULT_THEME_PREFS.nightStart
    if (isDefault) localStorage.removeItem(key)
    else localStorage.setItem(key, json)
  } catch {
    /* 隐私模式 / 配额：本次会话内仍然生效 */
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => Promise<void> | void) => unknown }

/**
 * 把主题写到 <html>。animate：用户切换 / 到点 / 系统切换时做一次短交叉淡入（base.css），首帧与换号不做。
 * 优先 View Transitions（整页截图淡入，不给每个元素加 transition）；不支持时退化为挂 160ms 的颜色过渡类。
 */
function applyTheme(next: ThemeName, animate: boolean) {
  const root = document.documentElement
  const unchanged = root.getAttribute('data-theme') === next && activeTheme.value === next
  if (unchanged) return
  const write = () => {
    root.setAttribute('data-theme', next)
    activeTheme.value = next
  }
  if (!animate || prefersReducedMotion() || document.visibilityState !== 'visible') {
    write()
    return
  }
  const doc = document as ViewTransitionDoc
  if (typeof doc.startViewTransition === 'function') {
    // 等 Naive 按新主题重算完样式再拍「新」画面，免得淡入后组件再跳一次
    doc.startViewTransition(async () => {
      write()
      await nextTick()
    })
    return
  }
  root.classList.add('xq-theme-switching')
  write()
  window.setTimeout(() => root.classList.remove('xq-theme-switching'), 220)
}

let lastHostAppearance = ''

/**
 * 桌面端宿主若实现了 setAppearance（可选，旧版没有），把外观同步过去，让窗口标题栏 / 背景跟着变。
 * mode 或生效主题任一变了才发（浅色 → 跟随系统且系统也是浅色时主题没变，但 mode 变了，宿主也要知道）。
 */
function notifyHost(theme: ThemeName) {
  const mode = themePrefs.value.mode
  const sig = `${mode}|${theme}`
  if (sig === lastHostAppearance) return
  lastHostAppearance = sig
  try {
    window.ThirdServiceBridge?.setAppearance?.({ mode, theme })
  } catch {
    /* 宿主实现差异不影响站点 */
  }
}

/** 重新判定并应用；按时间模式下顺带把定时器挂到下一个切换点 */
function refresh(animate: boolean) {
  if (scheduleTimer) clearTimeout(scheduleTimer)
  scheduleTimer = undefined
  const next = resolveTheme(themePrefs.value)
  applyTheme(next, animate)
  notifyHost(next)
  if (themePrefs.value.mode === 'schedule') {
    // 最多睡 5 分钟就醒来重算一次：电脑休眠期间定时器不走、唤醒后不一定有 visibilitychange（页面一直可见），
    // 不封顶的话可能晚好几个小时才切；主题没变时 applyTheme 直接返回，开销只是一次判定
    const wait = Math.min(msToNextBoundary(themePrefs.value) + 500, 300_000)
    scheduleTimer = setTimeout(() => refresh(true), wait)
  }
}

/**
 * 按当前账号读存档并套用。main.ts 挂载前调用一次（与 index.html 内联脚本结果一致，不闪），
 * 之后在路由切换、账号 id 变化时调用；账号没变就什么都不做。
 */
export function syncThemePrefsWithAccount() {
  const key = storageKey()
  if (synced && key === currentKey) return
  const prevKey = currentKey
  const first = !synced
  synced = true
  currentKey = key

  if (key && !prevKey && pendingUnsaved) {
    // 身份刚解出来，而用户在此之前已经改过：保留眼前这份并落到该账号名下
    pendingUnsaved = false
    persist(key, themePrefs.value)
    return
  }
  pendingUnsaved = false
  themePrefs.value = readStored(key)
  refresh(!first)
}

/** 修改偏好：立即生效 + 写本机缓存 */
export function setThemePrefs(patch: Partial<ThemePrefs>) {
  const next = normalize({ ...themePrefs.value, ...patch })
  themePrefs.value = next
  refresh(true)
  if (!currentKey) pendingUnsaved = true
  persist(currentKey, next)
}

export function resetThemePrefs() {
  setThemePrefs({ ...DEFAULT_THEME_PREFS })
}

onAccountChange(() => syncThemePrefsWithAccount())

if (typeof window !== 'undefined') {
  // 跟随系统：系统外观一变就跟（macOS 自动外观、Windows 夜间模式切换）
  systemQuery?.addEventListener?.('change', () => {
    if (themePrefs.value.mode === 'system') refresh(true)
  })
  // 按时间：休眠唤醒 / 切回标签页时补算一次（定时器在休眠期间不走）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && themePrefs.value.mode === 'schedule') refresh(false)
  })
  // 别的标签页改了偏好 / 换了账号：同步过来（storage 事件不在写入方触发，这里只读不写，不会来回弹）
  window.addEventListener('storage', (e) => {
    if (e.key === null || (currentKey && e.key === currentKey) || (!currentKey && e.key === THEME_DEVICE_KEY)) {
      currentKey = storageKey()
      pendingUnsaved = false
      themePrefs.value = readStored(currentKey)
      refresh(true)
    } else if (e.key === 'fusion_identity' || e.key === 'fusion_accessToken') {
      syncThemePrefsWithAccount()
    }
  })
}
