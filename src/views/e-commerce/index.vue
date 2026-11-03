<script setup lang="ts">
import Row from './Row/index.vue'
import { chuandaitu_data, shangpingshiping_data, shangpingtu_data } from './entries'
</script>

<template>
  <div class="flex flex-col gap-28px p-24px">
    <Row :data="shangpingtu_data" title="商品图" />
    <Row :data="shangpingshiping_data" title="商品视频" />
    <Row :data="chuandaitu_data" title="穿戴图" />
  </div>
</template>
