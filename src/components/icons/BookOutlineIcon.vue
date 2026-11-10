<script setup lang="ts">
/**
 * 「我的提示词」书本图标：ionicons5 BookOutline（MIT，https://ionic.io/ionicons），与 5185 原型 MlReferenceHead 同一稿。
 * 项目不依赖 @vicons/ionicons5，这里原样内联它的 SVG；尺寸默认 15（原型 24 视觉钮里的图标尺寸）。
 */
const { size = 15 } = defineProps<{ size?: number }>()
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="32"
    aria-hidden="true"
  >
    <path
      d="M256 160c16-63.16 76.43-95.41 208-96a15.94 15.94 0 0 1 16 16v288a16 16 0 0 1-16 16c-128 0-177.45 25.81-208 64c-30.37-38-80-64-208-64c-9.88 0-16-8.05-16-17.93V80a15.94 15.94 0 0 1 16-16c131.57.59 192 32.84 208 96z"
    />
    <path d="M256 160v288" />
  </svg>
</template>
