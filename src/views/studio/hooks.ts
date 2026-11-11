/** 商拍工作室套件共享 hooks：游标版历史列表（在跑批次自动轮询）+ 幂等提交重试 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { MultiWatchSources, Ref } from 'vue'
import { useUserInfoStore } from '@/stores/user-info.ts'
import {
  studioBatchDetail,
  studioHistory,
  studioTaskDetail,
  studioQuoteImageGen,
  studioQuotePose,
  studioQuoteTryon,
} from '@/api/studio.ts'
import type {
  StudioBatchDetail,
  StudioTask,
  StudioImageGenQuoteReq,
  StudioKind,
  StudioPoseQuoteReq,
  StudioTryonQuoteReq,
} from '@/api/studio-types.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import { isBatchTerminal, isSignedUrl, taskLibraryStatus, urlIdentity } from './constants.ts'
import { toApiError } from '@/api'
import { POLL_RAMP } from '@/utils/hooks/usePolling.ts'

/** 失败类型：network = 断网 / 超时；system = 5001 等服务端异常 */
export type PollFailure = 'network' | 'system'
export interface PollRoundResult {
  /** 已到终态，停止轮询 */
  done: boolean
  /** 本轮整体失败的类型；缺省 = 成功 */
  failure?: PollFailure
}

/**
 * 批次轮询调度器（契约 api-studio.md §5.1）：
 * 页面可见 2s；隐藏 8s，切回立即补一次；网络错误 / 5001 指数退避 2→4→8→封顶 10s，成功后复位；
 * 连续 3 次网络失败暂停并置 offline（页面显示「网络异常，已暂停轮询」，retry 恢复）；
 * 终态 / 卸载 / stop 都会清掉定时器。
 *
 * @param round 执行一轮请求，返回是否终态与失败类型
 */
