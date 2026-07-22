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
      // 分两行显示（\n 配合 .text 的 white-space: pre-line）
      return isVideo ? '视频还在来的路上\n请重新生成' : '图片还在来的路上\n请重新生成'
    case 'loadFailed':
      return isVideo ? '视频加载不出来，猫干的' : '图片已被小猫撕碎'
    default: // generateFailed
      return isVideo ? '视频生成失败\n请重新生成' : '图片生成失败\n请重新生成'
  }
})
</script>

<template>
  <div class="media-fallback">
    <span class="icon" v-html="icon"></span>
    <span class="text">{{ text }}</span>
  </div>
</template>

<style scoped lang="less">
.media-fallback {
  width: 100%;
  height: 100%;
  // 作为容器查询上下文：内部图标/文字用 cqw 随卡片宽度等比缩放（基准设计稿卡片宽 200px → 图标 40px、文字 14px）
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(2px, 2cqw, 4px);
  background: #fff;

  .icon {
    display: inline-flex;
    // 40 / 200 = 20cqw，clamp 兜底极端尺寸
    width: clamp(20px, 20cqw, 48px);
    height: clamp(20px, 20cqw, 48px);
    :deep(svg) {
      display: block;
      width: 100%;
      height: 100%;
    }
  }

  .text {
    // 设计稿：14px / 行高 20px / #8F8F8F。14 = 200×7cqw；行高用无单位 20/14≈1.43 使其随字号缩放
    font-size: clamp(10px, 7cqw, 16px);
    line-height: 1.43;
    color: #8f8f8f;
    text-align: center;
    padding: 0 6px;
    // 文案中的 \n 换行生效（超时/生成失败为两行）
    white-space: pre-line;
  }
}
</style>
