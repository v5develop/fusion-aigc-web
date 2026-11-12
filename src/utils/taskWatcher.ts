/**
 * 全站任务状态监听器（单例，全站只有这一个，不随页面各开一份）。
 *
 * <h3>数据源：实时推送优先，轮询兜底</h3>
 * <ul>
 *   <li><b>推送</b>（utils/task-stream/sse）：任务中心 SSE，后端在父任务状态 / 进度 / 终态变化时推 {@code task} 事件。
 *       连接只由<b>主标签页</b>持有（utils/task-stream/bus 选举），事件经 BroadcastChannel 转给其它标签页。</li>
 *   <li><b>轮询</b>（原有逻辑）：GET /creation/task-center/tasks?statusBucket=active 拿「排队中 + 生成中」，
 *       某条从在途列表里消失就用单条详情确认终态。推送不可用（后端未部署 404、连接数超限、网络错误）时由主标签页照旧轮询；
 *       推送在线时只保留低频对账（有在途任务时 60s 一次）与「新任务补标题」的按需查询。</li>
 * </ul>
 *
 * <p>轮询节奏（与页面轮询同一口径）：有在途任务时 1.5s → 2s → 5s 常规；页面隐藏 20s；切回前台立即补一轮。
 * 没有在途任务时停在空闲档：页面可见时每 60s 看一眼，隐藏时不查。任何生成类提交成功（api 层广播 xq:task-submitted）
 * 都会把下一轮提前到 1.5s 后（推送在线时由推送送达，无需快查）。
 *
 * <h3>提醒只出一次</h3>
 * 完成事件只由主标签页产生，按「任务号 + 状态桶」在 localStorage 里去重（换主标签页、断线补发、推送与轮询同时命中都不会重复），
 * 再广播给所有标签页；站内轻提示只在用户眼前的那个标签页出（见 TaskNotifier），桌面通知只由主标签页在没有任何可见标签页时发。
 *
 * <p>登出 / 换号（currentAccountId 变化）：断开推送、清掉在途记录与事件游标；未登录的标签页不参与选举。
 * 主标签页在后台超过 5 分钟就断开推送改回轮询；后台超过 1 分钟且有可见标签页时由可见的那页接手。
 *
 * <p>只认任务中心能看到的任务（Java 创作任务）；不在任务中心的（如纯 Go 侧批次）不会提醒。
 */
import { shallowRef } from 'vue'
import { getQuiet, toApiError, TASK_SUBMITTED_EVENT } from '@/api/index.ts'
import type { ITaskCenterPage, ITaskCenterTask } from '@/api/task-center.ts'
import { currentAccountId } from '@/utils/auth-session.ts'
import { createBus, LeaderElector, newTabId, type Bus } from '@/utils/task-stream/bus'
import { TaskStream, type TaskStreamEvent } from '@/utils/task-stream/sse'

export type { TaskStreamEvent } from '@/utils/task-stream/sse'

export interface FinishedTask {
  taskId: string
  /** 任务中心标题（入口名 + 编号末 10 位） */
  title: string
  ok: boolean
  /** 第一次看到它在跑时用户所在的页面（进站时就已在跑的为 null） */
  seenOn: string | null
}

export interface FinishedContext {
  /** 本标签页是否为主标签页（桌面通知只由主标签页发） */
  leader: boolean
}

type Listener = (list: FinishedTask[], ctx: FinishedContext) => void
type TaskListener = (ev: TaskStreamEvent) => void
type ResyncListener = (reason: string) => void

type BusMsg =
  | { t: 'task'; ev: TaskStreamEvent; id: number | null }
  | { t: 'finished'; list: FinishedTask[] }
  | { t: 'state'; live: boolean; lastEventId: number | null }
  | { t: 'resync'; reason: string }
  | { t: 'vis'; tab: string; visible: boolean; focused: boolean }
  | { t: 'seen'; keys: string[] }
  | { t: 'submitted'; route: string }
  | { t: 'resign'; tab: string }
  | { t: 'hello'; tab: string }

const ACTIVE = new Set(['queued', 'processing'])
const RAMP = [1500, 2000]
const STEADY_MS = 5000
const HIDDEN_MS = 20_000
const IDLE_MS = 60_000
/** 推送在线时的低频对账（只在有在途任务时） */
const LIVE_RECONCILE_MS = 60_000
/** 主标签页在后台超过这么久就断开推送（改回后台轮询节奏），切回前台再连 */
const HIDDEN_CLOSE_MS = 5 * 60_000
/** 推送里出现未见过的在途任务时，攒一下再查一次在途列表补标题 */
const TITLE_FETCH_DELAY_MS = 800
const PAGE_SIZE = 50
/** 进站后先让首屏请求跑完再查 */
const BOOT_DELAY_MS = 3000
/** 「刚提交」提示的有效期：期间新出现的在途任务记在提交页名下 */
const SUBMIT_HINT_MS = 60_000
const NOTIFIED_KEY = 'xq_task_notified'
const NOTIFIED_TTL_MS = 6 * 3600_000

