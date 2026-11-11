/**
 * 全站任务完成提醒的共享轮询器（单例，全站只有这一个，不随页面各开一份）。
 *
 * <p>数据源复用任务中心：GET /creation/task-center/tasks?statusBucket=active 拿「排队中 + 生成中」的任务，
 * 记下见过的在途任务；某条从在途列表里消失，就用单条详情接口确认它的终态（成功 / 失败才提醒，取消是用户自己点的不提醒）。
 *
 * <p>节奏（与页面轮询同一口径）：有在途任务时 1.5s → 2s → 5s 常规；页面隐藏 20s；切回前台立即补一轮。
 * 没有在途任务时停在空闲档：页面可见时每 60s 看一眼（兜住智能体对话这类不走普通提交接口的任务），隐藏时不查。
 * 任何生成类提交成功（api 层广播 xq:task-submitted）都会把下一轮提前到 1.5s 后。
 *
 * <p>只认任务中心能看到的任务（Java 创作任务）；不在任务中心的（如纯 Go 侧批次）不会提醒。
 */
import { getQuiet, toApiError, TASK_SUBMITTED_EVENT } from '@/api/index.ts'
import type { ITaskCenterPage, ITaskCenterTask } from '@/api/task-center.ts'
import { identityOf } from '@/utils/auth-session.ts'

export interface FinishedTask {
  taskId: string
  /** 任务中心标题（入口名 + 编号末 10 位） */
  title: string
  ok: boolean
  /** 第一次看到它在跑时用户所在的页面（进站时就已在跑的为 null） */
  seenOn: string | null
}

type Listener = (list: FinishedTask[]) => void

const ACTIVE = new Set(['queued', 'processing'])
const RAMP = [1500, 2000]
const STEADY_MS = 5000
const HIDDEN_MS = 20_000
const IDLE_MS = 60_000
const PAGE_SIZE = 50
/** 进站后先让首屏请求跑完再查 */
const BOOT_DELAY_MS = 3000

const tracked = new Map<string, { title: string; seenOn: string | null }>()
const listeners = new Set<Listener>()
let timer: ReturnType<typeof setTimeout> | null = null
let inflight = false
let rampStep = RAMP.length
let lastPollAt = 0
let started = false
let booted = false
let routeOf: () => string = () => '/'
/** 在途记录属于哪个账号（token 里的账号指纹）；undefined = 还没认过 */
let owner: string | null | undefined

const isHidden = () => document.visibilityState === 'hidden'

/** 登出 / 换号：丢掉上一个账号的在途记录，免得拿新账号去确认旧账号的任务、或把旧账号的完成提醒弹给新账号 */
function resetScope() {
  tracked.clear()
  booted = false
  rampStep = RAMP.length
}

function clear() {
  if (timer) clearTimeout(timer)
  timer = null
}

function schedule(delay?: number) {
  clear()
  if (!started) return
  let d = delay
  if (d === undefined) {
    // 刚提交还在快查阶段时，哪怕这一轮还没看到新任务（提交与入列之间有延迟）也按快查走，不掉回 60s 空闲档
    if (tracked.size || rampStep < RAMP.length) {
      if (isHidden()) {
        // 后台里没跟上任何任务时快查阶段就此作罢，免得一直按 20s 空转
        if (!tracked.size) rampStep = RAMP.length
        d = HIDDEN_MS
      } else d = rampStep < RAMP.length ? RAMP[rampStep++]! : STEADY_MS
    } else {
      // 空闲：隐藏时不查，等切回前台
      if (isHidden()) return
      d = IDLE_MS
    }
  }
  timer = setTimeout(() => void poll(), d)
}

