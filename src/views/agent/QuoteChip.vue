<script setup lang="ts">
/**
 * 发送钮旁的价格与预计时间（M-08「预计 {n} 点数 · 约 {s} 秒」）：全页唯一的价格数字，来自 /plaza/quote。
 * 报价中是骨架条；取不到显示「点数以发送时为准」+ 重试，不阻止发送；匿名且报价源不可用显示「登录后查看报价」。
 */
import { computed } from 'vue'
import type { IPlazaQuote } from '@/api/plaza.ts'

const props = defineProps<{
  state: 'idle' | 'loading' | 'ok' | 'error' | 'login'
  points: number | null
  eta: string
  quote: IPlazaQuote | null
  insufficient?: boolean
}>()
const emit = defineEmits<{ retry: [] }>()

const title = computed(() => {
  const q = props.quote
  if (!q) return undefined
  if (q.stale) return '价格可能略有出入，以发送时为准'
  if (q.turnPriceUnavailable) return '轮次费以实际为准'
  return q.personalized ? '含本轮对话费用，以发送时为准' : '标价，登录后显示含对话费用的实际价'
})
</script>

<template>
  <span
    v-if="state !== 'idle'"
    class="mr-6px flex min-w-0 flex-none items-center gap-6px whitespace-nowrap text-12px leading-18px text-ink-2 max-sm:text-11px"
    role="status"
    aria-live="polite"
    data-testid="plaza-quote"
    :title="title"
  >
    <span v-if="state === 'loading'" class="inline-block h-14px w-96px animate-pulse rounded-4px bg-surface3" aria-label="正在取价格" />
    <template v-else-if="state === 'ok'">
      <span>
        预计 <b class="font-600 text-ink tabular-nums">{{ points }}</b> 点数<template v-if="eta"> · {{ eta }}</template>
      </span>
      <span v-if="quote?.turnPriceUnavailable" class="text-muted">轮次费以实际为准</span>
      <span v-if="insufficient" class="text-danger-strong">点数不足</span>
    </template>
    <span v-else-if="state === 'login'" class="text-muted">登录后查看报价</span>
    <template v-else>
      <span class="text-muted">点数以发送时为准</span>
      <button
        type="button"
        class="border-none bg-transparent p-0 text-12px text-violet-ink cursor-pointer hover:text-violet-press focus-visible:(outline outline-2 outline-violet outline-offset-2)"
        @click="emit('retry')"
      >
        重试
      </button>
    </template>
  </span>
</template>