/**
 * 在途（排队中 + 生成中）任务数：主导航「任务中心」角标读它。
 * 由 tracked 的增删驱动，数据仍来自推送 + 既有低频对账，不额外发请求；推送 / 总线回灌的事件也会更新它。
 */
export const activeTaskCount = shallowRef(0)

class TrackedMap<V> extends Map<string, V> {
  override set(key: string, value: V) {
    super.set(key, value)
    activeTaskCount.value = this.size
    return this
  }
  override delete(key: string) {
    const hit = super.delete(key)
    activeTaskCount.value = this.size
    return hit
  }
  override clear() {
    super.clear()
    activeTaskCount.value = 0
  }
}

const tracked = new TrackedMap<{ title: string; seenOn: string | null }>()
const listeners = new Set<Listener>()
const taskListeners = new Set<TaskListener>()
const resyncListeners = new Set<ResyncListener>()
let timer: ReturnType<typeof setTimeout> | null = null
let titleTimer: ReturnType<typeof setTimeout> | null = null
let hiddenCloseTimer: ReturnType<typeof setTimeout> | null = null
let inflight = false
let rampStep = RAMP.length
let lastPollAt = 0
let started = false
let booted = false
let routeOf: () => string = () => '/'
/** 在途记录属于哪个账号（currentAccountId，后端用户 id）；undefined = 还没认过，null = 认过但身份暂未知 */
let owner: string | null | undefined
let submitHint: { route: string; at: number } | null = null

// ---------------- 多标签页状态 ----------------

const TAB = newTabId()
let bus: Bus<BusMsg> | null = null
let elector: LeaderElector | null = null
let stream: TaskStream | null = null
let isLeader = false
/** 最后收到的事件号（跨标签页同步；主标签页重连时带上，用于补发） */
let lastEventId: number | null = null
let hiddenAt = 0
/** 其它标签页的可见 / 焦点状态（主标签页据此决定要不要发桌面通知） */
const peers = new Map<string, { visible: boolean; focused: boolean }>()
/** 已在某个标签页展示过的完成提醒（任务号:状态桶） */
const seenKeys = new Set<string>()
/** 本标签页已投递过的完成提醒，防止总线重复投递 */
const delivered = new Set<string>()

/** 推送是否在线（任一标签页都知道：主标签页直接知道，其它标签页靠广播）。任务中心据此放缓自己的轮询 */
export const taskStreamLive = shallowRef(false)

const isHidden = () => document.visibilityState === 'hidden'
const hasFocus = () => {
  try {
    return document.hasFocus()
  } catch {
    return false
  }
}
export const finishedKey = (t: { taskId: string; ok: boolean }) => `${t.taskId}:${t.ok ? 'success' : 'failed'}`

function setLive(live: boolean) {
  if (taskStreamLive.value !== live) taskStreamLive.value = live
}

/** 登出 / 换号：丢掉上一个账号的在途记录，免得拿新账号去确认旧账号的任务、或把旧账号的完成提醒弹给新账号 */
function resetScope() {
  tracked.clear()
  booted = false
  rampStep = RAMP.length
  lastEventId = null
}

function clear() {
  if (timer) clearTimeout(timer)
  timer = null
}

const streamLive = () => !!stream?.live

