import { ref, watch, reactive } from 'vue'

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

//分页器参数
export function usePaginationData() {
  const paginationData: Record<string, any> = reactive({
    total: 0,
    pageIndex: 1,
    pageSize: 20,
    hasMore: true,
  })
  function indexMethod(index: number) {
    return (paginationData.pageIndex - 1) * paginationData.pageSize + ++index
  }
  return { paginationData, indexMethod }
}
