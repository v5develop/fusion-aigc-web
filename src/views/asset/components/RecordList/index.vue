<script setup lang="ts">
import { inject, type Ref } from 'vue'
import Card from '../Card/index.vue'

const recordsData = inject<any[]>('recordsData')
const selectImgUrls = inject<Ref<Set<string>> | undefined>('selectImgUrls', undefined)

// 切换单个分组全部选中
const toggleGroupAll = (group: any) => {
  const { allChecked, allImgUrls } = getGroupSelectState(group)

  if (allChecked) {
    // 本组已全选 → 清空本组所有图片
    allImgUrls.forEach((url: string) => selectImgUrls?.value.delete(url))
  } else {
    // 未全选 → 勾选本组全部图片
    allImgUrls.forEach((url: string) => selectImgUrls?.value.add(url))
  }
}

const getGroupSelectState = (group: any) => {
  // 本组所有图片
  const allImgUrls = group.assets.map((item: any) => item.resultUrl)
  // 本组已选中数量
  const checkedCount = allImgUrls.filter((url: string) => selectImgUrls?.value.has(url)).length

  const total = allImgUrls.length
  const allChecked = total > 0 && checkedCount === total
  const indeterminate = checkedCount > 0 && !allChecked

  return { allChecked, indeterminate, allImgUrls }
}
</script>

<template>
  <div class="record-list">
    <div class="record-item" v-for="item in recordsData" :key="item.taskId">
      <div class="title-cont">
        <div class="left-cont">
          <i
            v-if="selectImgUrls"
            :class="getGroupSelectState(item).allChecked ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"
            @click="toggleGroupAll(item)"
          />
          <span>{{ item.taskTime }}</span>
        </div>
      </div>

      <div class="card-cont">
        <Card class="card-item" v-for="(jtem, j) in item.assets" :key="j" :data="jtem" />
      </div>
    </div>

    <div v-if="!recordsData?.length" class="empty-state">
      <i class="icon-ic_ds_empty" />
      <span>暂无数据</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.record-list {
  > .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
    color: #999;
    > i {
      font-size: 48px;
      margin-bottom: 12px;
    }
    > span {
      font-size: 14px;
    }
  }

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
          font-size: 24px;
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