function schedule(delay?: number) {
  clear()
  if (!started || !isLeader) return
  let d = delay
  if (d === undefined) {
    if (streamLive()) {
      // 推送在线：只做低频对账，兜住推送漏掉的终态
      if (!tracked.size) return
      d = LIVE_RECONCILE_MS
    } else if (tracked.size || rampStep < RAMP.length) {
      // 刚提交还在快查阶段时，哪怕这一轮还没看到新任务（提交与入列之间有延迟）也按快查走，不掉回 60s 空闲档
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

// ---------------- 完成提醒去重（跨标签页，localStorage） ----------------

function readNotified(): Record<string, number> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** 过滤掉已提醒过的，并把剩下的记为已提醒 */
function claimNotify(list: FinishedTask[]): FinishedTask[] {
  const now = Date.now()
  const store = readNotified()
  for (const [k, at] of Object.entries(store)) if (now - at > NOTIFIED_TTL_MS) delete store[k]
  const out = list.filter((t) => {
    const k = finishedKey(t)
    if (store[k] || delivered.has(k)) return false
    store[k] = now
    return true
  })
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(store))
  } catch {
    // 存储不可用：退化为本页内去重
  }
  return out
}

function deliverFinished(list: FinishedTask[], leader: boolean) {
  const fresh = list.filter((t) => !delivered.has(finishedKey(t)))
  if (!fresh.length) return
  fresh.forEach((t) => delivered.add(finishedKey(t)))
  if (delivered.size > 500) delivered.clear()
  listeners.forEach((fn) => fn(fresh, { leader }))
}

/** 主标签页产生完成事件：去重 → 本页投递 → 广播 */
function emitFinished(list: FinishedTask[]) {
  const fresh = claimNotify(list)
  if (!fresh.length) return
  deliverFinished(fresh, true)
  bus?.post({ t: 'finished', list: fresh })
}

function deliverTask(ev: TaskStreamEvent) {
  taskListeners.forEach((fn) => {
    try {
      fn(ev)
    } catch {
      // 订阅方异常不影响别人
    }
  })
}

function deliverResync(reason: string) {
  resyncListeners.forEach((fn) => {
    try {
      fn(reason)
    } catch {
      // ignore
    }
  })
}

// ---------------- 轮询（推送不可用时的主数据源，推送在线时做对账） ----------------

function seenOnForNew(): string | null {
  if (submitHint && Date.now() - submitHint.at < SUBMIT_HINT_MS) return submitHint.route
  return booted ? routeOf() : null
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
      out.push({ taskId: id, title: meta.title || '生成任务', ok: bucket === 'success', seenOn: meta.seenOn })
    }
  })
  return out
}

/** 校验登录态与账号；返回 false 表示已登出 */
function checkAccount(): boolean {
  const token = localStorage.getItem('fusion_accessToken')
  if (!token) {
    if (owner !== undefined || tracked.size) {
      resetScope()
      owner = undefined
    }
    return false
  }
  const who = currentAccountId() || null
  // 身份暂未知（老会话还没拉到用户信息）不算换人；前后都已知且不同才清。未知期间保留上一个已知的 owner 继续比
  if (owner && who && who !== owner) {
    resetScope()
    owner = who
    // 换号：旧账号的推送连接必须断开，用新账号的令牌换票重连
    if (isLeader && stream) stream.restart()
    return true
  }
  if (who) owner = who
  else if (owner === undefined) owner = null
  return true
}

async function poll() {
  timer = null
  if (!started || inflight || !isLeader) return
  if (!checkAccount()) {
    // 已登出：不发请求（不去碰令牌刷新 / 登出链），空闲档等重新登录
    return schedule()
  }
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
    for (const t of list) {
      if (!ACTIVE.has(t.statusBucket)) continue
      activeIds.add(t.taskId)
      const known = tracked.get(t.taskId)
      const title = t.title || t.typeName || '生成任务'
      // 进站第一轮看到的不知道是在哪页提交的
      if (!known) tracked.set(t.taskId, { title, seenOn: seenOnForNew() })
      else if (!known.title) known.title = title
    }
    booted = true
    // 在途列表只拉了第一页（> 50 条时）：没出现在这一页的不能断定已结束
    const gone = complete ? [...tracked.keys()].filter((id) => !activeIds.has(id)) : []
    if (gone.length) {
      const finished = await confirmFinished(gone)
      if (finished.length) emitFinished(finished)
    }
  } catch {
    // 后台轮询失败不打扰，下一轮再试
  } finally {
    inflight = false
  }
  schedule()
}

function fetchTitlesSoon() {
  if (titleTimer) return
  titleTimer = setTimeout(() => {
    titleTimer = null
    if (!inflight) {
      clear()
      void poll()
    }
  }, TITLE_FETCH_DELAY_MS)
}

// ---------------- 推送事件（只在主标签页） ----------------

