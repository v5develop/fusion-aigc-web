import { ref, onUnmounted } from 'vue'

export function usePolling<T = any>(
  fn: (params: string) => Promise<T>, // 要轮询执行的异步函数，支持接收参数
  interval: number = 3000, // 轮询间隔（默认 3000ms）
  options: {
    immediate?: boolean // 是否立即执行（默认 true）
    autoStop?: (result: T) => boolean // 自动停止条件函数
    onError?: (error: unknown) => void // 错误回调
  } = {},
) {
  const { immediate = true, autoStop, onError } = options

  const isPolling = ref(false)
  const result = ref<T | null>(null)
  const error = ref<unknown>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let currentParams: string = ''

  async function execute() {
    if (!isPolling.value) return

    try {
      error.value = null
      const data = await fn(currentParams)
      result.value = data

      if (autoStop && autoStop(data)) {
        stop()
        return
      }

      scheduleNext()
    } catch (e) {
      error.value = e
      onError?.(e)
      stop()
    }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(execute, interval)
  }

  function start(params: string) {
    if (isPolling.value) return
    isPolling.value = true
    currentParams = params

    if (immediate) {
      execute()
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

  onUnmounted(() => {
    stop()
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
