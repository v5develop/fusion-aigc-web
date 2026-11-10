import { computed, onUnmounted, ref, watch } from 'vue'
import { workflowVideoQuote, type WorkflowQuoteResp } from '@/api/workflowQuote.ts'

/**
 * 视频复刻页（解析标注 / 直接出片两种模式）提交按钮里的「消耗 N 点」：POST /api/v1/workflows/video/quote。
 *
 * <p>body 是此刻点提交会发出去的请求体（同一个 buildBody 拼的）；返回 null = 表单本地还不能提交，不报价。
 * 参数变化后防抖 300ms 再问，只认最后一次请求的响应（过期响应丢弃）；卸载时取消待发的请求并丢弃在途响应。
 *
 * <p>数一律来自后端：报价中 / 失败 / 不可提交 → points=null（显示「—」），绝不拿旧值或前端估算顶上。
 * available=false 时 blockReason 是后端给的原因（与提交时同一句），用作提交按钮的禁用原因。
 *
 * <p>防抖键里自由文本（content、各维 note）只取「有没有写」：它们不影响价格，逐字重报只会让数字一直闪「—」；
 * 有没有写会影响受理（替换须挂图或写说明），所以仍保留这一位。
 */
export function useWorkflowVideoQuote(body: () => Record<string, unknown> | null) {
  const quote = ref<WorkflowQuoteResp | null>(null)
  const pending = ref(false)
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function fetchQuote(req: Record<string, unknown>) {
    const id = ++seq
    pending.value = true
    workflowVideoQuote(req)
      .then((res) => {
        if (id === seq) quote.value = res.code === 0 ? (res.data ?? null) : null
      })
      .catch(() => {
        if (id === seq) quote.value = null
      })
      .finally(() => {
        if (id === seq) pending.value = false
      })
  }

  watch(
    () => {
      const b = body()
      return b ? JSON.stringify(b, priceKey) : ''
    },
    () => {
      if (timer) clearTimeout(timer)
      timer = null
      seq++ // 参数一变，在途的旧响应即作废
      quote.value = null
      const req = body()
      if (!req) {
        pending.value = false
        return
      }
      pending.value = true
      timer = setTimeout(() => {
        timer = null
        // 发请求时取最新的完整请求体（自由文本按当前输入）
        const latest = body()
        if (latest) fetchQuote(latest)
        else pending.value = false
      }, 300)
    },
    { immediate: true },
  )
  onUnmounted(() => {
    seq++
    if (timer) clearTimeout(timer)
    timer = null
  })

  /** 已报出的点数；报价中 / 失败 / 不可提交为 null */
  const points = computed<number | null>(() => {
    const q = quote.value
    if (pending.value || !q || !q.available || typeof q.points !== 'number') return null
    return q.points
  })

  /** 后端判定此刻不能提交的原因；空串 = 没有（含报价中、报价失败：交给提交时再判） */
  const blockReason = computed(() => {
    const q = quote.value
    if (pending.value || !q || q.available) return ''
    return q.reason || '当前参数无法提交，请调整后再试'
  })

  return { quote, pending, points, blockReason }
}

/** JSON.stringify 的 replacer：自由文本只留「有没有写」 */
function priceKey(key: string, value: unknown) {
  if ((key === 'content' || key === 'note') && typeof value === 'string') return value.trim() ? 1 : 0
  return value
}
