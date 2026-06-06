<script setup lang="ts">
import { inject, type Ref } from 'vue'

interface ISelectItem {
  url: string
  selected: boolean
}

interface IRecordItem {
  title: string
  date: string
  images: string[]
  selectList: ISelectItem[]
}

const { data, showSelect = true } = defineProps<{ data: { url: string; selected?: boolean }; showSelect?: boolean }>()
const recordsData = inject<Ref<IRecordItem[]>>('recordsData')!

const toggle = () => {
  outer: for (const item of recordsData.value) {
    for (const jtem of item.selectList) {
      if (jtem.url === data.url) {
        jtem.selected = !jtem.selected
        break outer
      }
    }
  }
}
</script>

<template>
  <div class="card" :class="{ cursor: showSelect }">
    <n-image :src="data.url" alt="" width="100%" height="100%" object-fit="cover" />
    <i
      v-if="showSelect"
      :class="data.selected ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"
      class="icon"
      @click="toggle"
    />
  </div>
</template>

<style scoped lang="less">
.card {
  position: relative;
  &:hover {
    > .icon {
      opacity: 1;
    }
  }
  :deep(.n-image) {
    width: 100%;
    height: 100%;
  }
  &.cursor {
    cursor: pointer;
  }
  > .icon {
    font-size: 28px;
    position: absolute;
    top: 10px;
    right: 20px;
    opacity: 0;
    transition: opacity 0.2s;
  }
}
</style>