async function confirmFinished(ids: string[]): Promise<FinishedTask[]> {
  const out: FinishedTask[] = []
  const results = await Promise.allSettled(
    ids.map((id) => getQuiet<ITaskCenterTask>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(id)}`)),
  )
  results.forEach((r, i) => {
    const id = ids[i]!
    const meta = tracked.get(id)
    if (!meta) return
    if (r.status === 'rejected') {
      // 网络抖动：留着下一轮再确认；业务失败（任务已删除 / 无权）就不再跟了
      const e = toApiError(r.reason)
      if (e && !e.isNetwork) tracked.delete(id)
      return
    }
    const bucket = r.value.data?.statusBucket ?? ''
    if (ACTIVE.has(bucket)) return
    tracked.delete(id)
    if (bucket === 'success' || bucket === 'failed') {
      out.push({ taskId: id, title: meta.title, ok: bucket === 'success', seenOn: meta.seenOn })
    }
  })
  return out
}

async function poll() {
  timer = null
  if (!started || inflight) return
  const token = localStorage.getItem('fusion_accessToken')
  if (!token) {
    // 已登出：不发请求（不去碰令牌刷新 / 登出链），清掉旧账号的记录，空闲档等重新登录
    resetScope()
    owner = undefined
    return schedule()
  }
  const who = identityOf(token)
  if (owner !== undefined && who !== owner) resetScope()
  owner = who
  inflight = true
  lastPollAt = Date.now()
  try {
    const res = await getQuiet<ITaskCenterPage>('/api/v1/creation/task-center/tasks', {
      statusBucket: 'active',
      page: 1,
      pageSize: PAGE_SIZE,
    })
    const list = res.data?.list ?? []
    const complete = (res.data?.total ?? list.length) <= list.length
    const activeIds = new Set<string>()
    const here = routeOf()
    for (const t of list) {
      if (!ACTIVE.has(t.statusBucket)) continue
      activeIds.add(t.taskId)
      // 进站第一轮看到的不知道是在哪页提交的
      if (!tracked.has(t.taskId))
        tracked.set(t.taskId, { title: t.title || t.typeName || '生成任务', seenOn: booted ? here : null })
    }
    booted = true
    // 在途列表只拉了第一页（> 50 条时）：没出现在这一页的不能断定已结束
    const gone = complete ? [...tracked.keys()].filter((id) => !activeIds.has(id)) : []
    if (gone.length) {
      const finished = await confirmFinished(gone)
      if (finished.length) listeners.forEach((fn) => fn(finished))
    }
  } catch {
    // 后台轮询失败不打扰，下一轮再试
  } finally {
    inflight = false
  }
  schedule()
}

function onSubmitted() {
  if (!started) return
  rampStep = 0
  // 在飞的这一轮回来后会按快查节奏续排
  if (!inflight) schedule(RAMP[rampStep++])
}

function onVisibility() {
  if (!started) return
  if (isHidden()) {
    if (!inflight) schedule()
    return
  }
  // 切回前台：有在途任务立即补一轮；空闲时距上次超过空闲间隔才查
  if (!inflight && (tracked.size || Date.now() - lastPollAt >= IDLE_MS)) {
    clear()
    void poll()
  } else if (!inflight && !timer) schedule()
}

/** 启动（App 挂载时调用一次；重复调用无副作用）。route = 当前页面路径，用于判断用户是否已离开提交页 */
export function startTaskWatcher(route: () => string) {
  routeOf = route
  if (started) return
  started = true
  window.addEventListener(TASK_SUBMITTED_EVENT, onSubmitted)
  document.addEventListener('visibilitychange', onVisibility)
  schedule(BOOT_DELAY_MS)
}

export function stopTaskWatcher() {
  started = false
  clear()
  window.removeEventListener(TASK_SUBMITTED_EVENT, onSubmitted)
  document.removeEventListener('visibilitychange', onVisibility)
}

/** 订阅完成事件；返回取消订阅 */
export function onTasksFinished(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------------- 桌面通知：只在用户明确开启后才请求权限，绝不自动弹授权框 ----------------

const DESKTOP_KEY = 'xq_task_notify_desktop'

export const desktopNotifySupported = () => typeof window !== 'undefined' && 'Notification' in window

/** 用户是否已开启桌面提醒（开关打开且浏览器已授权） */
export function desktopNotifyEnabled() {
  try {
    return (
      desktopNotifySupported() && Notification.permission === 'granted' && localStorage.getItem(DESKTOP_KEY) === '1'
    )
  } catch {
    return false
  }
}

/** 浏览器已拒绝授权（只能去浏览器设置里改） */
export const desktopNotifyDenied = () => desktopNotifySupported() && Notification.permission === 'denied'

/**
 * 开 / 关桌面提醒。开启时才在用户这次点击里请求授权；返回最终是否开启。
 */
export async function setDesktopNotify(on: boolean): Promise<boolean> {
  try {
    if (!on) {
      localStorage.removeItem(DESKTOP_KEY)
      return false
    }
    if (!desktopNotifySupported()) return false
    const perm =
      Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (perm !== 'granted') return false
    localStorage.setItem(DESKTOP_KEY, '1')
    return true
  } catch {
    return false
  }
}