function onStreamTask(ev: TaskStreamEvent, id: number | null) {
  if (id != null) lastEventId = id
  bus?.post({ t: 'task', ev, id })
  deliverTask(ev)
  const bucket = ev.statusBucket
  if (ACTIVE.has(bucket)) {
    if (!tracked.has(ev.taskId)) {
      // 推送不带标题：先记下，攒一下再查一次在途列表补标题
      tracked.set(ev.taskId, { title: '', seenOn: seenOnForNew() })
      fetchTitlesSoon()
    }
    if (!timer) schedule()
    return
  }
  const meta = tracked.get(ev.taskId)
  tracked.delete(ev.taskId)
  // 只提醒见过在途的任务（或刚提交、来不及看到在途就结束的）：已结束很久的任务行被无关写入（封面回填、修数脚本）
  // 刷新后，扫描器重启 / 指纹过期时会再推一次终态，不能当成「刚完成」弹给用户
  const justSubmitted = !!submitHint && Date.now() - submitHint.at < SUBMIT_HINT_MS
  if (!meta && !justSubmitted) return
  if (bucket === 'success' || bucket === 'failed') {
    emitFinished([
      { taskId: ev.taskId, title: meta?.title || '生成任务', ok: bucket === 'success', seenOn: meta?.seenOn ?? null },
    ])
  }
}

function onStreamResync(reason: string) {
  bus?.post({ t: 'resync', reason })
  deliverResync(reason)
  // 断线太久 / 游标失效：本页的在途记录可能漏了终态，立即对一次账
  if (!inflight) {
    clear()
    void poll()
  }
}

function onStreamLive(live: boolean) {
  setLive(live)
  bus?.post({ t: 'state', live, lastEventId })
  // 推送掉线：回到轮询节奏；上线：轮询降为低频对账
  if (!inflight) schedule(live ? undefined : rampStep < RAMP.length ? RAMP[rampStep++] : 1000)
}

function ensureStream() {
  if (!isLeader || !started) return
  if (!stream) {
    stream = new TaskStream({
      onTask: onStreamTask,
      onResync: onStreamResync,
      onLive: onStreamLive,
      lastEventId: () => lastEventId,
    })
  }
  // 后台太久不连：省连接，改回后台轮询节奏
  if (isHidden() && hiddenAt && Date.now() - hiddenAt >= HIDDEN_CLOSE_MS) {
    stream.stop()
    return
  }
  stream.start()
}

function onLeaderChange(leader: boolean) {
  isLeader = leader
  if (leader) {
    // 当选时本页的 live 可能还是前任广播来的 true（前任崩溃没来得及广播 false）：以本页连接为准并广播，
    // 否则推送实际不可用时各标签页的任务中心会一直以为在线、停掉自己的轮询
    setLive(streamLive())
    bus?.post({ t: 'state', live: streamLive(), lastEventId })
    ensureStream()
    // 接手时先对一次账：种下在途记录（标题、提交页），也补上交接空档里可能结束的任务
    schedule(booted ? 300 : BOOT_DELAY_MS)
  } else {
    stream?.stop()
    clear()
    if (titleTimer) clearTimeout(titleTimer)
    titleTimer = null
  }
}

// ---------------- 总线消息 ----------------

function postVisibility() {
  bus?.post({ t: 'vis', tab: TAB, visible: !isHidden(), focused: hasFocus() })
}

function onBus(msg: BusMsg) {
  switch (msg.t) {
    case 'task':
      if (msg.id != null) lastEventId = msg.id
      // 非主标签页也记下在途任务：接任主标签页后，交接前就在跑的任务结束时照样能提醒
      if (!isLeader) {
        if (ACTIVE.has(msg.ev.statusBucket)) {
          if (!tracked.has(msg.ev.taskId)) tracked.set(msg.ev.taskId, { title: '', seenOn: null })
        } else tracked.delete(msg.ev.taskId)
      }
      deliverTask(msg.ev)
      break
    case 'finished':
      deliverFinished(msg.list, false)
      break
    case 'state':
      if (!isLeader) {
        setLive(msg.live)
        if (msg.lastEventId != null) lastEventId = msg.lastEventId
      }
      break
    case 'resync':
      deliverResync(msg.reason)
      break
    case 'vis':
      peers.set(msg.tab, { visible: msg.visible, focused: msg.focused })
      break
    case 'seen':
      msg.keys.forEach((k) => seenKeys.add(k))
      break
    case 'submitted':
      submitHint = { route: msg.route, at: Date.now() }
      if (isLeader) onSubmitted()
      break
    case 'resign':
      peers.delete(msg.tab)
      if (!isLeader) setLive(false)
      elector?.tick()
      break
    case 'hello':
      postVisibility()
      if (isLeader) bus?.post({ t: 'state', live: streamLive(), lastEventId })
      break
  }
}

function onSubmitted() {
  if (!started) return
  if (!isLeader) return
  // 推送在线：新任务会由推送送达（未见过的在途任务会自动补标题），不必快查
  if (streamLive()) return
  rampStep = 0
  // 在飞的这一轮回来后会按快查节奏续排
  if (!inflight) schedule(RAMP[rampStep++])
}

