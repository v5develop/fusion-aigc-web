<script setup lang="ts">
/**
 * 结果区「再来一版（N 点）」「一次出 2–4 版（N 点）」。
 * 点击只把设置填回输入框并显示价格，**不自动发送**，由用户点发送（emit fill）。
 * 价格取该模板的报价（单价 × 版数 + 登录用户的一轮对话费）；取不到价格时按钮只写文字，不编造数字。
 * 只用于图片模板（视频模板去「生成视频」页，不会走到这里）；maxVariants<2 时只显示「再来一版」。
 */
import { computed, onMounted, ref } from 'vue'
import { plazaQuote, quoteMaxVariants, quoteTierPoints, type IPlazaQuote, type PlazaResolution } from '@/api/plaza.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'

const props = defineProps<{
  template: IPlazaTemplate
  scope: { industry: string; subIndustry?: string } | null
  /** 上一轮实际发出的参考图张数（再来一版沿用） */
  refImageCount?: number
  /** 上一轮所选清晰度（再来一版沿用，价格按它报） */
  resolution?: PlazaResolution
  /** 这一轮已经存为我的模板（按钮变成「已存为我的模板」，不可再点） */
  saved?: boolean
}>()
const emit = defineEmits<{ fill: [variants: number]; save: [] }>()

const quote = ref<IPlazaQuote | null>(null)
onMounted(async () => {
  if (!props.scope) return
  try {
    const res = await plazaQuote({ ...props.scope, templateId: props.template.plazaTemplateId, variants: 1, refImageCount: props.refImageCount, resolution: props.resolution })
    quote.value = res.data ?? null
  } catch {
    quote.value = null // 取不到就不显示点数
  }
})

const max = computed(() => quoteMaxVariants(quote.value))
const again = computed(() => (quote.value ? quoteTierPoints(quote.value, 1) : null))
const multi = computed(() => {
  const q = quote.value
  if (!q || max.value < 2) return ''
  const lo = quoteTierPoints(q, 2)
  const hi = quoteTierPoints(q, max.value)
  if (lo == null || hi == null) return ''
  return lo === hi ? `${lo} 点` : `${lo}–${hi} 点`
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-8px" data-testid="plaza-again">
    <button type="button" class="sx-soft-btn" data-testid="plaza-again-one" @click="emit('fill', 1)">
      再来一版<template v-if="again != null">（{{ again }} 点）</template>
    </button>
    <button v-if="max >= 2" type="button" class="sx-soft-btn" data-testid="plaza-again-multi" @click="emit('fill', 2)">
      一次出 2–{{ max }} 版<template v-if="multi">（{{ multi }}）</template>
    </button>
    <button v-if="scope" type="button" class="sx-soft-btn" :disabled="saved" data-testid="plaza-save-mine-btn" @click="emit('save')">
      {{ saved ? '已存为我的模板' : '存为我的模板' }}
    </button>
    <span class="text-11px leading-16px text-placeholder">只填好设置，点发送才会开始</span>
  </div>
</template>
