<script setup lang="ts">
import { inject } from 'vue'
import Card from '../Card/index.vue'

const { showSelect = true } = defineProps<{ showSelect?: boolean }>()
const recordsData = inject<any[]>('recordsData')

const checkSelected = (item: any) => {
  return !item.selectList.find((jtem: any) => !jtem.selected)
}

const selectAll = (item: any) => {
  if (checkSelected(item)) {
    item.selectList.forEach((jtem: any) => (jtem.selected = false))
  } else {
    item.selectList.forEach((jtem: any) => (jtem.selected = true))
  }
}
</script>

<template>
  <div class="record-list">
    <div class="record-item" v-for="item in recordsData" :key="item.id">
      <div class="title-cont">
        <div class="left-cont">
          <i
            v-if="showSelect"
            :class="checkSelected(item) ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"
            @click="selectAll(item)"
          />
          <span>{{ item.date }}</span>
          <span>{{ item.title }}</span>
        </div>
      </div>

      <div class="card-cont">
        <Card
          class="card-item"
          v-for="(jtem, j) in item.images"
          :key="jtem"
          :data="showSelect ? item.selectList[j] : { url: jtem }"
          :showSelect="showSelect"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.record-list {
  > .record-item {
    margin-bottom: 50px;
    > .title-cont {
      font-size: 16px;
      font-weight: 600;
      line-height: 22px;
      margin-bottom: 26px;
      > .left-cont {
        display: flex;
        align-items: center;
        gap: 4px;
        > .icon-ic_ds_check_sel,
        > .icon-ic_ds_check_nor {
          font-size: 20px;
          cursor: pointer;
        }
      }
    }

    > .card-cont {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      font-size: 0;
      > .card-item {
        width: 100%;
        aspect-ratio: 1/1;
      }
    }
  }
}
</style>
