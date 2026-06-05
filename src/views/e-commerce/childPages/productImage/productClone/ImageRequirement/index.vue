<script setup lang="ts">
import { ref } from 'vue'

const { imgList } = defineProps<{
  imgList: any[]
}>()

const value = ref('')
</script>

<template>
  <div class="image-requirement" v-show="imgList.length">
    <div class="title">单张参考要求</div>
    <div class="desc">每张参考图可单独备注参考要求，不填默认处理。</div>

    <div class="list">
      <div class="item" v-for="(item, i) in [...imgList]" :key="item">
        <span class="name">参考图{{ i + 1 }}</span>
        <n-input v-model:value="value" type="text" placeholder="请输入" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.image-requirement {
  width: 336px;
  border-radius: 8px;
  background: #f5f6f8;
  padding: 16px;
  > .title {
    color: #3a3a3a;
  }
  > .desc {
    font-size: 12px;
    color: #8f8f8f;
  }
  > .list {
    > .item {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      > .name {
        flex-shrink: 0;
      }
    }
  }
}
</style>
