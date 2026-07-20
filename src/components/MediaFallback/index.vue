<script setup lang="ts">
import { computed } from 'vue'
import imageIcon from '@/assets/icons/fallback-image.svg?raw'
import videoIcon from '@/assets/icons/fallback-video.svg?raw'

// 图片/视频加载失败占位：白底 + 裂图图标 + 文案，自适应父容器
const { type = 'image' } = defineProps<{ type?: 'image' | 'video' }>()

const icon = computed(() => (type === 'video' ? videoIcon : imageIcon))
const text = computed(() => (type === 'video' ? '视频加载不出来，猫干的' : '图片已被小猫撕碎'))
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #fff;

  .icon {
    display: inline-flex;
    width: 40px;
    height: 40px;
    :deep(svg) {
      display: block;
      width: 100%;
      height: 100%;
    }
  }

  .text {
    font-size: 14px;
    line-height: 24px;
    color: #8f8f8f;
  }
}
</style>
