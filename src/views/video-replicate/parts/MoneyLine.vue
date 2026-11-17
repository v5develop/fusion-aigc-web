<script setup lang="ts">
/** 纯展示：点数一行（文案以后端 money.text 为准；后端没给文案且 breakdown 打开时，退而列出预留 / 已扣 / 已退的数字，供对话卡片用）。 */
import { computed } from 'vue'
import { fmtPts } from '../constants.ts'

const props = defineProps<{
  money: { held: number; confirmed: number; refunded: number; refundPending: number; text?: string }
  breakdown?: boolean
}>()

const parts = computed(() => {
  const m = props.money
  const out: string[] = []
  if (m.held > 0) out.push(`预留 ${fmtPts(m.held)} 点`)
  if (m.confirmed > 0) out.push(`已扣 ${fmtPts(m.confirmed)} 点`)
  if (m.refunded > 0) out.push(`已退 ${fmtPts(m.refunded)} 点`)
  if (m.refundPending > 0) out.push(`退点处理中 ${fmtPts(m.refundPending)} 点`)
  return out
})
</script>

<template>
  <p v-if="money.text || (breakdown && parts.length)" class="m-0 text-12px tabular-nums text-muted">
    <template v-if="money.text">{{ money.text }}</template>
    <template v-else>{{ parts.join(' · ') }}</template>
  </p>
</template>
