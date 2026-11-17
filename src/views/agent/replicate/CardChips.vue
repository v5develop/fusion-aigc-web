<script setup lang="ts">
/**
 * 跨轮进度提示：后面的回复里又出现了「卡片在更早那条回复里」的帧时，只在这里显示一行精简提示；
 * 点「查看」滚动到原卡片并短暂高亮（卡片本身仍在第一次出现处原位更新）。
 */
import { CARD_ANCHOR_ATTR, cardChipText, type ReplicateCardFrame } from '@/api/replicate-card.ts'
import '@/views/video-replicate/video-replicate.css'

defineProps<{ frames: ReplicateCardFrame[] }>()

function locate(key: string) {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`[${CARD_ANCHOR_ATTR}]`)).find(
    (e) => e.getAttribute(CARD_ANCHOR_ATTR) === key,
  )
  if (!el) return
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' })
  el.classList.remove('vr-flash')
  void el.offsetWidth // 重新触发动画
  el.classList.add('vr-flash')
  window.setTimeout(() => el.classList.remove('vr-flash'), 1800)
}
</script>

<template>
  <div v-if="frames.length" class="flex flex-col gap-6px">
    <div
      v-for="f in frames"
      :key="f.key"
      class="flex max-w-480px items-center gap-8px rounded-full bg-violet-tint px-12px py-6px text-12px leading-18px text-ink-2"
      role="status"
    >
      <svg class="h-14px w-14px flex-none text-violet-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
      <span class="min-w-0 flex-1 truncate">{{ cardChipText(f) }}</span>
      <button
        type="button"
        class="flex-none cursor-pointer border-none bg-transparent p-0 text-12px font-600 text-violet-ink underline-offset-2 hover:underline focus-visible:(outline outline-2 outline-violet outline-offset-2)"
        @click="locate(f.key)"
      >
        查看
      </button>
    </div>
  </div>
</template>
