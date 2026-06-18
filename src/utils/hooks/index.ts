import { ref, watch } from 'vue'

//防抖
export function useDebounce(data: any, fn: () => void, delay: number = 300) {
  const timer = ref<ReturnType<typeof setTimeout>>()
  watch(data, () => {
    clearTimeout(timer.value)
    timer.value = setTimeout(() => {
      fn()
    }, delay)
  })
}
