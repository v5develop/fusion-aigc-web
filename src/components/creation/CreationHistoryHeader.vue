<script setup lang="ts">
/**
 * 创作页历史列表头（原型「历史记录 · N 条」）：标题 + 进行中数 + 条数 + 可选「刷新」。
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
  <div class="flex-none flex items-center gap-6px pt-12px px-12px pb-12px">
    <h2 :id="titleId || autoId" class="m-0 text-14px font-600 leading-20px text-ink">{{ title }}</h2>
    <span class="ml-auto flex items-center gap-8px">
      <span v-if="running" class="text-11px text-violet-ink">{{ running }} 个进行中</span>
      <span v-if="count !== undefined" class="text-11px text-placeholder">{{ count }} 条</span>
      <button
        v-if="onRefresh"
        type="button"
        class="ll-link !text-11px p-0 border-none bg-transparent outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
        @click="onRefresh()"
      >
        刷新
      </button>
    </span>
  </div>
</template>
