<script setup lang="ts">
/**
 * 纯展示：费用块（大数字 + 分段报价表 + 规则文案）。点数只取后端报价，不在这里推算。
 * 页面特有的动态行（更新中 / 余额 / 有效期 / 提示词）通过插槽接回：status 在大数字下，foot 在规则文案之后。
 */
import { computed } from 'vue'
import type { ReplicateCost } from '@/api/replicate.ts'
import { fmtPts } from '../constants.ts'

const props = defineProps<{
  cost: ReplicateCost
  /** 本次要花的点数（先做第 1 段 = 第 1 段报价） */
  points: number
  /** 多段且只先做第 1 段 */
  staged: boolean
  /** 预计耗时文案（可空） */
  eta?: string
  /** 成片规则文案（水印等） */
  policyText?: string
  /** 紧凑模式（对话卡片）：不显示标题说明与分段表 */
  compact?: boolean
}>()
const lead = computed(() => (props.staged ? props.cost.firstText : props.cost.totalText))
</script>

<template>
  <div>
    <template v-if="!compact">
      <h3 class="vr-h3">费用</h3>
      <p class="vr-sub">{{ cost.explain }}</p>
    </template>
    <div class="flex flex-wrap items-baseline gap-10px">
      <b :class="compact ? 'text-20px' : 'text-24px'" class="font-700 tabular-nums text-ink">{{ fmtPts(points) }} 点</b>
      <span class="text-13px text-ink-2">{{ lead }}{{ eta ? ` · ${eta}` : '' }}</span>
    </div>
    <p v-if="staged" class="m-0 mt-4px text-12px leading-18px text-ink-2">{{ cost.restText }} · {{ cost.totalText }}</p>
    <slot name="status" />
    <table v-if="!compact && cost.lines.length > 1" class="mt-10px w-full border-collapse text-12px" aria-label="分段报价">
      <tbody>
        <tr v-for="l in cost.lines" :key="l.index" class="border-0 border-t border-solid border-line">
          <td class="py-6px text-ink-2">第 {{ l.index }} 段 · {{ l.seconds }} 秒{{ staged && l.index > 1 ? '（满意后再做）' : '' }}</td>
          <td class="py-6px text-right tabular-nums">{{ fmtPts(l.points) }} 点</td>
        </tr>
        <tr class="border-0 border-t border-solid border-line font-600">
          <td class="py-6px">合计</td>
          <td class="py-6px text-right tabular-nums">{{ fmtPts(cost.total) }} 点</td>
        </tr>
      </tbody>
    </table>
    <p v-if="policyText" class="m-0 mt-8px text-12px text-muted">{{ policyText }}</p>
    <slot name="mid" />
    <p v-if="!compact" class="m-0 mt-4px text-12px leading-18px text-placeholder">{{ cost.holdText }}</p>
    <slot name="foot" />
  </div>
</template>