function onLocalSubmitted() {
  if (!started) return
  submitHint = { route: routeOf(), at: Date.now() }
  if (isLeader) onSubmitted()
  else bus?.post({ t: 'submitted', route: submitHint.route })
}

function onVisibility() {
  if (!started) return
  postVisibility()
  if (isHidden()) {
    hiddenAt = Date.now()
    if (isLeader) {
      if (hiddenCloseTimer) clearTimeout(hiddenCloseTimer)
      hiddenCloseTimer = setTimeout(() => {
        hiddenCloseTimer = null
        if (isHidden()) ensureStream()
      }, HIDDEN_CLOSE_MS)
      if (!inflight) schedule()
    }
    return
  }
  hiddenAt = 0
  if (hiddenCloseTimer) clearTimeout(hiddenCloseTimer)
  hiddenCloseTimer = null
  // 可见了：没有主标签页（或主标签页在后台太久）时尽快接手
  elector?.tick()
  if (!isLeader) return
  ensureStream()
  // 切回前台：有在途任务立即补一轮；空闲时距上次超过空闲间隔才查
  if (!inflight && (tracked.size || Date.now() - lastPollAt >= IDLE_MS)) {
    clear()
    void poll()
  } else if (!inflight && !timer) schedule()
}

function onFocusChange() {
  if (started) postVisibility()
}

function onPageHide() {
  if (!started) return
  bus?.post({ t: 'vis', tab: TAB, visible: false, focused: false })
  if (isLeader) {
    elector?.resign()
    bus?.post({ t: 'resign', tab: TAB })
  }
}

/** 启动（App 挂载时调用一次；重复调用无副作用）。route = 当前页面路径，用于判断用户是否已离开提交页 */
export function startTaskWatcher(route: () => string) {
  routeOf = route
  if (started) return
  started = true
  hiddenAt = isHidden() ? Date.now() : 0
  bus = createBus<BusMsg>(onBus)
  elector = new LeaderElector({
    tab: TAB,
    canClaim: () => !!localStorage.getItem('fusion_accessToken'),
    hiddenSince: () => hiddenAt,
    onChange: onLeaderChange,
    onTick: () => {
      // 每 2s：登出则断开推送并让位（选举本身也不再参与），换号则重连
      const loggedIn = checkAccount()
      if (!loggedIn && isLeader) stream?.stop()
      if (!loggedIn && taskStreamLive.value) setLive(false)
    },
  })
  window.addEventListener(TASK_SUBMITTED_EVENT, onLocalSubmitted)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocusChange)
  window.addEventListener('blur', onFocusChange)
  window.addEventListener('pagehide', onPageHide)
  bus.post({ t: 'hello', tab: TAB })
  postVisibility()
  elector.start()
}

export function stopTaskWatcher() {
  if (!started) return
  onPageHide()
  started = false
  clear()
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = null
  if (hiddenCloseTimer) clearTimeout(hiddenCloseTimer)
  hiddenCloseTimer = null
  stream?.stop()
  stream = null
  elector?.stop()
  elector = null
  bus?.close()
  bus = null
  isLeader = false
  setLive(false)
  window.removeEventListener(TASK_SUBMITTED_EVENT, onLocalSubmitted)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', onFocusChange)
  window.removeEventListener('blur', onFocusChange)
  window.removeEventListener('pagehide', onPageHide)
}

/** 订阅完成事件（每个标签页都会收到一次）；返回取消订阅 */
export function onTasksFinished(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 订阅推送的任务变化（状态 / 进度；不含地址，需要详情请回查接口）；返回取消订阅 */
export function onTaskEvent(fn: TaskListener) {
  taskListeners.add(fn)
  return () => taskListeners.delete(fn)
}

/** 订阅「需要整体重拉」通知（断线太久、事件游标失效）；返回取消订阅 */
export function onTaskResync(fn: ResyncListener) {
  resyncListeners.add(fn)
  return () => resyncListeners.delete(fn)
}

/** 有没有任何标签页正在用户眼前（本页或其它标签页） */
export function anyTabVisible() {
  if (!isHidden()) return true
  for (const p of peers.values()) if (p.visible) return true
  return false
}

/** 别的标签页正拿着焦点（站内提示交给它出） */
export function otherTabFocused() {
  for (const p of peers.values()) if (p.visible && p.focused) return true
  return false
}

/** 本页已展示过这些完成提醒：通知其它标签页别再补弹 */
export function markFinishedSeen(keys: string[]) {
  if (!keys.length) return
  keys.forEach((k) => seenKeys.add(k))
  bus?.post({ t: 'seen', keys })
}

export const finishedSeen = (key: string) => seenKeys.has(key)

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
