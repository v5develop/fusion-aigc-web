<script setup lang="ts">
/**
 * 没有生成记录时右栏的功能介绍（原型 ToolIntroPanel fill 版）：标题 16 / 600 + 说明 13 / 1.65，
 * 下方放示例图或页面插槽里的示例视频。铺满右栏、内容居中，内边距 24。
 */
const { title, rightDesc, image } = defineProps<{
  title: string
  rightDesc: string
  image?: string
}>()

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL
</script>

<template>
  <div class="absolute inset-0 flex flex-col justify-center gap-24px p-24px box-border overflow-auto">
    <div class="w-full max-w-770px mx-auto text-center">
      <h2 class="m-0 mb-6px sx-title-section">{{ title }}</h2>
      <div class="text-13px leading-[1.65] text-muted" v-html="rightDesc"></div>
    </div>

    <div class="w-full max-w-770px mx-auto">
      <img v-if="image" class="block w-full rounded-lg" :src="VITE_OSS_ASSET_URL + image" :alt="`${title}示例`" />
      <slot></slot>
    </div>
  </div>
</template>
