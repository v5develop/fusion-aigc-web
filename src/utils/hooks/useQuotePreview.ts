import { ref } from 'vue'
import type { WatchOptions } from 'vue'
import { quotePreview } from '@/api/methods'
import type { IQuotePreview } from '@/api/types'
import { useDebounce } from './index'

/**
 * 提交前积分预览：进页面立即询价，依赖变化时防抖后重新询价。
 * @param getParams 返回 quotePreview 入参；返回 null 表示无需询价（如未知模板），视作已知、展示「限免」
 * @param deps      影响价格的响应式依赖（WatchSource 数组）
 * @param options   watch 选项；依赖为数组/对象且需监听内部变化时传 { deep: true }
 */
export function useQuotePreview(
  getParams: () => IQuotePreview | null,
  deps: Array<() => unknown>,
  options?: WatchOptions,
) {
  const pricePoints = ref<number | null>(null)
  // loading/success → UI 走「限免/数字」；error → UI 显示「获取失败」
  const status = ref<'loading' | 'success' | 'error'>('loading')

  const fetchQuote = () => {
    const params = getParams()
    if (!params) {
      // 无需询价（未知模板）：非失败，按「限免」呈现
      pricePoints.value = null
      status.value = 'success'
      return
    }
    status.value = 'loading'
    quotePreview(params)
      .then((res) => {
        if (res.code === 0) {
          pricePoints.value = res.data.pricePoints
          status.value = 'success'
        } else {
          status.value = 'error'
        }
      })
      .catch(() => {
        status.value = 'error'
      })
  }

  fetchQuote() // 进页面立即询价
  if (deps.length) useDebounce({ data: deps, callback: fetchQuote, delay: 1000, options })

  return { pricePoints, status, fetchQuote }
}
