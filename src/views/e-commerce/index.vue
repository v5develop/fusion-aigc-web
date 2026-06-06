<script setup lang="ts">
import { ref } from 'vue'
import Row from './Row/index.vue'

const shangpingtu_data = ref([
  {
    title: 'AI商品套图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7DBD2',
    pathName: 'product-kit',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-kit.png',
  },
  {
    title: 'AI详情页',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2E7DA',
    pathName: 'product-detail',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-detail.png',
  },
  {
    title: '爆款图复刻',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2D4E7',
    pathName: 'product-clone',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-clone.png',
  },
  {
    title: '手持商品',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2DEE7',
    pathName: 'product-in-hand',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
  },
])
const shangpingshiping_data = ref([
  {
    title: '爆款视频',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2E7DA',
    pathName: 'video-hot',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/video-hot.png',
  },
  {
    title: '视频复刻',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7DBD2',
    pathName: 'video-clone',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/video-clone.png',
  },
  {
    title: '商品替换',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2DEE7',
    pathName: 'product-replace',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-replace.png',
  },
  {
    title: '模特替换',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2D4E7',
    pathName: 'model-replace',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/model-replace.png',
  },
])
const chuandaitu_data = ref([
  {
    title: 'AI穿戴套图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7DBD2',
    pathName: 'clothing-kit',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-kit.png',
  },
  {
    title: 'AI试衣',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2D4E7',
    pathName: 'clothing-try',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-try.png',
  },
  {
    title: '服装去皱',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E5D2E7',
    pathName: 'clothing-remove-wrinkle',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-remove-wrinkle.png',
  },
  {
    title: '搭配融图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7D2D2',
    pathName: 'merge-image',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/merge-image.png',
  },
  {
    title: 'AI试鞋',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E0E7D2',
    pathName: 'try-shoe',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/try-shoe.png',
  },
  {
    title: '人像换背景',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2DEE7',
    pathName: 'change-background',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/change-background.png',
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
