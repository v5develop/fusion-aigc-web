import { computed, ref } from 'vue'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { workflowHistories, type WorkflowHistoryItem } from '@/api/workflows.ts'
import { isTerminal } from '@/views/tools/useToolHistory'

/** 组提交的聚合态（Java CompatV1TaskStatus.BATCH_PARTIAL_SUCCEED）：只在全部子任务到终态后出现 */
const PARTIAL_SUCCEED = 'PARTIAL_SUCCEED'

export function isWorkflowTerminal(status: string | undefined | null) {
  return status === PARTIAL_SUCCEED || isTerminal(status)
}

/**
 * 工作流历史：GET /api/v1/workflows/{workflowTitle}/histories 第一页（查看用地址，original=false）。
 *
 * <p>与工具页 useToolHistory 同一套轮询口径：提交只回 workflowHistoryIds，产物从历史接口取；
 * 有未到终态的记录、或刚提交还在宽限期内时每 3 秒拉一次，全部到终态后自动停；拉取失败不停。
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

  const { start, stop } = usePolling(() => fetchPage(), 3000, {
    immediate: false,
    stopOnError: false,
    autoStop: () => {
      if (running.value > 0) return false
      if (graceLeft > 0) {
        graceLeft--
        return false
      }
      return true
    },
  })

  async function reload() {
    stop()
    items.value = []
    loading.value = true
    try {
      await fetchPage()
    } finally {
      loading.value = false
    }
    if (running.value > 0) start()
  }

  async function afterSubmit() {
    graceLeft = 3
    stop()
    try {
      await fetchPage()
    } finally {
      start()
    }
  }

  return { items, loading, running, reload, afterSubmit, stop }
}
