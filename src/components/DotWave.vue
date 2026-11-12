<script setup lang="ts">
/**
 * 「生成中」点阵波（原型 5186 DotWave）：4 × 5 点阵，按行列错峰 80ms、1.2s 一轮，任务结束即卸载。
 * 只做功能态动效，不当静态装饰；颜色走主题 token（深色自动跟随）；prefers-reduced-motion 下静止。
 */
withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'sm' })

const DOTS = Array.from({ length: 20 }, (_, index) => {
  const row = Math.floor(index / 4)
  const col = index % 4
  return { key: index, delay: `${((row + col) * 0.08).toFixed(2)}s` }
})
</script>

<template>
  <span class="dot-wave" :class="`is-${size}`" aria-hidden="true">
    <i v-for="dot in DOTS" :key="dot.key" :style="{ '--d': dot.delay }" />
  </span>
</template>

<style scoped>
.dot-wave {
  display: grid;
  --ds: 4px;
  --dg: 3px;
  grid-template-columns: repeat(4, var(--ds));
  grid-auto-rows: var(--ds);
  gap: var(--dg);
  place-content: center;
}
.dot-wave.is-md {
  --ds: 6px;
  --dg: 4px;
}
.dot-wave i {
  width: var(--ds);
  height: var(--ds);
  border-radius: 50%;
  background: var(--xq-violet);
  opacity: 0.18;
  animation: dot-wave-pulse 1.2s var(--d, 0s) ease-in-out infinite;
}
@keyframes dot-wave-pulse {
  0%,
  100% {
    opacity: 0.16;
    transform: scale(0.8);
  }
  45% {
    opacity: 0.95;
    transform: scale(1.15);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot-wave i {
    animation: none;
    opacity: 0.5;
  }
}
</style>
