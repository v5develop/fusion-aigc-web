<script setup lang="ts">
import { type CSSProperties } from 'vue'

const { imgList, style, disabled } = defineProps<{
  imgList: string[]
  style: CSSProperties
  disabled?: boolean
}>()
const selectImage = defineModel<string>()

const handleClick = (item: string) => {
  if (selectImage.value === undefined) return
  selectImage.value = item
}
</script>

<template>
  <div v-for="item in imgList" :key="item">
    <n-popover trigger="hover" :disabled="disabled">
      <template #trigger>
        <img
          :style="style"
          class="img"
          :class="[selectImage === item ? 'active' : '', { cursor: selectImage !== undefined }]"
          :src="item"
          alt=""
          @click="handleClick(item)"
        />
      </template>
      <img class="preview" :src="item" alt="" />
    </n-popover>
  </div>
</template>

<style scoped lang="less">
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
  border: 2px solid transparent;
  &.active {
    border-color: var(--main-color);
  }
  &.cursor {
    cursor: pointer;
  }
}
.preview {
  max-width: 50vw;
  max-height: 50vh;
}
</style>
