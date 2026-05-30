<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Row from './Row/index.vue'

const shangpingtu_data = ref([
  {
    title: 'AI商品套图',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#F5EBE6',
  },
  {
    title: 'AI详情页',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E8F5F0',
  },
  {
    title: '爆款图复刻',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#EBE6F5',
  },
  {
    title: '手持商品',
    desc: '无需提示词，一键生成全套电商图。',
    bgColor: '#E6F0F5',
  },
])
</script>

<template>
  <div class="commerce">
    <Row :data="shangpingtu_data" />
  </div>
</template>

<style scoped lang="less">
.commerce {
  padding: 40px 48px;
}
</style>
