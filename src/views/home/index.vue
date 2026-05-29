<script setup lang="ts">
import { ref } from 'vue'
import Upload from '@/components/Upload/index.vue'

const value = ref(0)
const options = [
  {
    label: '灵动图像 2.0',
    value: 0,
  },
  {
    label: 'gpt',
    value: 1,
  },
]
</script>

<template>
  <div class="home">
    <div class="top_bg"></div>

    <h1>和我聊聊，你想要什么设计～</h1>

    <div class="chatContent">
      <div class="mainContent">
        <div class="uploadCont">
          <Upload />
        </div>

        <div class="textareaCont" contenteditable></div>
      </div>

      <div class="bottomContent">
        <n-select style="width: 100px" v-model:value="value" :options="options" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './index.less';
</style>
