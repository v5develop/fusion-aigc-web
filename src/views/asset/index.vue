<script setup lang="ts">
import { ref, provide, watch, reactive } from 'vue'
import { assetAll } from '@/api/methods.ts'
import { tabOps1, tabOps2 } from './constants.ts'
import RecordList from './components/RecordList/index.vue'

const assetRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
const formData = reactive({
  category: 'ecommerce',
  type: 'productSetImages', // 默认AI商品套图
})
const pagingData = reactive({
  page: 1,
  pageSize: 9,
  hasMore: true,
})
const records = ref<any[]>([])
provide('recordsData', records)

const getData = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (loading.value) return
  loading.value = true

  const params = {
    category: formData.category,
    type: formData.category === 'ecommerce' ? formData.type : '',
    ...pagingData,
  }
  assetAll(params)
    .then((res) => {
      if (res.code === 0) {
        pagingData.page++

        if (isReplace) records.value = res.data.records
        else records.value.push(...res.data.records)

        if (res.data.records.length < pagingData.pageSize) {
          pagingData.hasMore = false
        }
      }
    })
    .finally(() => (loading.value = false))
}
getData()

watch(formData, () => {
  pagingData.page = 1
  pagingData.hasMore = true
  assetRef.value!.scrollTop = 0
  getData(true)
})
</script>

<template>
  <div
    ref="assetRef"
    class="asset"
    v-loading="loading"
    v-observer-scroll="{
      callback: getData,
    }"
  >
    <div class="top-tab-cont">
      <div class="tab-lv1">
        <span
          class="item"
          :class="formData.category === item.value ? 'active' : ''"
          v-for="item in tabOps1"
          :key="item.label"
          @click="formData.category = item.value"
        >
          {{ item.label }}
        </span>
      </div>

      <div v-if="formData.category === 'ecommerce'" class="tab-lv1 tab-lv2">
        <span
          class="item"
          :class="formData.type === item.value ? 'active' : ''"
          v-for="item in tabOps2"
          :key="item.label"
          @click="formData.type = item.value"
        >
          {{ item.label }}
        </span>
      </div>
    </div>

    <RecordList />
  </div>
</template>

<style scoped lang="less">
.asset {
  height: 100vh;
  padding: 0 48px 40px;
  overflow: auto;
  > .top-tab-cont {
    padding-top: 40px;
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: #f5f6f8;
    > .tab-lv1 {
      display: flex;
      gap: 8px 16px;
      color: #1f1f1f;
      text-align: center;
      padding-bottom: 16px;
      background-color: #f5f6f8;
      > .item {
        padding: 10px 16px;
        cursor: pointer;
        border-radius: 8px;
        &:hover {
          background-color: white;
        }
        &.active {
          background-color: white;
        }
      }
    }
    > .tab-lv2 {
      width: 65%;
      flex-wrap: wrap;
      margin-bottom: 28px;
    }
  }
}
</style>
