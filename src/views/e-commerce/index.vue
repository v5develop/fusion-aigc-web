<script setup lang="ts">
import { ref } from 'vue'
import Row from './Row/index.vue'

const shangpingtu_data = ref([
  {
    title: 'AI商品套图',
    desc: '上传商品图，一键产出全套电商图',
    bgColor: '#E7DBD2',
    pathName: 'product-kit',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-kit.png',
  },
  {
    title: 'AI详情页',
    desc: '批量生成详情素材，作图更省心',
    bgColor: '#D2E7DA',
    pathName: 'product-detail',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-detail.png',
  },
  {
    title: '爆款图复刻',
    desc: '对标爆款风格，快速复刻同款商图',
    bgColor: '#D2D4E7',
    pathName: 'product-clone',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-clone.png',
  },
  {
    title: '手持商品',
    desc: '自动生成真人手持商品效果图',
    bgColor: '#D2DEE7',
    pathName: 'product-in-hand',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
  },
])
const shangpingshiping_data = ref([
  {
    title: '爆款视频',
    desc: '一键生成适配电商带货短视频',
    bgColor: '#D2E7DA',
    pathName: 'video-hot',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/video-hot.png',
  },
  {
    title: '视频复刻',
    desc: '复刻热门视频画面，降低创作成本',
    bgColor: '#E7DBD2',
    pathName: 'video-clone',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/video-clone.png',
  },
  {
    title: '商品替换',
    desc: '保留场景，一键替换画面内商品',
    bgColor: '#D2DEE7',
    pathName: 'product-replace',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-replace.png',
  },
  {
    title: '模特替换',
    desc: '不变场景，自由更换视频模特',
    bgColor: '#D2D4E7',
    pathName: 'model-replace',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/model-replace.png',
  },
])
const chuandaitu_data = ref([
  {
    title: 'AI穿戴套图',
    desc: '批量生成多模特穿搭展示图',
    bgColor: '#E7DBD2',
    pathName: 'clothing-kit',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-kit.png',
  },
  {
    title: 'AI试衣',
    desc: '上传服饰，真人实景一键上身',
    bgColor: '#D2D4E7',
    pathName: 'clothing-try',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-try.png',
  },
  {
    title: '服装去皱',
    desc: '一键抚平褶皱，服饰质感拉满',
    bgColor: '#E5D2E7',
    pathName: 'clothing-remove-wrinkle',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-remove-wrinkle.png',
  },
  {
    title: '搭配融图',
    desc: '单品融合搭配，直观展示整套穿搭',
    bgColor: '#E7D2D2',
    pathName: 'merge-image',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/merge-image.png',
  },
  {
    title: 'AI试鞋',
    desc: '鞋子上脚实拍，快速生成穿鞋效果图',
    bgColor: '#E0E7D2',
    pathName: 'try-shoe',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/try-shoe.png',
  },
  {
    title: '人像换背景',
    desc: '人像主体保留，随心更换场景背景',
    bgColor: '#D2DEE7',
    pathName: 'change-background',
    url: 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/change-background.png',
  },
])
</script>

<template>
  <div class="commerce">
    <Row :data="shangpingtu_data" title="商品图" />
    <Row style="margin-top: 32px" :data="shangpingshiping_data" title="商品视频" />
    <Row style="margin-top: 32px" :data="chuandaitu_data" title="穿戴图" />
  </div>
</template>

<style scoped lang="less">
.commerce {
  padding: 40px 48px;
}
</style>
