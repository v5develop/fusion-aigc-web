<script setup lang="ts">
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall'
import useWaterfall from './index.ts'

const { waterfallData } = defineProps<{
  waterfallData: {
    /** 已是水印图（推荐流对外只出水印图），不要再叠一次 withWatermark */
    url: string
    /** 0 表示未知：探测失败或存量数据还没补到，由瀑布流按默认比例占位 */
    width: number
    height: number
    mediaType?: string
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
<!--        <img v-if="item.mediaType === 'image'" class="img" :src="item.url" alt="" />-->
        <!--
          两种形态都按图渲染：视频条目的 url 是后端抽好的封面帧，不是 mp4，
          塞进 <video> 放不出来。列表位也不该加载 mp4——一屏几十条会把带宽吃光，
          真要播放走详情态的 urls。是不是视频看 mediaType，不看 URL 后缀：
          签名地址没有可比后缀。
        -->
        <n-image :src="item.url" width="100%" height="100%" object-fit="cover"></n-image>
        <i v-if="item.mediaType === 'video'" class="play-badge"></i>
      </div>
    </template>
  </VirtualWaterfall>
</template>

<style scoped lang="less">
/* 角标绝对定位的参照系。card 原先没有定位上下文，不加这行角标会飘到最近的定位祖先上 */
.card {
  position: relative;
}
/*.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}*/
.play-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.play-badge::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 54%;
  transform: translate(-50%, -50%);
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent #fff;
}
</style>