export function useStudioPolling(
  round: () => Promise<PollRoundResult>,
  opts: { interval?: number; hiddenInterval?: number; maxBackoff?: number; offlineAfter?: number } = {},
) {
  const { interval = 2000, hiddenInterval = 8000, maxBackoff = 10000, offlineAfter = 3 } = opts
  const offline = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight = false
  let failures = 0
  let networkFailures = 0
  let disposed = false

  const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  // 提交后的快查阶段（POLL_RAMP：1.5s、2s，再回常规间隔）；start({ soon: true }) 开启
  let rampStep: number = POLL_RAMP.length

  function delay(): number {
    if (isHidden()) return hiddenInterval
    if (failures) return Math.min(interval * 2 ** (failures - 1), maxBackoff)
    if (rampStep < POLL_RAMP.length) return Math.min(POLL_RAMP[rampStep++]!, interval)
    return interval
  }

  function clear() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    clear()
    if (disposed || offline.value) return
    timer = setTimeout(tick, delay())
  }

  async function tick() {
    timer = null
    if (disposed || inflight) return
    inflight = true
    let res: PollRoundResult
    try {
      res = await round()
    } catch {
      res = { done: false, failure: 'system' }
    } finally {
      inflight = false
    }
    if (disposed) return
    if (res.done) {
      failures = networkFailures = 0
      return clear()
    }
    if (res.failure) {
      failures++
      networkFailures = res.failure === 'network' ? networkFailures + 1 : 0
      if (networkFailures >= offlineAfter) {
        offline.value = true
        return clear()
      }
    } else {
      failures = networkFailures = 0
    }
    // round 内部可能已通过 start() 排了定时器，这里统一重排，保证只有一个
    schedule()
  }

  /**
   * 开始 / 续上轮询（已有定时器或请求在飞则不重复）。
   * soon = 刚提交：头两轮按 1.5s、2s 快查，再回常规间隔（已有定时器时改排到快查节奏）
   */
  function start(opts: { soon?: boolean } = {}) {
    if (opts.soon) {
      rampStep = 0
      if (timer && !inflight) return schedule()
    }
    if (disposed || offline.value || timer || inflight) return
    schedule()
  }

  function stop() {
    clear()
  }

  /** 离线条「重试」：清掉退避并立即拉一次 */
  function retry() {
    offline.value = false
    failures = networkFailures = 0
    clear()
    void tick()
  }

  function onVisibility() {
    if (disposed || offline.value || (!timer && !inflight)) return
    if (isHidden()) {
      if (!inflight) schedule()
    } else if (!inflight) {
      // 切回前台：立即补一次，之后按常规间隔
      clear()
      void tick()
    }
  }

  onMounted(() => document.addEventListener('visibilitychange', onVisibility))
  onUnmounted(() => {
    disposed = true
    clear()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { offline, start, stop, retry }
}

/** 同一张图的签名地址在这段时间内沿用旧的（服务端每次查询现签 10 分钟，轮询每次都换查询串，换了图就会重载、校色重烘） */
const SIGNED_REUSE_MS = 4 * 60 * 1000
/** 入库中刚变空、但 asset_id / 服装蒙版还没带出来时，再补查几轮（约 2 秒一轮） */
const LIBRARY_SETTLE_ROUNDS = 5
/** 同一个任务因图片加载失败补查的最小间隔 */
const REFRESH_TASK_GAP_MS = 20 * 1000

/** 成品是穿着服装的人物（商拍 / 姿态）：入库完成后服务端会补服装蒙版 */
const expectsMask = (t: StudioTask) => t.kind === 'tryon' || t.kind === 'pose'

/**
 * 生成历史：游标分页（next_cursor 空 = 没有下一页）+ 「有非终态批次就自动轮询」。
 *
 * <p>轮询参考 local-life useLLList 的思路，但游标分页没法按页并发重拉，
 * 改为对已加载的非终态批次逐个拉批次详情、按 id 原位替换（列表顺序不动）。
 * 所有已加载批次都到终态就停；从有在跑变为全部终态的那一刻刷一次积分
 * （有失败 / 取消的批次会退点）。
 *
 * @param kind    固定的 kind 过滤；'' = 全部
 * @param limit   每页条数，默认 20（服务端上限 50）
 * @param interval 轮询间隔，契约建议批次详情 2 秒
 * @param onGone  某批次返回 4001（不存在 / 已删除）时回调，页面据此提示
 */
export function useStudioHistory(
  kind: StudioKind | '' = '',
  limit = 20,
  interval = 2000,
  onGone?: (batchId: number) => void,
) {
  const { updateUserInfo } = useUserInfoStore()

  const items = ref<StudioBatchDetail[]>([]) as Ref<StudioBatchDetail[]>
  const nextCursor = ref('')
  const loading = ref(false)
  const loadingMore = ref(false)

  const hasMore = computed(() => !!nextCursor.value)
  /** 已加载里还有非终态批次（「N 个进行中」、积分刷新依据） */
  const hasRunning = computed(() => items.value.some((d) => !isBatchTerminal(d.batch.status)))

  // ---------------- 成品先交付、后入库（契约 §4.6） ----------------

  /**
   * 入库中刚变空、但 asset_id 还是 0 / 服装蒙版还没补的任务：taskId → 剩余补查轮数。
   * 轮数有界：素材库入库关闭、用户已在素材库删了这张时 asset_id 永远是 0，不能一直轮询。
   */
  const settling = new Map<string, number>()
  /** 批次里有成品在等入库（pending / 刚入库还在补 asset_id、蒙版）：批次已终态也要继续轮询 */
  const awaitsLibrary = (d: StudioBatchDetail) =>
    d.tasks.some((t) => taskLibraryStatus(t) === 'pending' || settling.has(t.taskId))
  /** 需要轮询的批次：非终态，或终态但有成品还在入库 */
  const needsPoll = (d: StudioBatchDetail) => !isBatchTerminal(d.batch.status) || awaitsLibrary(d)
  /** 轮询器是否该跑（settling 不是响应式，跟着 items 一起算即可：每次 items 变化都会重新评估） */
  const needsPolling = () => items.value.some(needsPoll)

  /** 签名地址第一次拿到的时间（沿用判断用）；条目有界 */
  const signedSeenAt = new Map<string, number>()
  function noteSigned(url: string, now: number) {
    if (!isSignedUrl(url) || signedSeenAt.has(url)) return
    if (signedSeenAt.size > 400) {
      for (const [k, at] of signedSeenAt) if (now - at > SIGNED_REUSE_MS * 3) signedSeenAt.delete(k)
    }
    signedSeenAt.set(url, now)
  }
  /** 新旧地址是同一对象的两次签名、且旧签名还新鲜：沿用旧地址（不让图片每 2 秒重载一次） */
  function keepSigned(prevUrl: string | undefined, nextUrl: string, now: number): string {
    // 新地址也得是签名地址：入库完成换成的公有长期地址（哪怕路径相同）必须立即换上，不能沿用私有桶短签
    if (
      prevUrl &&
      prevUrl !== nextUrl &&
      isSignedUrl(prevUrl) &&
      isSignedUrl(nextUrl) &&
      urlIdentity(prevUrl) === urlIdentity(nextUrl)
    ) {
      const at = signedSeenAt.get(prevUrl)
      if (at !== undefined && now - at < SIGNED_REUSE_MS) return prevUrl
    }
    noteSigned(nextUrl, now)
    return nextUrl
  }

  /** 合并一个任务：沿用新鲜签名；入库中 → 变空时登记补查（asset_id / 蒙版还没带出来） */
  function adoptTask(prev: StudioTask | undefined, next: StudioTask, now: number, reuseSigned = true): StudioTask {
    const resultUrl = reuseSigned ? keepSigned(prev?.resultUrl, next.resultUrl, now) : next.resultUrl
    if (!reuseSigned) noteSigned(next.resultUrl, now)
    const cleared = taskLibraryStatus(prev) === 'pending' && !taskLibraryStatus(next) && next.status === 2
    const incomplete = !(next.assetId ?? 0) || (expectsMask(next) && !next.maskUrl)
    if (cleared && incomplete) settling.set(next.taskId, LIBRARY_SETTLE_ROUNDS)
    else if (!incomplete || taskLibraryStatus(next) !== undefined || next.status !== 2) settling.delete(next.taskId)
    return resultUrl === next.resultUrl ? next : { ...next, resultUrl }
  }

  /** 用服务端的新详情替换旧详情（轮询 / 刷新 / 补拉共用）：tasks 整体替换，只沿用新鲜签名地址 */
  function adopt(prev: StudioBatchDetail | undefined, next: StudioBatchDetail): StudioBatchDetail {
    const now = Date.now()
    const prevTasks = new Map((prev?.tasks ?? []).map((t) => [t.taskId, t]))
    const coverUrl = keepSigned(prev?.batch.coverUrl, next.batch.coverUrl, now)
    return {
      ...next,
      batch: coverUrl === next.batch.coverUrl ? next.batch : { ...next.batch, coverUrl },
      tasks: next.tasks.map((t) => adoptTask(prevTasks.get(t.taskId), t, now)),
    }
  }

  /** 外部拿到的新批次详情（如预览区「存为资产」前重拉）放回列表 */
  function replace(next: StudioBatchDetail) {
    const at = items.value.findIndex((d) => d.batch.id === next.batch.id)
    if (at < 0) return
    items.value[at] = adopt(items.value[at], next)
    startPollingIfNeeded()
  }

  /** 每个任务上次补查的时间 + 已经为哪些地址补查过（同一个地址只补一次，防止坏图无限重试） */
  const refreshedAt = new Map<string, number>()
  const refreshedUrls = new Set<string>()

  /**
   * 成品图加载失败（多半是短期签名过期：轮询已停、页面放久了）：单独现签一次这张（GET /tasks/{task_id}），
   * 换上新地址。同一地址只补一次，同一任务至少间隔 20 秒；返回是否换上了新地址。
   */
  async function refreshTask(taskId: string, failedUrl?: string): Promise<boolean> {
    const now = Date.now()
    const at = items.value.findIndex((d) => d.tasks.some((t) => t.taskId === taskId))
    if (at < 0) return false
    const old = items.value[at]!.tasks.find((t) => t.taskId === taskId)!
    const urlKey = failedUrl || old.resultUrl
    if (!urlKey || refreshedUrls.has(urlKey)) return false
    if (now - (refreshedAt.get(taskId) ?? 0) < REFRESH_TASK_GAP_MS) return false
    refreshedUrls.add(urlKey)
    refreshedAt.set(taskId, now)
    try {
      const fresh = (await studioTaskDetail(taskId)).data
      if (!fresh) return false
      const i = items.value.findIndex((d) => d.tasks.some((t) => t.taskId === taskId))
      if (i < 0) return false
      const d = items.value[i]!
      // 不沿用旧签名：加载失败的正是它
      const merged = adoptTask(
        d.tasks.find((t) => t.taskId === taskId),
        fresh,
        Date.now(),
        false,
      )
      items.value[i] = { ...d, tasks: d.tasks.map((t) => (t.taskId === taskId ? merged : t)) }
      startPollingIfNeeded()
      return merged.resultUrl !== old.resultUrl
    } catch {
      return false
    }
  }

  async function fetchPage(cursor: string): Promise<{ list: StudioBatchDetail[]; next: string }> {
    const res = await studioHistory({ kind: kind || undefined, cursor: cursor || undefined, limit })
    return { list: res.data?.list ?? [], next: res.data?.nextCursor ?? '' }
  }

  /** 列表排序口径（与服务端一致：created_at DESC, id DESC）：a 是否排在 b 前面 */
  const newer = (a: StudioBatchDetail, b: StudioBatchDetail) =>
    a.batch.createdAt !== b.batch.createdAt ? a.batch.createdAt > b.batch.createdAt : a.batch.id > b.batch.id

  /**
   * 首屏 / 手动刷新（提交成功、取消、删除、重试后调用）。
   *
   * <p>只重拉第一页并<b>合并</b>，不把已加载的后几页扔掉：第一页按服务端结果原样替换（其间不在新一页里的 = 已删除，摘掉）；
   * 比第一页最后一条还旧的已加载批次原样保留（游标也保留，触底接着翻）。否则用户翻到第三页选中一条，
   * 一次取消 / 重试 / 删除之后列表回到第一页，选中的那条「消失」，右列被当成删除清空。
   */
  async function reload() {
    loading.value = true
    try {
      const { list, next } = await fetchPage('')
      const tail = next && list.length ? items.value.filter((d) => newer(list[list.length - 1]!, d)) : []
      const seen = new Set(list.map((d) => d.batch.id))
      const keep = tail.filter((d) => !seen.has(d.batch.id))
      const prevById = new Map(items.value.map((d) => [d.batch.id, d]))
      items.value = [...list.map((d) => adopt(prevById.get(d.batch.id), d)), ...keep]
      // 保留了已加载的后几页：游标仍指向它们之后；否则用新一页的游标
      if (!keep.length) nextCursor.value = next
      startPollingIfNeeded()
    } finally {
      loading.value = false
    }
  }

  /** 本会话里用户自己删掉的批次（选中的那条被删后，页面据此直接清选中，不当成「被别处删除」去补拉 / 提示） */
  const dropped = new Set<number>()

  /** 从列表里摘掉一条（删除成功后先本地摘，后几页的批次 reload 不会再碰它） */
  function drop(id: number) {
    dropped.add(id)
    items.value = items.value.filter((d) => d.batch.id !== id)
  }

  /**
   * 单独拉一个批次放进列表（选中的批次不在已加载范围里时用）：按排序口径插到对应位置。
   * 4001（不存在 / 已删除）走 onGone；其它失败返回 false，调用方保持选中、下次再试。
   */
  async function ensure(id: number): Promise<boolean> {
    if (items.value.some((d) => d.batch.id === id)) return true
    if (dropped.has(id)) return false
    try {
      const raw = (await studioBatchDetail(id)).data
      if (!raw) return false
      const data = adopt(undefined, raw)
      if (!items.value.some((d) => d.batch.id === id)) {
        const at = items.value.findIndex((d) => newer(data, d))
        if (at < 0) items.value.push(data)
        else items.value.splice(at, 0, data)
      }
      startPollingIfNeeded()
      return true
    } catch (err) {
      if (toApiError(err)?.code === 4001) onGone?.(id)
      return false
    }
  }

  /** 触底加载下一页 */
  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const { list, next } = await fetchPage(nextCursor.value)
      items.value.push(...list.map((d) => adopt(undefined, d)))
      nextCursor.value = next
      startPollingIfNeeded()
    } finally {
      loadingMore.value = false
    }
  }

  let lastRunning = false
  /** 刚提交：下一次进入轮询走快查节奏（1.5s 起） */
  let soonNext = false

  function startPollingIfNeeded() {
    const running = hasRunning.value
    // 从有到无的那一刻说明有批次到终态（扣点 / 退点），刷一次积分
    if (lastRunning && !running) updateUserInfo()
    lastRunning = running
    if (needsPolling()) {
      poller.start({ soon: soonNext })
      soonNext = false
    } else poller.stop()
  }

  /**
   * 已终态、只在等入库的批次：开始等的时间。通常几秒就入库；入库失败会退避重试最长约一小时，
   * 等得久了放慢补查（1 分钟后约 10 秒一次，5 分钟后约 30 秒一次），不按 2 秒一直打。
   */
  const libraryWaitSince = new Map<number, number>()
  let roundNo = 0

  function dueThisRound(d: StudioBatchDetail, now: number): boolean {
    // 刚入库完、在补 asset_id / 蒙版的批次每轮都查：补查轮数按轮扣，放慢节奏会在补到之前就扣完
    if (!isBatchTerminal(d.batch.status) || d.tasks.some((t) => settling.has(t.taskId))) {
      libraryWaitSince.delete(d.batch.id)
      return true
    }
    const since = libraryWaitSince.get(d.batch.id) ?? now
    libraryWaitSince.set(d.batch.id, since)
    const waited = now - since
    if (waited < 60 * 1000) return true
    return roundNo % (waited < 5 * 60 * 1000 ? 5 : 15) === 0
  }

  /** 一轮：各在跑批次（含终态但有成品在入库的）并发拉详情；返回本轮结果给轮询器做退避 / 停止判断 */
  async function pollRound(): Promise<PollRoundResult> {
    const now = Date.now()
    roundNo++
    const waiting = items.value.filter(needsPoll)
    for (const id of libraryWaitSince.keys()) if (!waiting.some((d) => d.batch.id === id)) libraryWaitSince.delete(id)
    // 补查轮数按轮扣：扣到 0 就不再为它轮询（asset_id 可能就是 0：入库关闭 / 已从素材库删除）
    for (const [taskId, left] of settling) {
      if (left <= 1) settling.delete(taskId)
      else settling.set(taskId, left - 1)
    }
    if (!waiting.length) return { done: true }
    const runningItems = waiting.filter((d) => dueThisRound(d, now))
    if (!runningItems.length) return { done: false }
    const results = await Promise.allSettled(
      runningItems.map(async (d) => ({ id: d.batch.id, data: (await studioBatchDetail(d.batch.id)).data })),
    )
    let okCount = 0
    let failure: PollFailure | undefined
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        okCount++
        if (!r.value.data) return
        const at = items.value.findIndex((d) => d.batch.id === r.value.id)
        // 轮询拿到的是全量，tasks 整体替换，不做增量合并（只沿用新鲜的签名地址）
        if (at >= 0) items.value[at] = adopt(items.value[at], r.value.data)
        return
      }
      const e = toApiError(r.reason)
      if (e?.code === 4001) {
        // 批次没了：从列表摘掉并提示，不再轮询它
        const id = runningItems[i]!.batch.id
        items.value = items.value.filter((d) => d.batch.id !== id)
        onGone?.(id)
        okCount++
      } else if (!e || e.isNetwork) {
        failure = 'network'
      } else {
        failure ??= 'system'
      }
    })
    startPollingIfNeeded()
    return { done: !needsPolling(), failure: okCount > 0 ? undefined : failure }
  }

  const poller = useStudioPolling(pollRound, { interval })
  const stopPolling = poller.stop

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    hasRunning,
    reload,
    loadMore,
    drop,
    ensure,
    replace,
    refreshTask,
    /** 是否是本会话里用户自己删掉的批次 */
    wasDropped: (id: number) => dropped.has(id),
    stopPolling,
    /** 连续网络失败后已暂停轮询（页面显示「网络异常，已暂停轮询」条） */
    offline: poller.offline,
    /** 离线条的「重试」：恢复轮询 */
    retryPolling: poller.retry,
    /** 提交成功后由页面手动调用：立即刷一次列表并按需进入轮询 */
    refresh: async () => {
      soonNext = true
      await reload().catch(() => {})
    },
  }
}

