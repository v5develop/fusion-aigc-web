<script setup lang="ts">
import { computed } from 'vue'
import imageIcon from '@/assets/icons/fallback-image.svg?raw'
import videoIcon from '@/assets/icons/fallback-video.svg?raw'
import blockedIcon from '@/assets/icons/fallback-blocked.svg?raw'

// 图片/视频失败占位：白底 + 图标 + 文案，自适应父容器
// reason 区分场景：generateFailed=生成失败 timeout=超时 loadFailed=加载失败 blocked=违规
const { type = 'image', reason = 'generateFailed' } = defineProps<{
  type?: 'image' | 'video'
  reason?: 'generateFailed' | 'timeout' | 'loadFailed' | 'blocked'
}>()

const icon = computed(() => {
  if (reason === 'blocked') return blockedIcon // 裂图 + 红色禁止角标
  return type === 'video' ? videoIcon : imageIcon
})
const text = computed(() => {
  const isVideo = type === 'video'
  switch (reason) {
    case 'blocked':
      return '存在违规内容'
    case 'timeout':
      // 分两行显示（\n 配合文字的 whitespace-pre-line）
      return isVideo ? '视频还在来的路上\n请重新生成' : '图片还在来的路上\n请重新生成'
    case 'loadFailed':
      return isVideo ? '视频加载不出来，猫干的' : '图片已被小猫撕碎'
    default: // generateFailed
      return isVideo ? '视频生成失败\n请重新生成' : '图片生成失败\n请重新生成'
  }
})
</script>

<template>
  <!-- 作为容器查询上下文：图标/文字用 cqw 随卡片宽度等比缩放（基准卡片宽 200px → 图标 40px、文字 14px） -->
  <div
    class="w-full h-full [container-type:inline-size] flex flex-col items-center justify-center gap-[clamp(2px,2cqw,4px)] bg-white"
  >
    <!-- 40 / 200 = 20cqw，clamp 兜底极端尺寸 -->
    <span
      class="inline-flex w-[clamp(20px,20cqw,48px)] h-[clamp(20px,20cqw,48px)] [&_svg]:(block w-full h-full)"
      v-html="icon"
    ></span>
    <!-- 14 = 200×7cqw；行高 20/14≈1.43 随字号缩放；pre-line 让文案中的 \n 换行生效 -->
    <span
      class="[font-size:clamp(10px,7cqw,16px)] leading-[1.43] text-placeholder text-center px-6px whitespace-pre-line"
      >{{ text }}</span
    >
  </div>
</template>
