/**
 * 模板示例效果（Go GET /plaza/samples）：按 行业 + 二级 + 模板 取预计算示例成品。
 * 取不到（失败 / 没有）一律当「没有示例」——调用方据此不显示区块，不编造；成功结果按 key 缓存在内存里（切换预览不重复请求）。
 */
import { computed, ref, watch, type Ref } from 'vue'
import { plazaSamples, type IPlazaSample } from '@/api/plaza.ts'

export interface SampleScope {
  industry: string
  subIndustry?: string
  templateId: number
}

const cache = new Map<string, IPlazaSample[]>()
const keyOf = (s: SampleScope) => `${s.industry}|${s.subIndustry ?? ''}|${s.templateId}`

export function useSamples(scope: Ref<SampleScope | null>) {
  const samples = ref<IPlazaSample[]>([])
  const loading = ref(false)
  let seq = 0

  watch(
    () => (scope.value ? keyOf(scope.value) : ''),
    async (k) => {
      const s = scope.value
      const my = ++seq
      if (!k || !s) {
        samples.value = []
        loading.value = false
        return
      }
      const hit = cache.get(k)
      if (hit) {
        samples.value = hit
        loading.value = false
        return
      }
      samples.value = []
      loading.value = true
      try {
        const res = await plazaSamples({ industry: s.industry, subIndustry: s.subIndustry, templateId: s.templateId })
        const list = (res.data?.samples ?? []).filter((x) => x.url)
        cache.set(k, list)
        if (my === seq) samples.value = list
      } catch {
        if (my === seq) samples.value = []
      } finally {
        if (my === seq) loading.value = false
      }
    },
    { immediate: true },
  )

  return { samples, loading, has: computed(() => samples.value.length > 0) }
}