/**
 * 提交失败后服务端是否可能已经受理（结果未知）。只有这种情况才该沿用原幂等键重试。
 *
 * <ul>
 *   <li>传输层失败（超时 / 断网 / 中断，没拿到响应）→ 未知；</li>
 *   <li>5001 / SYSTEM_ERROR → 未知（契约 §1.6：重试沿用同一个 key）；</li>
 *   <li>没有业务码的 HTTP 5xx（网关 502/504 等）→ 未知；</li>
 *   <li>无法识别的错误（非请求层抛出）→ 按未知处理：保守起见不换 key，避免重复扣点；</li>
 *   <li>其余业务码（1002 / 1003 / 2001 / 2007 / 3003 / 4001 / 4002 / 7003 …）及无业务码的 HTTP 4xx → 确定失败。</li>
 * </ul>
 */
function isOutcomeUnknown(err: unknown): boolean {
  const e = toApiError(err)
  if (!e) return true
  if (e.isNetwork) return true
  if (e.code === 5001 || e.reason === 'SYSTEM_ERROR') return true
  return e.code === -1 && (e.httpStatus ?? 0) >= 500
}

/**
 * 幂等提交重试（结果未知时沿用同一个 key）。
 *
 * <p>契约（api-studio.md §1.3）：网络失败、超时重试时沿用同一个 Idempotency-Key；
 * 同 key + 同 body 返回原批次（replayed=true），不重复生成、不重复扣点；
 * 同 key + 不同 body 是 4002 冲突。因此：
 *
 * <ul>
 *   <li>{@link take} 生成本次 key 并缓存；</li>
 *   <li>提交失败 → 调用方把错误交给 {@link fail}：<b>结果未知</b>（网络失败 / 超时 / 5001）才保留缓存，
 *       提交条进入「重试」态（按钮文案「重试生成」），重试沿用原 key；<b>确定失败</b>（参数错、点数不足、
 *       冲突、未开放等其它业务码）清掉缓存，下次提交换新 key —— 否则充值后同 key 同 body 重试，
 *       后端会把上次的失败原样重放回来，用户卡死；</li>
 *   <li>用户改动表单任意字段 → 缓存作废，下次提交换新 key（不会出现同 key 不同 body）；</li>
 *   <li>提交成功 / 切页（组件卸载）→ 清掉缓存。</li>
 * </ul>
 */
