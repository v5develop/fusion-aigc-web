<script setup lang="ts">
interface IProps {
  // select组件数量由这里决定
  list: {
    field: string // 对应data中的字段
    options: { label: string; value: string | number }[]
    [propName: string]: any
  }[]
  col?: number // 列数
  gap?: string // 间距
}
const { list, col = 2, gap = '8px' } = defineProps<IProps>()
const data = defineModel<Record<string, any>>('data', { required: true })
</script>

<template>
  <div class="container" :style="{ '--col': col, '--gap': gap }">
    <template v-for="(item, i) in list" :key="i">
      <n-select :style="item.style" v-model:value="data[item.field]" :options="item.options" />
    </template>
  </div>
</template>

<style scoped lang="less">
.container {
  display: grid;
  grid-template-columns: repeat(var(--col), 1fr);
  gap: var(--gap);
  /deep/.n-select {
    .n-base-selection-label {
      background-color: #f5f6f8;
    }
    .n-base-selection__border {
      display: none;
    }
  }
}
</style>
