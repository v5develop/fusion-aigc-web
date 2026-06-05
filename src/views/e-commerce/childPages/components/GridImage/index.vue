<script setup lang="ts">
import { ref, watch } from 'vue'
import ColorPicker from './ColorPicker/index.vue'

const { imgList, showColorPicker = false } = defineProps<{
  imgList: any[]
  showColorPicker?: boolean
}>()

const index = ref()
const color = ref('')
</script>

<template>
  <div class="grid-container">
    <ColorPicker v-if="showColorPicker" v-model:color="color" @click="index = -1" :selected="index === -1" />
    <div class="item" :class="index === i ? 'active' : ''" v-for="(item, i) in imgList" :key="item" @click="index = i">
      <img class="img" :src="item" alt="" />
    </div>
  </div>
</template>

<style scoped lang="less">
.grid-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  > .item {
    aspect-ratio: 1/1;
    background: #f5f6f8;
    border-radius: 8px;
    border: 2px solid transparent;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.1s;
    &:hover {
      border-color: var(--main-color);
    }
    &.active {
      border-color: var(--main-color);
    }
    > .img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
}
</style>