export function useIdempotentSubmit() {
  /** 上一次结果未知的提交缓存的 key；空 = 正常态（下次提交生成新 key） */
  const cachedKey = ref('')
  /** 重试态：提交条按钮显示「重试生成」 */
  const retrying = computed(() => !!cachedKey.value)

  /** 取本次提交要用的 key：重试沿用缓存的 key，否则生成新的 */
  function take(): string {
    if (!cachedKey.value) cachedKey.value = createSafeUuid()
    return cachedKey.value
  }

  /** 提交成功 / 离开页面：清掉缓存 */
  function settle() {
    cachedKey.value = ''
  }

  /** 提交失败：结果未知保留 key（进重试态），确定失败清掉 key（下次换新 key） */
  function fail(err: unknown) {
    if (!isOutcomeUnknown(err)) cachedKey.value = ''
  }

  /** 表单被改动：缓存作废（下次提交换新 key） */
  function invalidate() {
    cachedKey.value = ''
  }

  /** 页面把全部表单状态（ref / reactive）丢进来，任意字段变化即作废缓存 */
  function bindForm(...sources: unknown[]) {
    // 变长参数在 TS 里拼不出 Vue 的重载形状，这里收窄交给运行时：watch 支持混合 ref/reactive 的源数组
    watch(sources as MultiWatchSources, invalidate, { deep: true })
  }

  onUnmounted(settle)

  return { retrying, take, settle, fail, invalidate, bindForm }
}

