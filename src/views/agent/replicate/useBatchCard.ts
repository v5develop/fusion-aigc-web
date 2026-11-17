/**
 * 批量卡的各条任务进度：帧里的摘要只在智能体再次调工具时才更新，所以卡片自己低频刷新。
 * 取舍：只对「未到终态」的任务按 8 秒一轮 GET（replicateGetJob），每轮最多 3 个并发，页面在后台不拉，
 * 全部到终态后停止；展开的那条 JobCard 自己 4 秒轮询，行摘要也一并更新（多一次同任务请求，量很小，换来实现简单）。
 * 单条失败只保留旧摘要，不报错打扰（下一轮再试）。
 */
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, toValue, type MaybeRefOrGetter } from 'vue'
import { replicateGetJob } from '@/api/replicate.ts'
import type { ReplicateBatchJob } from '@/api/replicate-card.ts'

const TERMINAL = ['succeeded', 'partial', 'failed', 'canceled']
const POLL_MS = 8000
const MAX_CONCURRENT = 3

export const isTerminalStatus = (s: string) => TERMINAL.includes(s)

export function useBatchCard(jobs: MaybeRefOrGetter<ReplicateBatchJob[]>) {
  const live = reactive<Record<number, ReplicateBatchJob>>({})
  /** 帧里的摘要叠上最新拉到的 */
  const rows = computed(() => toValue(jobs).map((j) => ({ ...j, ...(live[j.jobId] ?? {}) })))
  const doneCount = computed(() => rows.value.filter((j) => isTerminalStatus(j.status)).length)
  const failedCount = computed(() => rows.value.filter((j) => j.status === 'failed').length)

  let timer: ReturnType<typeof setTimeout> | undefined
  let alive = true
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  async function pull(id: number) {
    try {
      const j = (await replicateGetJob(id)).data
      if (alive && j)
        live[id] = { jobId: id, status: j.status, statusLabel: j.statusLabel, segDone: j.segDone, segTotal: j.segTotal, money: j.money }
    } catch {
      /* 保留旧摘要，下一轮再试 */
    }
  }

  async function tick() {
    const todo = rows.value.filter((j) => !isTerminalStatus(j.status)).map((j) => j.jobId)
    for (let i = 0; i < todo.length && alive; i += MAX_CONCURRENT) await Promise.all(todo.slice(i, i + MAX_CONCURRENT).map(pull))
    schedule()
  }

  function schedule() {
    clearTimeout(timer)
    if (!alive || hidden() || rows.value.every((j) => isTerminalStatus(j.status))) return
    timer = setTimeout(tick, POLL_MS)
  }
  const onVisible = () => (hidden() ? clearTimeout(timer) : void tick())

  if (getCurrentInstance()) {
    onMounted(() => {
      document.addEventListener('visibilitychange', onVisible)
      void tick()
    })
    onBeforeUnmount(() => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    })
  }
  return { rows, doneCount, failedCount }
}
