<script setup lang="ts">
/**
 * 分页条（原型 relay-pager）：上一页 / 「第 x / y 页 · 共 n 个」/ 下一页。只有一页时只显示总数。
 */
import { computed } from 'vue'

const page = defineModel<number>('page', { required: true })
const props = defineProps<{ total: number; pageSize: number; disabled?: boolean }>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

const BTN =
  'sx-squircle inline-flex items-center h-32px px-14px rounded-16px border border-solid border-control bg-gradient-to-b from-white to-soft-bottom text-12px text-ink-2 cursor-pointer ' +
  'hover:enabled:(border-violet-line text-violet-ink bg-white) disabled:(opacity-50 cursor-not-allowed) sx-focus'
</script>

<template>
  <nav
    v-if="total > 0"
    class="flex items-center justify-center gap-12px pt-20px pb-4px text-12px text-muted"
    aria-label="分页"
  >
    <template v-if="pageCount > 1">
      <button type="button" :class="BTN" :disabled="disabled || page <= 1" @click="page -= 1">上一页</button>
      <span class="tabular-nums" aria-live="polite">第 {{ page }} / {{ pageCount }} 页 · 共 {{ total }} 个</span>
      <button type="button" :class="BTN" :disabled="disabled || page >= pageCount" @click="page += 1">下一页</button>
    </template>
    <span v-else class="tabular-nums">共 {{ total }} 个</span>
  </nav>
</template>
