/**
 * 发送钮旁的唯一报价（Go GET /plaza/quote，公开：匿名标价 / 登录个性化）。
 *
 * - 随 行业 / 二级 / 模板 / 版数 变化重取；入参（slots 值）变化防抖 500ms 后复核，请求参数没变且上次成功则不再打接口
 *   （匿名按 IP 限频，不能每敲一个字都打）；
 * - 报价中给骨架（不显示旧数字）；失败显示「点数以发送时为准」且**不阻止发送**（EXPERIENCE 3.12 / M-08），带「重试」；
 * - 只做图片模板：视频模板不经智能体对话出片，调用方传 scope=null（报价源也没有视频价）；
 * - refImageCount（请求里实际放了几张图）进请求键：放图 / 删图后价格口径（文生图 / 图生图）变了会重取；
 * - 只改版数时不清掉旧报价：价格按 单价 × 版数 即时变，后台再取一次校准，不闪骨架。
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { plazaQuote, type PlazaResolution, quoteDisplayPoints, quoteEtaText, quoteMaxVariants, quoteTierPoints, type IPlazaQuote } from '@/api/plaza.ts'

export interface QuoteScope {
  industry: string
  subIndustry?: string
  templateId: number
}

export function useTemplateQuote(
  scope: Ref<QuoteScope | null>,
  variants: Ref<number>,
  inputsSig: Ref<string>,
  refImageCount: Ref<number | undefined> = ref(undefined),
  resolution: Ref<PlazaResolution> = ref<PlazaResolution>('1k'),
) {
  const quote = ref<IPlazaQuote | null>(null)
  const state = ref<'idle' | 'loading' | 'ok' | 'error' | 'login'>('idle')
  let seq = 0
  let lastKey = ''
  let lastBase = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  async function fetchNow(force = false) {
    const s = scope.value
    if (!s) {
      seq++
      lastKey = ''
      quote.value = null
      state.value = 'idle'
      return
    }
    const base = `${s.industry}|${s.subIndustry ?? ''}|${s.templateId}|${refImageCount.value ?? ''}|${resolution.value}`
    const key = `${base}|${variants.value}`
    if (!force && key === lastKey && state.value === 'ok') return
    // 同一模板只换了版数：保留旧报价（价格按单价×版数即时算），后台校准
    const keep = base === lastBase && state.value === 'ok' && quote.value !== null
    lastKey = key
    lastBase = base
    const my = ++seq
    if (!keep) {
      state.value = 'loading'
      quote.value = null
    }
    try {
      const res = await plazaQuote({ industry: s.industry, subIndustry: s.subIndustry, templateId: s.templateId, variants: variants.value, refImageCount: refImageCount.value, resolution: resolution.value })
      if (my !== seq) return
      quote.value = res.data ?? null
      state.value = quote.value && quoteDisplayPoints(quote.value) != null ? 'ok' : 'error'
    } catch (e) {
      if (my !== seq) return
      const reason = (e as { reason?: string; code?: number } | null)?.reason
      // 报价源不可用 + 匿名：Go 约定前端显示「登录后查看报价」（不编造价格）
      state.value = reason === 'QUOTE_UNAVAILABLE' ? 'login' : 'error'
      lastKey = ''
      lastBase = ''
    }
  }

  watch(
    () => [scope.value?.industry, scope.value?.subIndustry, scope.value?.templateId, variants.value, refImageCount.value, resolution.value] as const,
    () => void fetchNow(true),
    { immediate: true },
  )
  watch(inputsSig, () => {
    if (!scope.value) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void fetchNow(false), 500)
  })
  onBeforeUnmount(() => {
    seq++
    if (timer) clearTimeout(timer)
  })

  /** 一次最多几版（后端给；视频当前 1） */
  const maxVariants = computed(() => quoteMaxVariants(quote.value))
  const points = computed(() => {
    const q = quote.value
    if (!q) return null
    const n = Math.min(Math.max(variants.value, 1), maxVariants.value)
    return quoteTierPoints(q, n) ?? quoteDisplayPoints(q)
  })
  const eta = computed(() => (quote.value ? quoteEtaText(quote.value) : ''))
  /** 个性化报价且余额不足 */
  const insufficient = computed(() => quote.value?.personalized === true && quote.value.sufficient === false)

  return { quote, state, points, eta, insufficient, maxVariants, retry: () => fetchNow(true) }
}
