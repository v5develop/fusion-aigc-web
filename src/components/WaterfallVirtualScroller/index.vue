<script setup lang="ts">
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall'
import { useRouter } from 'vue-router'
import useWaterfall from './index.ts'
import type { IFeedRoute } from '@/api/types'
import { canMakeSameStyle, createRouteOf } from '@/utils/same-style'

interface IFeedCard {
  /** 已是水印图（推荐流对外只出水印图），不要再叠一次 withWatermark */
  url: string
  /** 0 表示未知：探测失败或存量数据还没补到，由瀑布流按默认比例占位 */
  width: number
  height: number
  mediaType?: string
  /** 做同款时原样回传这两个 */
  sourceType?: string
  dataId?: number | string
  /** false 时不要展示做同款入口，点了会报错 */
  sameStyle?: boolean
  /** 出自哪个创作入口；可能为空 */
  entryCode?: string | null
  /** 提交口与创作页路由；entryCode 为空时整个对象为 null */
  route?: IFeedRoute | null
}

const { waterfallData } = defineProps<{ waterfallData: IFeedCard[] }>()
const emit = defineEmits<{
  /** 拿到素材真实宽高，交给上层攒批写回 item 触发重排 */
  resolve: [item: IFeedCard, width: number, height: number]
}>()

const router = useRouter()

/**
 * 这条路径本站真的注册过吗。没有 catch-all 路由，未注册时 matched 为空数组。
 * <p>后端 targetRoute 是运营手填的，不验一下就跳，配错的表现是白屏。
 */
const isKnownPath = (path: string) => router.resolve(path).matched.length > 0

/** 去哪个创作页：本地 entryCode 表优先，后端 targetRoute 兜底（详见 utils/sameStyle） */
function entryTarget(item: IFeedCard) {
  return createRouteOf(item, isKnownPath)
}

/** 露不露做同款：后端说支持、场景本期覆盖得到，且确实有地方可跳 */
function canSameStyle(item: IFeedCard) {
  return canMakeSameStyle(item) && !!entryTarget(item) && item.dataId != null && !!item.sourceType
}

/**
 * 做同款：只把作品 id 带过去，配方由目标页自己拉。
 * <p>URL 短、可刷新、可直达；把整份配方塞进 query 既要转义又会超长。
 */
function goSameStyle(item: IFeedCard) {
  const target = entryTarget(item)
  if (!target) return
  // 在目标已有的 query 上追加，不覆盖（后端 targetRoute 可能自带参数）
  const [path, search = ''] = target.split('?')
  const query = new URLSearchParams(search)
  query.set('sameStyleSource', String(item.sourceType))
  query.set('sameStyleId', String(item.dataId))
  router.push(`${path}?${query.toString()}`)
}

const onImgLoad = (item: IFeedCard, e: Event) => {
  const el = e.target as HTMLImageElement
  if (el.naturalWidth > 0 && el.naturalHeight > 0) emit('resolve', item, el.naturalWidth, el.naturalHeight)
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
        <n-image
          :src="item.url"
          width="100%"
          height="100%"
          object-fit="cover"
          :img-props="{ onLoad: (e: Event) => onImgLoad(item, e) }"
        ></n-image>
        <i v-if="item.mediaType === 'video'" class="play-badge"></i>
        <!--
          不做成整卡点击：n-image 自己要吃点击来开预览，抢了它就没法看大图了。
          用一个悬停才出现的按钮，两种交互各归各的。
        -->
        <button v-if="canSameStyle(item)" class="entry-btn" @click.stop="goSameStyle(item)">做同款</button>
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
  right: 16px;
  bottom: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 8px;
  font-family: 'PingFang SC', sans-serif;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  color: #fff;
  background: rgba(0, 0, 0, 0.8);
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
