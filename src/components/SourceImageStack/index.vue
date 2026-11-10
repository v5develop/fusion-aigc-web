<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  images: string[]
  /** 输入视频 URL，回显 0.5s 处的帧作为封面（排在图片之后） */
  video?: string
}>()

const getRotation = (index: number) => (index % 2 === 0 ? -5 : 5)

const containerStyle = computed(() => {
  const n = props.images.length + (props.video ? 1 : 0)
  const width = n === 1 ? 42 : 42 + (n - 1) * 37
  return { width: width + 'px' }
})
</script>

<template>
  <div v-if="images.length || video" class="source-image-stack" :style="containerStyle">
    <div
      v-for="(url, index) in images"
      :key="index"
      class="source-image-stack__thumb"
      :style="{ transform: `rotate(${getRotation(index)}deg)` }"
    >
      <n-image :src="url" alt="原图" width="100%" height="100%" object-fit="cover" />
    </div>
    <div
      v-if="video"
      class="source-image-stack__thumb"
      :style="{ transform: `rotate(${getRotation(images.length)}deg)` }"
    >
      <!-- 媒体片段 #t=0.5 让浏览器停在 0.5s 处的帧作为封面 -->
      <video class="source-image-stack__video" :src="video + '#t=0.5'" preload="metadata" muted />
      <!-- 视频标识：播放小图标 -->
      <div class="source-image-stack__play-badge">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M2 1.2v5.6c0 .32.36.51.63.34l4.2-2.8a.4.4 0 0 0 0-.68l-4.2-2.8A.4.4 0 0 0 2 1.2Z" fill="#fff" />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.source-image-stack {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 4px 0 4px 2px;
  overflow: visible;

  &__thumb {
    width: 38px;
    height: 48px;
    border-radius: 2px;
    border: 0.5px solid #fff;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
    transition:
      transform 0.25s ease,
      box-shadow 0.25s ease;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);

    &:not(:first-child) {
      margin-left: -1px;
    }

    &:hover {
      transform: rotate(0deg) scale(1.2) !important;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    :deep(.n-image) {
      width: 100%;
      height: 100%;
      display: block;

      img {
        object-fit: cover;
      }
    }
  }

  &__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }

  &__play-badge {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
}
</style>
