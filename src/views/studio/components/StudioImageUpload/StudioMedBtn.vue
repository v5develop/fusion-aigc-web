<script setup lang="ts">
/**
 * 浮在图上的 20 圆钮（s1.1 `.sx-medbtn`）：1px #c9cfd6 + 白→#f7f8f9 渐变 + 内高光 + 内白圈 + 短投影，
 * 图标 12；点击区靠 ::after 外扩 6px 撑到 32（触屏外扩 12 → 44）。位置 / 显隐由调用方通过 class 决定。
 */
const { label } = defineProps<{
  /** 无障碍名称（同时作 title） */
  label: string
}>()
</script>

<template>
  <button
    type="button"
    class="absolute z-12 grid w-20px h-20px min-w-20px place-items-center p-0 leading-0 border border-solid border-#c9cfd6 rounded-full bg-gradient-to-b from-white to-surface2 text-ink-2 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),inset_0_0_0_1px_rgba(255,255,255,0.7),0_1px_3px_rgba(31,35,41,0.18)] hover:border-violet hover:text-violet-ink active:from-surface3 active:to-white focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2 [&_svg]:block [&_svg]:w-12px [&_svg]:h-12px after:content-[''] after:absolute after:-inset-6px [@media(pointer:coarse)]:after:-inset-12px"
    :aria-label="label"
    :title="label"
  >
    <slot />
  </button>
</template>