type StudioQuoteBody = {
  tryon: StudioTryonQuoteReq
  pose: StudioPoseQuoteReq
  imagegen: StudioImageGenQuoteReq
}

const STUDIO_QUOTE = {
  tryon: studioQuoteTryon,
  pose: studioQuotePose,
  imagegen: studioQuoteImageGen,
} as const

/**
 * 提交前的「消耗 N 点」：调 Go 的 POST /studio/{tryon,pose,image-generate}/quote（只读报价，契约 api-studio.md §7.1）。
 * 请求体就是提交体里影响价格的那几个字段（张数、模型、分辨率、比例），服务端与提交同一套归一 + 计费入口，
 * 回的 points 与提交回的 estimated_points 同口径。
 *
 * <p>输入变化后防抖 300ms 询价，只取最后一次的响应；不阻塞提交。只有 available 且 charged（计费真开）且 points>0
 * 才给出点数，其余（没配价、不计费、素材没传够、请求失败）一律 null，页面不显示消耗。
 */
export function useStudioCost<K extends StudioKind>(kind: K, body: () => StudioQuoteBody[K]) {
  const points = ref<number | null>(null)
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function fetchQuote() {
    const id = ++seq
    const quote = STUDIO_QUOTE[kind] as (b: StudioQuoteBody[K]) => ReturnType<typeof studioQuoteTryon>
    quote(body())
      .then((res) => {
        if (id !== seq) return
        const d = res.code === 0 ? res.data : null
        points.value = d?.available && d.charged && d.points > 0 ? d.points : null
      })
      .catch(() => {
        if (id === seq) points.value = null
      })
  }

  watch(
    () => JSON.stringify(body()),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fetchQuote, 300)
    },
    { immediate: true },
  )
  onUnmounted(() => {
    seq++
    if (timer) clearTimeout(timer)
  })

  return { points }
}
