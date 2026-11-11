import { computed, ref } from 'vue'
import { deleteWorkflowHistories, workflowHistories, type WorkflowHistoryItem } from '@/api/workflows.ts'
import { useStudioPolling, type PollRoundResult } from '@/views/studio/hooks.ts'
import { isTerminal, pollFailureOf, useOfflineBanner } from '@/views/tools/useToolHistory'

/** 组提交的聚合态（Java CompatV1TaskStatus.BATCH_PARTIAL_SUCCEED）：只在全部子任务到终态后出现 */
const PARTIAL_SUCCEED = 'PARTIAL_SUCCEED'

export function isWorkflowTerminal(status: string | undefined | null) {
  return status === PARTIAL_SUCCEED || isTerminal(status)
}

/**
 * 工作流历史：GET /api/v1/workflows/{workflowTitle}/histories 第一页（查看用地址，original=false）。
 *
 * <p>与工具页 useToolHistory 同一套轮询口径：提交只回 workflowHistoryIds，产物从历史接口取；
 * 有未到终态的记录、或刚提交还在宽限期内时每 3 秒拉一次，全部到终态后自动停；
 * 调度复用 useStudioPolling，连续 3 次网络失败暂停并置 offline（断网提示条，「重试」恢复）。
 */
export function useWorkflowHistory(workflowTitle: () => string, pageSize = 20) {
  const items = ref<WorkflowHistoryItem[]>([])
  const loading = ref(false)
  let graceLeft = 0

  async function fetchPage() {
    const title = workflowTitle()
    if (!title) return
    const res = await workflowHistories(title, 1, pageSize)
    // 拉取期间切到了别的模板：丢弃旧结果
    if (title !== workflowTitle()) return
    items.value = res.data?.data ?? []
  }

  const running = computed(() => items.value.filter((i) => !isWorkflowTerminal(i.status)).length)

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

  async function reload() {
    stop()
    items.value = []
    loading.value = true
    try {
      await fetchPage()
    } finally {
      loading.value = false
    }
    if (poller.offline.value) poller.retry()
    else if (running.value > 0) start()
  }

  async function afterSubmit() {
    graceLeft = 3
    stop()
    try {
      await fetchPage()
    } finally {
      start({ soon: true })
    }
  }

  /** 删除一条历史（DELETE /workflows/{workflowTitle}/histories）；成功后先本地摘掉再静默刷新一次补位 */
  async function remove(id: number) {
    const title = workflowTitle()
    if (!title) return
    await deleteWorkflowHistories(title, [id])
    if (title !== workflowTitle()) return
    items.value = items.value.filter((i) => i.workflowHistoryId !== id)
    fetchPage().catch(() => {})
  }

  return {
    items,
    loading,
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
