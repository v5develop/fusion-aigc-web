<script setup lang="ts">
/** 纯展示：分析阶段列表（done / active / pending / skipped）。阶段与文案全部来自后端 stages。 */
import type { ReplicateStage } from '@/api/replicate.ts'

defineProps<{ stages: readonly Pick<ReplicateStage, 'key' | 'label' | 'status'>[] }>()
</script>

<template>
  <ol class="m-0 flex list-none flex-col gap-8px p-0" aria-live="polite">
    <li
      v-for="t in stages"
      :key="t.key"
      :class="['flex items-center gap-8px text-13px', t.status === 'done' || t.status === 'skipped' ? 'text-ink-2' : t.status === 'active' ? 'font-600 text-ink' : 'text-placeholder']"
    >
      <span
        :class="[
          'grid h-16px w-16px flex-none place-items-center rounded-full border border-solid',
          t.status === 'done' ? 'border-success bg-success text-white' : t.status === 'active' ? 'border-violet' : 'border-line',
        ]"
        aria-hidden="true"
      >
        <svg v-if="t.status === 'done'" class="h-10px w-10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <i v-else-if="t.status === 'active'" class="vr-pulse block h-6px w-6px rounded-full bg-violet" />
      </span>
      {{ t.label }}<small v-if="t.status === 'skipped'" class="ml-6px text-11px text-placeholder">原片没有声音，已跳过</small>
    </li>
  </ol>
</template>
