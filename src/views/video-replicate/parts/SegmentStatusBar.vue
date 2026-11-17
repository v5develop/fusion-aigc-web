<script setup lang="ts">
/** 纯展示：分段状态条（每段一格，颜色随状态）。只收段数据，不碰状态机 / 路由 / 请求。 */
import type { ReplicateSegState } from '@/api/replicate.ts'

defineProps<{ segments: { index: number; state: ReplicateSegState; stateLabel: string }[] }>()
</script>

<template>
  <div class="flex gap-4px" aria-label="分段状态">
    <div
      v-for="s in segments"
      :key="s.index"
      :class="[
        'flex min-w-0 flex-1 flex-col gap-2px rounded-10px border border-solid px-8px py-6px text-center',
        s.state === 'succeeded'
          ? 'border-success-line bg-success-soft'
          : s.state === 'failed'
            ? 'border-danger-line bg-danger-soft'
            : s.state === 'running'
              ? 'border-violet-line bg-violet-tint'
              : 'border-line bg-surface2',
      ]"
    >
      <b class="text-12px font-600 text-ink">第 {{ s.index }} 段</b>
      <span class="text-11px text-muted">{{ s.stateLabel }}</span>
    </div>
  </div>
</template>
