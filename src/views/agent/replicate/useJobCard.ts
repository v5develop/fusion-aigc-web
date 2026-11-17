/**
 * 对话卡片的任务数据：每张 JobCard 一个实例（不复用复刻页的单例状态机 useReplicate，多张卡互不干扰）。
 * 只读：GET /api/v1/replicate/jobs/:id（经 replicateGetJob）。
 * - 事件帧里的签名地址已被清洗，所以挂载后先拉一次拿现签地址；
 * - 未到终态按 4 秒（等你确认时 15 秒）轮询，到终态就停；
 * - 终态后按 urlExpiresAt 提前 60 秒续签一次，页面回到前台时地址临近过期也会补拉；
 * - 页面在后台时不拉；失败退避，终态下连续失败 3 次放弃（卡片仍显示事件帧里的数据）。
 */
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { replicateErrorText, replicateGetJob, urlExpiringSoon, type ReplicateJob } from '@/api/replicate.ts'

const TERMINAL = ['succeeded', 'partial', 'failed', 'canceled']
const POLL_MS = 4000
const WAIT_POLL_MS = 15000
const RETRY_MS = 10000
/** setTimeout 的上限（约 24.8 天），续签间隔超过它就按上限算 */
const MAX_TIMEOUT = 2 ** 31 - 1

export function isTerminalJob(j?: Pick<ReplicateJob, 'status'> | null): boolean {
  return !!j && TERMINAL.includes(j.status)
}

export function useJobCard(jobId: MaybeRefOrGetter<string | number>, seed?: MaybeRefOrGetter<ReplicateJob | undefined>) {
  const fetched = ref<ReplicateJob | null>(null)
  const error = ref('')
  /** 以最新拉到的为准；还没拉到时用事件帧里的 view（没有签名地址） */
  const job = computed<ReplicateJob | null>(() => fetched.value ?? toValue(seed) ?? null)

  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let fails = 0
  let alive = true
  let inFlight = false

  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  async function refresh() {
    const id = toValue(jobId)
    if (!alive || inFlight || id === '' || id == null) return
    inFlight = true
    const s = ++seq
    try {
      const res = await replicateGetJob(id)
      if (!alive || s !== seq) return
      if (res.data) fetched.value = res.data
      error.value = ''
      fails = 0
    } catch (err) {
      if (!alive || s !== seq) return
      fails += 1
      error.value = replicateErrorText(err)
    } finally {
      inFlight = false
    }
    schedule()
  }

  function schedule() {
    clearTimeout(timer)
    if (!alive || hidden()) return
    const j = job.value
    if (fails > 0) {
      // 终态下连续失败 3 次不再重试；进行中的任务继续退避重试（生成仍在进行）
      if (isTerminalJob(j) && fails >= 3) return
      timer = setTimeout(refresh, RETRY_MS)
      return
    }
    if (!fetched.value) return
    if (!isTerminalJob(fetched.value)) {
      timer = setTimeout(refresh, fetched.value.status === 'waiting' ? WAIT_POLL_MS : POLL_MS)
      return
    }
    const exp = fetched.value.urlExpiresAt
    if (exp) {
      const ms = new Date(exp).getTime() - Date.now() - 60_000
      timer = setTimeout(refresh, Math.min(Math.max(ms, 5000), MAX_TIMEOUT))
    }
  }

  function onVisible() {
    if (hidden()) return clearTimeout(timer)
    const j = fetched.value
    // 回到前台：没拉过 / 没到终态 / 地址临近过期，立刻补拉；否则只重新挂定时器
    if (!j || !isTerminalJob(j) || urlExpiringSoon(j.urlExpiresAt)) void refresh()
    else schedule()
  }

  /** 播放出错 / 下载前：强制重拉一次拿新地址 */
  async function renew(force = false) {
    if (force || urlExpiringSoon(fetched.value?.urlExpiresAt)) await refresh()
  }

  // 当前实例是否挂在组件里（单测里可能不在）
  if (getCurrentInstance()) {
    onMounted(() => {
      document.addEventListener('visibilitychange', onVisible)
      void refresh()
    })
    onBeforeUnmount(() => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    })
  }

  // 同一张卡换了任务 id，或事件帧里来了新状态（智能体又调了一次工具）：重新拉一次
  watch(
    () => toValue(jobId),
    () => {
      fetched.value = null
      fails = 0
      seq++
      inFlight = false
      void refresh()
    },
  )
  watch(
    () => toValue(seed)?.status,
    (n, o) => {
      if (n !== o && alive) void refresh()
    },
  )

  return { job, error, refresh, renew }
}
