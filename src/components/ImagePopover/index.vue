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
  <!-- 素材格（规范 §4.1）：r5、2px 描边，选中 violet；悬停弹出大图预览 -->
  <div v-for="item in imgList" :key="item">
    <n-popover trigger="hover" :disabled="disabled">
      <template #trigger>
        <img
          :style="style"
          class="block w-full h-full box-border object-cover rounded-plate border-2 border-solid outline-none transition-colors duration-fast ease-sx motion-reduce:transition-none"
          :class="[
            selectImage === item ? 'border-violet' : 'border-transparent',
            selectImage !== undefined ? 'cursor-pointer sx-focus' : '',
          ]"
          :src="item"
          alt=""
          :role="selectImage !== undefined ? 'button' : undefined"
          :tabindex="selectImage !== undefined ? 0 : undefined"
          :aria-pressed="selectImage !== undefined ? selectImage === item : undefined"
          :aria-label="selectImage !== undefined ? '选择这张素材' : undefined"
          @click="handleClick(item)"
          @keydown.enter.prevent="handleClick(item)"
          @keydown.space.prevent="handleClick(item)"
        />
      </template>
      <img class="block max-w-[50vw] max-h-[50vh]" :src="item" alt="" />
    </n-popover>
  </div>
</template>
