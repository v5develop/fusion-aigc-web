<script setup lang="ts">
/**
 * 创作页历史列表头（原型 StudioHistoryColumn `.v3-hist__head`）：最小高 24，标题 14/600 + 进行中数 + 条数（11 muted）
 * + 可选「刷新」（头部操作按钮：高 24、内边距 0 8、r3、11/500，材质同 .sx-btn）。与下方列表隔 8。
 *
 * <p>「刷新」只在页面监听了 @refresh 时出现（onRefresh 作为 prop 声明，借此判断有没有监听）。
 */
import { useId } from 'vue'

const {
  title = '历史记录',
  count,
  running = 0,
  titleId,
  onRefresh,
} = defineProps<{
  title?: string
  /** 条数；不传不显示 */
  count?: number
  /** 进行中的条数；0 不显示 */
  running?: number
  /** 标题元素 id（给外层 aria-labelledby 用）；不传自动生成 */
  titleId?: string
  /** 监听 @refresh 即显示「刷新」 */
  onRefresh?: () => void
}>()

const autoId = `creation-history-title-${useId()}`
</script>

<template>
  <div class="flex-none flex items-center gap-6px min-h-32px pt-12px px-12px pb-8px">
    <h2 :id="titleId || autoId" class="m-0 text-14px font-600 leading-20px text-ink">{{ title }}</h2>
    <span class="ml-auto flex items-center gap-8px">
      <span v-if="running" class="text-11px leading-16px text-violet-ink">{{ running }} 个进行中</span>
      <span v-if="count !== undefined" class="text-11px leading-16px text-muted tabular-nums">{{ count }} 条</span>
      <button
        v-if="onRefresh"
        type="button"
        class="h-32px box-border px-12px rounded-4px border border-solid border-#c9cfd6 bg-[linear-gradient(#fff,#fbfcfc)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-13px font-500 leading-30px text-ink-2 whitespace-nowrap cursor-pointer hover:(border-#aeb6bf text-ink) outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        @click="onRefresh()"
      >
        刷新
      </button>
    </span>
  </div>
</template>
