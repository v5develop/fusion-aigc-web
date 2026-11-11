import { ref, onUnmounted } from 'vue'

/** 全站轮询的统一节奏：提交后先快查一次，再退到常规间隔；页面隐藏降频，切回立即补一次 */
export const POLL_RAMP = [1500, 2000] as const
/** 隐藏页的最小间隔（常规间隔更长时以常规为准） */
export const POLL_HIDDEN_MIN = 10_000

export function usePolling<T = any>(
  fn: (params?: string) => Promise<T>, // 要轮询执行的异步函数，支持接收参数
  interval: number = 3000, // 轮询间隔（默认 3000ms）
  options: {
    immediate?: boolean // 是否立即执行（默认 true）
    autoStop?: (result: T) => boolean // 自动停止条件函数
    onError?: (error: unknown) => void // 错误回调
    stopOnError?: boolean // 出错时是否停止轮询（默认 true；false 则错误后继续下一轮）
    /** 每次 start 后头几轮的间隔（默认 POLL_RAMP：1.5s、2s），之后回到 interval；传 [] 关掉 */
    ramp?: readonly number[]
    /** 页面隐藏时的间隔（默认 max(interval × 3, 10s)）；切回前台立即补一轮 */
    hiddenInterval?: number
  } = {},
) {
  const {
    immediate = true,
    autoStop,
    onError,
    stopOnError = true,
    ramp = POLL_RAMP,
    hiddenInterval = Math.max(interval * 3, POLL_HIDDEN_MIN),
  } = options

  const isPolling = ref(false)
  const result = ref<T | null>(null)
  const error = ref<unknown>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let currentParams: string | undefined = ''
  // 请求在飞时不再发第二个（切回前台补一轮、stop/start 抖动都不会并发）
  let inflight = false
  let rampStep = 0

  const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  function nextDelay() {
    if (isHidden()) return hiddenInterval
    const d = rampStep < ramp.length ? ramp[rampStep]! : interval
    rampStep++
    return Math.min(d, interval)
  }

  async function execute() {
    timer = null
    if (!isPolling.value || inflight) return
    inflight = true
    // 本轮所属的参数：stop → start 换了会话时丢掉旧会话的结果
    const params = currentParams
    let stale = false

    try {
      error.value = null
      const data = await fn(params)
      if (!isPolling.value) return
      if (params !== currentParams) return void (stale = true)
      result.value = data

      if (autoStop && autoStop(data)) {
        stop()
        return
      }

      scheduleNext()
    } catch (e) {
      if (!isPolling.value) return
      if (params !== currentParams) return void (stale = true)
      error.value = e
      onError?.(e)
      if (stopOnError) stop()
      else scheduleNext()
    } finally {
      inflight = false
      // 在飞期间换了会话（新会话的首轮因在飞被跳过）：立即替新会话补上
      if (stale && isPolling.value && !timer) void execute()
    }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(execute, nextDelay())
  }

  function start(params?: string) {
    if (isPolling.value) return
    isPolling.value = true
    currentParams = params
    rampStep = 0

    if (immediate) {
      void execute()
    } else {
      scheduleNext()
    }
  }

  function stop() {
    isPolling.value = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function reset() {
    stop()
    result.value = null
    error.value = null
  }

  function onVisibility() {
    if (!isPolling.value) return
    if (isHidden()) {
      // 隐藏：把已排的下一轮改成隐藏间隔
      if (timer) scheduleNext()
    } else if (!inflight) {
      // 切回前台：立即补一轮，之后按常规间隔
      if (timer) clearTimeout(timer)
      void execute()
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  onUnmounted(() => {
    stop()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  })

  return {
    isPolling,
    result,
    error,
    start,
    stop,
    reset,
  }
}
