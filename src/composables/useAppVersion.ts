/**
 * 「部分功能有新版本」检测（对齐原型 NextSidebar 的更新条）。
 *
 * 构建时 build/version-plugin.ts 往站点根写 `version.json`（{ buildId }），本页自己的 id 编进
 * `__APP_BUILD_ID__`；两者不同 = 服务器已发新版。触发检查的时机：
 *   1. 窗口重新获得焦点 / 标签页变为可见（节流 30 秒，免得来回切窗口刷请求）；
 *   2. 每 30 分钟；
 *   3. 动态 import / 分包加载失败（`vite:preloadError`、未捕获的 chunk 加载 rejection）——发版后旧 chunk 404 的典型现象，立刻查。
 * 「稍后」暂缓 2 小时（sessionStorage，只在本标签页内有效；到点自动重新提示），「立即更新」整页刷新、停留在当前路由。
 * dev 不启用；取不到 / 不是 JSON（被 SPA 回退成 html）/ 无 buildId 一律当没有新版。
 *
 * 整个应用只启动一份检测（模块级单例）：多处调用 useAppVersion() 共享同一份状态。
 */
import { computed, getCurrentInstance, onScopeDispose, ref } from 'vue'
import { isChunkLoadError } from '@/utils/render-failure'

const NOTICE_TEXT = '部分功能有新版本'
const POLL_MS = 30 * 60_000
const FOCUS_THROTTLE_MS = 30_000
const SNOOZE_MS = 2 * 60 * 60_000
const SNOOZE_KEY = 'xq-update-snooze-until'
const SNOOZE_BUILD_KEY = 'xq-update-snooze-build'

const serverBuildId = ref('')
const snoozeUntil = ref(readSnooze())
/** 暂缓的是哪一版：之后又发了更新的版本（id 变了）就不再算暂缓，重新提示 */
const snoozeBuildId = ref(readSnoozeBuild())
const now = ref(Date.now())

let started = false
let refCount = 0
let pollTimer: ReturnType<typeof setInterval> | undefined
let snoozeTimer: ReturnType<typeof setTimeout> | undefined
let lastCheck = 0
let inflight: Promise<void> | null = null
let stop: (() => void) | null = null

function readSnooze(): number {
  try {
    const n = Number(sessionStorage.getItem(SNOOZE_KEY))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function readSnoozeBuild(): string {
  try {
    return sessionStorage.getItem(SNOOZE_BUILD_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeSnooze(until: number, buildId = '') {
  try {
    if (until) {
      sessionStorage.setItem(SNOOZE_KEY, String(until))
      sessionStorage.setItem(SNOOZE_BUILD_KEY, buildId)
    } else {
      sessionStorage.removeItem(SNOOZE_KEY)
      sessionStorage.removeItem(SNOOZE_BUILD_KEY)
    }
  } catch {
    // 隐私模式 / 禁用存储：暂缓只在内存里生效，刷新后会重新提示
  }
}

const hasUpdate = computed(() => !!serverBuildId.value && serverBuildId.value !== __APP_BUILD_ID__)
const snoozed = computed(() => snoozeUntil.value > now.value && snoozeBuildId.value === serverBuildId.value)
/** 给 Navigation 的 updateNotice：有新版且未暂缓时是提示文案，否则空串（不显示） */
const updateNotice = computed(() => (hasUpdate.value && !snoozed.value ? NOTICE_TEXT : ''))

async function fetchServerBuildId(): Promise<string> {
  const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit' })
  if (!res.ok) return ''
  const body = (await res.json()) as { buildId?: unknown }
  return typeof body.buildId === 'string' ? body.buildId : ''
}

/** 立即检查一次；并发调用共用同一个请求，失败静默 */
export function checkAppVersion(): Promise<void> {
  if (import.meta.env.DEV) return Promise.resolve()
  if (inflight) return inflight
  lastCheck = Date.now()
  inflight = fetchServerBuildId()
    .then((id) => {
      if (id) serverBuildId.value = id
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

function armSnoozeTimer() {
  clearTimeout(snoozeTimer)
  const wait = snoozeUntil.value - Date.now()
  if (wait <= 0) return
  // 到点把「现在」推进一下，updateNotice 自动重新出现
  snoozeTimer = setTimeout(() => {
    now.value = Date.now()
  }, wait + 50)
}

/** 「稍后」：2 小时内不再提示 */
export function snoozeUpdateNotice() {
  snoozeUntil.value = Date.now() + SNOOZE_MS
  now.value = Date.now()
  snoozeBuildId.value = serverBuildId.value
  writeSnooze(snoozeUntil.value, serverBuildId.value)
  armSnoozeTimer()
}

/** 「立即更新」：整页刷新，路由、query 不变；URL 本身就是当前位置，直接 reload 即可 */
export function reloadForUpdate() {
  window.location.reload()
}

function start() {
  if (started || import.meta.env.DEV) return
  started = true
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    now.value = Date.now()
    if (Date.now() - lastCheck >= FOCUS_THROTTLE_MS) void checkAppVersion()
  }
  const onFocus = onVisible
  const onPreloadError = () => void checkAppVersion()
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isChunkLoadError(e.reason)) void checkAppVersion()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('vite:preloadError', onPreloadError)
  window.addEventListener('unhandledrejection', onRejection)
  pollTimer = setInterval(() => void checkAppVersion(), POLL_MS)
  armSnoozeTimer()
  void checkAppVersion()
  stop = () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('vite:preloadError', onPreloadError)
    window.removeEventListener('unhandledrejection', onRejection)
    clearInterval(pollTimer)
    clearTimeout(snoozeTimer)
    started = false
    stop = null
  }
}

/**
 * 在组件里调用即启动检测（组件卸载且无人再用时停止）。
 * 返回：updateNotice（传给 Navigation）、snooze（稍后）、reload（立即更新）。
 */
export function useAppVersion() {
  start()
  if (getCurrentInstance()) {
    refCount += 1
    onScopeDispose(() => {
      refCount -= 1
      if (refCount <= 0) stop?.()
    })
  }
  return { updateNotice, hasUpdate, snooze: snoozeUpdateNotice, reload: reloadForUpdate, check: checkAppVersion }
}
