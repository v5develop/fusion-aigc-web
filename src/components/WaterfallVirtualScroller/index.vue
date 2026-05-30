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
/*const data = [
  { image: 'https://i.pixiv.re/c/540x540_70/img-master/img/2023/01/13/02/22/26/104469658_p0_master1200.jpg' },
  { image: 'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/26/20/00/00/112053326_p0_master1200.jpg' },
  { image: 'https://i.pixiv.re/c/540x540_70/img-master/img/2022/10/13/01/37/53/101889825_p0_master1200.jpg' },
  { image: 'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/26/20/00/00/112053326_p0_master1200.jpg' },
  { image: 'https://i.pixiv.re/c/540x540_70/img-master/img/2022/10/13/01/37/53/101889825_p0_master1200.jpg' },
  { image: 'https://i.pixiv.re/c/540x540_70/img-master/img/2023/09/26/20/00/00/112053326_p0_master1200.jpg' },
]*/
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
        <img :src="item.url" />
      </div>
    </template>
  </VirtualWaterfall>
</template>

<style scoped lang="less">
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
