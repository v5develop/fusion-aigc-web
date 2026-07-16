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
@import '@/assets/variables.less';
.grid-container {
  max-height: 400px;
  overflow: auto;
  .scrollbar(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  > .item {
    // 用 padding-bottom 百分比撑出正方形，不依赖 aspect-ratio
    // （旧内核不支持、部分 Chromium 在非整数缩放下行高传播有 bug，会导致图片叠加）
    position: relative;
    height: 0;
    padding-bottom: 100%;
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
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
}
</style>
