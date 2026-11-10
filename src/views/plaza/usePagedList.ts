/**
 * 广场两个列表共用的分页状态：首屏 / 换筛选重查、加载更多、加载 / 失败态。
 * 序号防串：换筛选时还在飞的旧请求回来直接丢弃。
 */
import { computed, ref, shallowRef } from 'vue'
import { useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'

export interface PageResult<T> {
  items: T[]
  hasMore: boolean
}

export function usePagedList<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  /** silenced：该接口在请求层静默（SILENT_ERROR_URLS），首屏失败只在页内展示 errorMsg，不再 toast；加载更多失败无页内位置，仍 toast */
  opts: { silenced?: boolean } = {},
) {
  const message = useMessage()

  const items = shallowRef<T[]>([])
  const page = ref(0)
  const hasMore = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const failed = ref(false)
  const errorMsg = ref('')
  let seq = 0

  /** 业务失败（code≠0）请求层已 toast；这里只补请求层不提示的传输层 / 无信封 HTTP 错误 */
  function reportError(err: unknown, force = false) {
    if (opts.silenced && !force) return
    const apiErr = toApiError(err)
    if (!opts.silenced && apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
    message.error(err instanceof Error && err.message ? err.message : '加载失败')
  }

  async function reload() {
    const mine = ++seq
    loading.value = true
    failed.value = false
    errorMsg.value = ''
    try {
      const res = await fetchPage(1)
      if (mine !== seq) return
      items.value = res.items
      hasMore.value = res.hasMore
      page.value = 1
    } catch (err) {
      if (mine !== seq) return
      items.value = []
      hasMore.value = false
      failed.value = true
      errorMsg.value = err instanceof Error && err.message ? err.message : ''
      reportError(err)
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    const mine = seq
    loadingMore.value = true
    try {
      const next = page.value + 1
      const res = await fetchPage(next)
      if (mine !== seq) return
      items.value = [...items.value, ...res.items]
      hasMore.value = res.hasMore
      page.value = next
    } catch (err) {
      if (mine === seq) reportError(err, true)
    } finally {
      loadingMore.value = false
    }
  }

  /** 滚动容器距底 240px 内预取下一页 */
  function onScroll(e: Event) {
    const el = e.target as HTMLElement
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) void loadMore()
  }

  const empty = computed(() => !loading.value && !failed.value && !items.value.length)

  return { items, hasMore, loading, loadingMore, failed, errorMsg, empty, reload, loadMore, onScroll }
}
