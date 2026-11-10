import { computed, onUnmounted, ref, watch } from 'vue'
import { llQuote, type LLQuoteReq, type LLQuoteResp } from '@/api/localLifeQuote.ts'

/**
 * Workbench 提交按钮里那一行「消耗 N 点」（原型 ToolSubmitBar ml .v3-submitbar__ml-cost）。
 * points 为 null 时显示「—」（还没报出价 / 报不出价）；不传 estimate 整行不显示。
 */
export interface LLEstimate {
  /** 数字前的词，默认「消耗」；构思免费、出片才扣的页写「出片消耗」之类 */
  label?: string
  points: number | null
  /** 数字后的单位，默认「点」；数字人按配音时长计价时为「点起」，复刻未解析时为「点/秒」 */
  suffix?: string
}

/**
 * 本地生活提交前报价：表单参数变化后防抖 300ms 调 POST /local-life/quote，只认最后一次的响应（过期响应丢弃）。
 *
 * <p>给出的数一律来自后端：
 * - 报价中 / 失败 / available=false → points=null（「—」），绝不拿旧值或前端估算顶上；
 * - 计费未开（charged=false）→ 0：提交确实冻结 0 点；
 * - exact=false：数字人（时长等配音出来）显示最低价 +「点起」；复刻未解析显示每秒单价 +「点/秒」。
 *
 * <p>body 返回 null 表示这次提交不计费（如文案「手动输入」只是保存），此时 estimate 为 undefined、整行不显示。
 */
export function useLLQuote(
  body: () => LLQuoteReq | null,
  label?: () => string | undefined,
  /** 不进请求体、但变了就要重新报价的依赖（如选中记录的解析状态：解析完成后才有精确价） */
  deps?: () => unknown,
) {
  const quote = ref<LLQuoteResp | null>(null)
  const pending = ref(false)
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function fetchQuote(req: LLQuoteReq) {
    const id = ++seq
    pending.value = true
    llQuote(req)
      .then((res) => {
        if (id !== seq) return
        quote.value = res.code === 0 ? res.data : null
      })
      .catch(() => {
        if (id === seq) quote.value = null
      })
      .finally(() => {
        if (id === seq) pending.value = false
      })
  }

  watch(
    () => JSON.stringify([body(), deps?.()]),
    () => {
      if (timer) clearTimeout(timer)
      seq++ // 参数一变，在途的旧响应即作废
      quote.value = null
      const req = body()
      if (!req) {
        pending.value = false
        return
      }
      pending.value = true
      timer = setTimeout(() => fetchQuote(req), 300)
    },
    { immediate: true },
  )
  onUnmounted(() => {
    seq++
    if (timer) clearTimeout(timer)
  })

  const estimate = computed<LLEstimate | undefined>(() => {
    if (!body()) return undefined
    const q = quote.value
    const out: LLEstimate = { label: label?.(), points: null }
    if (pending.value || !q || !q.available) return out
    if (!q.charged) return { ...out, points: 0 }
    if (q.exact) return { ...out, points: q.points }
    if (q.points_max > 0) return { ...out, points: q.points, suffix: '点起' }
    if (q.price_unit === 'PER_SECOND') return { ...out, points: q.points, suffix: '点/秒' }
    return out
  })

  return { quote, estimate }
}
