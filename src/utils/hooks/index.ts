import { watch, onUnmounted, type WatchSource, type WatchOptions } from 'vue'

export function useDebounce(config: {
  data: WatchSource | WatchSource[] | object
  callback: () => void
  delay?: number
  options?: WatchOptions
}) {
  const { data, callback, delay = 300, options = {} } = config

  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const stop = watch(
    data,
    () => {
      clear()

      timer = setTimeout(() => {
        callback()
      }, delay)
    },
    options,
  )

  onUnmounted(() => {
    clear()
    stop()
  })
}
