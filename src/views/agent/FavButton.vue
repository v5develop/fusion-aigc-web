<script setup lang="ts">
/**
 * 收藏 ♡ 按钮（EXPERIENCE 3.4.3 C-05）：乐观切换，失败回滚并提示；未登录弹登录半屏（不跳页）；aria-pressed。
 * 卡片 / 头条封面右上角用 floating（悬停或聚焦显现，已收藏常显，触屏常显）；预览里用 inline（带文字）。
 * 触控目标 ≥ 44px：用 ::after 外扩点击区，视觉大小不变。
 */
import { computed } from 'vue'
import { useMessage } from 'naive-ui'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import { isFavorite, toggleFavorite } from './industry/useFavorites.ts'

const props = withDefaults(
  defineProps<{ item: Pick<IPlazaTemplate, 'plazaTemplateId' | 'title'>; variant?: 'floating' | 'inline' }>(),
  { variant: 'floating' },
)
const message = useMessage()
const on = computed(() => isFavorite(props.item.plazaTemplateId))

async function click(e: Event) {
  e.stopPropagation()
  await toggleFavorite(props.item, (t) => message.warning(t))
}
</script>

<template>
  <button
    type="button"
    :class="['fav-btn', variant === 'inline' ? 'fav-inline' : 'fav-float', on ? 'is-on' : '']"
    :aria-pressed="on"
    :aria-label="on ? `取消收藏：${item.title}` : `收藏：${item.title}`"
    :title="on ? '取消收藏' : '收藏'"
    data-testid="plaza-fav"
    @click="click"
  >
    <svg class="fav-icon" viewBox="0 0 24 24" :fill="on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.8 3.6 5 6.6 5c1.9 0 3.7 1 5.4 3.1C13.7 6 15.5 5 17.4 5c3 0 4.9 2.8 3.8 6.1-1.7 4.8-9.2 9.4-9.2 9.4z" />
    </svg>
    <span v-if="variant === 'inline'" class="fav-text">{{ on ? '已收藏' : '收藏' }}</span>
  </button>
</template>

<style scoped>
.fav-btn {
  position: relative;
  display: inline-grid;
  place-items: center;
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--xq-ink-2, #4e5969);
  cursor: pointer;
}
.fav-btn::after {
  content: '';
  position: absolute;
  inset: -8px;
}
.fav-btn:focus-visible {
  outline: 2px solid var(--xq-violet, #875f9a);
  outline-offset: 2px;
}
.fav-float {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.88);
  backdrop-filter: blur(6px);
  opacity: 0;
  transition: opacity 0.14s ease;
}
.fav-inline {
  grid-auto-flow: column;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border-radius: 16px;
  background: transparent;
  font-size: 12px;
}
.fav-inline:hover {
  background: rgb(0 0 0 / 0.05);
}
.fav-icon {
  width: 16px;
  height: 16px;
}
.is-on {
  color: var(--xq-violet-top, #875f9a);
}
.is-on .fav-icon {
  animation: fav-pop 120ms ease-out;
}
.fav-float.is-on,
.fav-float:focus-visible,
:global(.fav-host:hover) .fav-float {
  opacity: 1;
}
@media (hover: none) {
  .fav-float {
    opacity: 1;
  }
}
@keyframes fav-pop {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.25);
  }
  100% {
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-on .fav-icon {
    animation: none;
  }
  .fav-float {
    transition: none;
  }
}
</style>
