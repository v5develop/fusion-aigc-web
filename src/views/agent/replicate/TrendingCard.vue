<script setup lang="ts">
/**
 * 对话卡片：灵感推荐（CONTRACT §S，replicate_trending）。点一条 = 把它的名字当用户消息发出，卡片不改业务状态。
 */
import { computed } from 'vue'
import type { ReplicateTrending } from '@/api/replicate-card.ts'

const props = defineProps<{ view: ReplicateTrending; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'send', text: string): void }>()
const items = computed(() => (props.view.items ?? []).slice(0, 5))
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="灵感推荐">
    <h3 class="vr-h3">本周{{ view.industry || '同行业' }}复刻最多的改法</h3>
    <p class="vr-sub">点一条，我就按这个改法来做</p>
    <ul v-if="items.length" class="m-0 flex list-none flex-col gap-6px p-0">
      <li v-for="(it, i) in items" :key="i">
        <button
          type="button"
          class="flex w-full min-w-0 cursor-pointer flex-col items-start gap-2px rounded-12px border border-solid border-line bg-surface2 px-12px py-8px text-left transition-colors enabled:hover:border-violet disabled:cursor-not-allowed disabled:opacity-50 focus-visible:(outline outline-2 outline-violet outline-offset-2)"
          :disabled="disabled"
          @click="emit('send', it.label)"
        >
          <span class="max-w-full break-words text-13px font-600 leading-20px text-ink">{{ it.label }}</span>
          <span v-if="it.desc" class="max-w-full break-words text-12px leading-18px text-muted">{{ it.desc }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="m-0 text-12px leading-18px text-muted" role="status">暂时还没有可推荐的改法</p>
    <p class="m-0 mt-8px text-11px leading-16px text-muted">按匿名统计，不含任何人的素材</p>
  </section>
</template>
