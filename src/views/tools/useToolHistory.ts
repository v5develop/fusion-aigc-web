import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { toApiError } from '@/api/index.ts'
import { deleteToolHistories, toolHistories, type ToolHistoryItem } from '@/api/tools.ts'
import { useStudioPolling, type PollRoundResult } from '@/views/studio/hooks.ts'

/** 终态（Java CompatV1TaskStatus.TERMINAL；WAITING_MANUAL_PROCESS 不算终态） */
const TERMINAL = new Set(['SUCCEED', 'FAILED', 'TIMEOUT', 'CANCELLED'])

export function isTerminal(status: string | undefined | null) {
  return !!status && TERMINAL.has(status)
}

/** 一次拉取失败的类型：同创作页口径，传输层失败（没拿到响应）算 network，其余算 system */
export function pollFailureOf(err: unknown): PollRoundResult['failure'] {
  const e = toApiError(err)
  return !e || e.isNetwork ? 'network' : 'system'
}

/**
 * 断网提示条的显示依据：浏览器离线（navigator.onLine / online、offline 事件），
 * 或轮询器连续网络失败后已暂停（useStudioPolling.offline，「重试」恢复）。
 */
export function useOfflineBanner(pollerOffline: Ref<boolean>) {
  const browserOffline = ref(typeof navigator !== 'undefined' && navigator.onLine === false)
  const sync = () => {
    browserOffline.value = navigator.onLine === false
  }
  onMounted(() => {
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
  })
  onUnmounted(() => {
    window.removeEventListener('online', sync)
    window.removeEventListener('offline', sync)
  })
  return computed(() => browserOffline.value || pollerOffline.value)
}

/**
 * 工具历史：GET /api/v1/tools/{toolTitle}/histories 第一页。
 *
 * <p>异步工具提交只回任务号，产物要从历史接口取（Java 控制器口径），所以轮询的就是它：
 * 有未到终态的记录、或刚提交还在宽限期内时每 3 秒拉一次，全部到终态后自动停。
 * 调度复用创作页的 useStudioPolling：隐藏页降频、失败退避，连续 3 次网络失败暂停并置 offline
 * （页面显示断网提示条，「重试」恢复）。拉取失败由请求层 toast。
 */
export function useToolHistory(toolTitle: () => string, pageSize = 20) {
  const items = ref<ToolHistoryItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const loaded = ref(false)
  /** 刚提交的任务可能还没写进历史：宽限几轮再判定「全部完成」 */
  let graceLeft = 0

  async function fetchPage() {
    const title = toolTitle()
    const res = await toolHistories(title, 1, pageSize)
    // 拉取期间切到了别的工具：丢弃旧工具的结果
    if (title !== toolTitle()) return res
    items.value = res.data?.data ?? []
    total.value = res.data?.total ?? 0
    loaded.value = true
    return res
  }

  const running = computed(() => items.value.filter((i) => !isTerminal(i.status)).length)

  async function round(): Promise<PollRoundResult> {
    try {
      await fetchPage()
    } catch (err) {
      return { done: false, failure: pollFailureOf(err) }
    }
    if (running.value > 0) return { done: false }
    if (graceLeft > 0) {
      graceLeft--
      return { done: false }
    }
    return { done: true }
  }

  const poller = useStudioPolling(round, { interval: 3000 })
  const { start, stop } = poller
  const offline = useOfflineBanner(poller.offline)

  /** 首次进入 / 切换工具：拉一次，有在跑的就开始轮询 */
  async function reload() {
    stop()
    items.value = []
    total.value = 0
    loaded.value = false
    loading.value = true
    try {
      await fetchPage()
    } finally {
      loading.value = false
    }
    // 拉通了说明网络已恢复：清掉暂停态（retry 会立即补一轮并按需续上轮询）
    if (poller.offline.value) poller.retry()
    else if (running.value > 0) start()
  }

  /** 提交后调用：立即刷新并进入宽限轮询 */
  async function afterSubmit() {
    graceLeft = 3
    stop()
    try {
      await fetchPage()
    } finally {
      start()
    }
  }

  /** 删除一条历史（DELETE /tools/{toolTitle}/histories）；成功后先本地摘掉再静默刷新一次补位 */
  async function remove(id: number) {
    const title = toolTitle()
    await deleteToolHistories(title, [id])
    if (title !== toolTitle()) return
    items.value = items.value.filter((i) => i.aiToolHistoryId !== id)
    total.value = Math.max(0, total.value - 1)
    fetchPage().catch(() => {})
  }

  return {
    items,
    total,
    loading,
    loaded,
    running,
    reload,
    afterSubmit,
    stop,
    remove,
    /** 断网提示条：浏览器离线或轮询已因连续网络失败暂停 */
    offline,
    /** 提示条「重试」：恢复轮询并立即拉一次 */
    retryPolling: poller.retry,
  }
}
