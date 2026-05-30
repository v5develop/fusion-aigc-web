<script setup lang="ts">
interface IProps {
  data: any[]
}
const { data } = defineProps<IProps>()
const model = defineModel()

function tebClick(item: any) {
  model.value = item.value
}
</script>

<template>
  <div class="tabCont">
    <div class="item" :class="model === item.value ? 'active' : ''" v-for="item in data" :key="item" @click="tebClick(item)">{{ item.label }}</div>
  </div>
</template>

<style scoped lang="less">
.tabCont {
  display: flex;
  gap: 16px;
  > .item {
    min-width: 88px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    cursor: pointer;
    &:hover {
      color: #000000;
    }
    &.active {
      background: #edeeef;
      color: #333333;
    }
  }
}
</style>
