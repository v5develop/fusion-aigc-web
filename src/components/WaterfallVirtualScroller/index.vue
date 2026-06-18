<script setup lang="ts">
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall'
import useWaterfall from './index.ts'

const { waterfallData } = defineProps<{
  waterfallData: {
    url: string
    width: number
    height: number
  }[]
}>()

const { waterfallOption, calcItemHeight } = useWaterfall()
</script>

<template>
  <div></div>
  <VirtualWaterfall
    :items="waterfallData"
    v-bind="{ ...waterfallOption }"
    :preload-screen-count="[waterfallOption.topPreloadScreenCount, waterfallOption.bottomPreloadScreenCount]"
    :calc-item-height="calcItemHeight"
  >
    <template #default="{ item }">
      <div class="card">
        <img v-if="item.mediaType === 'image'" class="img" :src="item.url" alt="" />
        <video v-else class="video" :src="item.url" controls></video>
      </div>
    </template>
  </VirtualWaterfall>
</template>

<style scoped lang="less">
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.video {
  width: 100%;
  height: 100%;
}
</style>
