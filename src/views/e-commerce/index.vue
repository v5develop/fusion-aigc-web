<script setup lang="ts">
import { ref } from 'vue'
import Row from './Row/index.vue'

const shangpingtu_data = ref([
  {
    title: 'AI商品套图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7DBD2',
    pathName: 'product-kit',
    url: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/6.jpg?OSSAccessKeyId=LTAI5t9XDKPDFxEZgeJ3qbt9&Expires=1780655169&Signature=ALa7LGKFsrhbrHK%2Fw6xy5eQKZHE%3D',
  },
  {
    title: 'AI详情页',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2E7DA',
    pathName: 'product-detail',
  },
  {
    title: '爆款图复刻',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2D4E7',
    pathName: 'product-clone',
  },
  {
    title: '手持商品',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2DEE7',
    pathName: 'product-in-hand',
  },
])
const shangpingshiping_data = ref([
  {
    title: '视频复刻',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7DBD2',
    pathName: 'video-clone',
  },
  {
    title: '爆款视频',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2E7DA',
    pathName: 'video-hot',
  },
  {
    title: '模特替换',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2D4E7',
    pathName: 'model-replace',
  },
  {
    title: '商品替换',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2DEE7',
    pathName: 'product-replace',
  },
])
const chuandaitu_data = ref([
  {
    title: '人像换背景',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2DEE7',
    pathName: 'change-background',
  },
  {
    title: 'AI穿戴套图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7DBD2',
    pathName: 'clothing-kit',
  },
  {
    title: 'AI试衣',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#D2D4E7',
    pathName: 'clothing-try',
  },
  {
    title: '服装去皱',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E5D2E7',
    pathName: 'clothing-remove-wrinkle',
  },
  {
    title: '搭配融图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E7D2D2',
    pathName: 'merge-image',
  },
  {
    title: 'AI试鞋',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E0E7D2',
    pathName: 'try-shoe',
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
  padding: 40px  48px;
}
</style>
