<script setup lang="ts">
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall'
import { useRouter } from 'vue-router'
import useWaterfall from './index.ts'

const { waterfallData } = defineProps<{
  waterfallData: {
    /** 已是水印图（推荐流对外只出水印图），不要再叠一次 withWatermark */
    url: string
    /** 0 表示未知：探测失败或存量数据还没补到，由瀑布流按默认比例占位 */
    width: number
    height: number
    mediaType?: string
    /** 出自哪个创作入口；可能为空 */
    entryCode?: string | null
    /** 该端创作页路由；为空时按 mediaType 回退通用创作页 */
    route?: string | null
  }[]
}>()

const router = useRouter()

/**
 * 去创作：优先用后端下发的 route，没有就回退通用创作页并带上 entryCode。
 *
 * <b>不因为 route 为空就把按钮藏掉</b>——路由是运营按 (entryCode, platform) 配的，
 * 配漏一条很正常；藏掉的表现是「这个功能的入口凭空消失」，比跳到通用页难查得多。
 * 两个都为空才没得跳（纯展示内容），此时不显示按钮。
 */
function entryTarget(item: { entryCode?: string | null; route?: string | null; mediaType?: string }) {
  if (item.route) return item.route
  if (!item.entryCode) return null
  // 通用创作页只有图片/视频两个，按媒体形态分；query 名与 useEntryCodeFromQuery 约定一致
  const base = item.mediaType === 'video' ? '/video' : '/picture'
  return `${base}?entryCode=${encodeURIComponent(item.entryCode)}`
}

function goCreate(item: Parameters<typeof entryTarget>[0]) {
  const target = entryTarget(item)
  if (!target) return
  // App scheme（如 app://xxx）不能交给 vue-router，它只认站内路径
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    window.location.href = target
    return
  }
  router.push(target)
}

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
        <!--
          不做成整卡点击：n-image 自己要吃点击来开预览，抢了它就没法看大图了。
          用一个悬停才出现的按钮，两种交互各归各的。
        -->
        <button v-if="entryTarget(item)" class="entry-btn" @click.stop="goCreate(item)">
          去创作
        </button>
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
.entry-btn {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 4px 10px;
  border: none;
  border-radius: 12px;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.card:hover .entry-btn {
  opacity: 1;
}
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
