<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  images: string[]
}>()

const getRotation = (index: number) => (index % 2 === 0 ? -5 : 5)

const containerStyle = computed(() => {
  const n = props.images.length
  const width = n === 1 ? 42 : 42 + (n - 1) * 37
  return { width: width + 'px' }
})
</script>

<template>
  <div v-if="images.length" class="source-image-stack" :style="containerStyle">
    <div
      v-for="(url, index) in images"
      :key="index"
      class="source-image-stack__thumb"
      :style="{ transform: `rotate(${getRotation(index)}deg)` }"
    >
      <n-image :src="url" alt="原图" width="100%" height="100%" object-fit="cover" />
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
    transition: transform 0.25s ease, box-shadow 0.25s ease;
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
}
</style>
