import { computed, ref } from 'vue'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { toolHistories, type ToolHistoryItem } from '@/api/tools.ts'

/** 终态（Java CompatV1TaskStatus.TERMINAL；WAITING_MANUAL_PROCESS 不算终态） */
const TERMINAL = new Set(['SUCCEED', 'FAILED', 'TIMEOUT', 'CANCELLED'])

export function isTerminal(status: string | undefined | null) {
  return !!status && TERMINAL.has(status)
}

/**
 * 工具历史：GET /api/v1/tools/{toolTitle}/histories 第一页。
 *
 * <p>异步工具提交只回任务号，产物要从历史接口取（Java 控制器口径），所以轮询的就是它：
 * 有未到终态的记录、或刚提交还在宽限期内时每 3 秒拉一次，全部到终态后自动停。
 * 拉取失败由请求层 toast，轮询不停（stopOnError: false），与创作页的口径一致。
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

  const { start, stop, isPolling } = usePolling(() => fetchPage(), 3000, {
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
    if (running.value > 0) start()
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

  return { items, total, loading, loaded, running, isPolling, reload, afterSubmit, stop }
}
