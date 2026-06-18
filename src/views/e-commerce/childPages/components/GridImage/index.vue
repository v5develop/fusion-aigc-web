<script lang="ts">
export interface IProps {
  imgList: string[]
  showColorPicker?: boolean
  scrollCallBack?: () => void
}
</script>

<script setup lang="ts">
import { ref } from 'vue'
import ColorPicker from './ColorPicker/index.vue'

const { imgList, showColorPicker = false, scrollCallBack } = defineProps<IProps>()
const imageUrl = defineModel<string>('imageUrl')

const type = ref<'color' | 'image'>()
const color = ref('')

const selectImg = (item: string) => {
  imageUrl.value = item
}
const selectColor = () => {
  imageUrl.value = ''
}
</script>

<template>
  <div
    class="grid-container"
    v-observer-scroll="{
      callback: scrollCallBack,
    }"
  >
    <ColorPicker v-if="showColorPicker" v-model:color="color" @click="selectColor" :selected="type === 'color'" />

    <div
      class="item"
      :class="imageUrl === item ? 'active' : ''"
      v-for="item in imgList"
      :key="item"
      @click="selectImg(item)"
    >
      <img class="img" :src="item" alt="" />
    </div>
  </div>
</template>

<style scoped lang="less">
.grid-container {
  max-height: 400px;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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
