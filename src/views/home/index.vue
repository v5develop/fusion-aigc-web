<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useDebounce } from '@/utils/composables.ts'
import Upload from '@/components/Upload/index.vue'
import Tab from './Tab/index.vue'
import WaterfallVirtualScroller from '@/components/WaterfallVirtualScroller/index.vue'
import { filterData1, filterData2 } from './constants.ts'
import { usePaginationData } from '@/utils/composables.ts'

const value = ref(0)
const homeRef = ref<HTMLDivElement | null>(null)
const options1 = [
  { label: '图生图', value: 0 },
  { label: '图生图', value: 1 },
]
const options2 = [
  { label: '灵动图像2.0', value: 0 },
  { label: '灵动图像3.0', value: 1 },
]
const options3 = [
  { label: '智能比例', value: 0 },
  { label: '智能比例2', value: 1 },
]

const { preData } = usePreinstall()
function usePreinstall() {
  const preData = [
    { name: '全套主图生成', img: 'aaaaaaaa' },
    { name: '商品场景图', img: 'aaaaaaaa' },
    { name: '电商详情页', img: 'aaaaaaaa' },
    { name: 'AI模特试衣', img: 'aaaaaaaa' },
  ]

  return { preData }
}

const { tabFilter } = useTabContent()
function useTabContent() {
  const tabFilter = reactive({
    value1: 0,
    value2: 0,
  })

  useDebounce(tabFilter, () => {
    console.log(111)
  }, 0,)

  return { tabFilter }
}

const { paginationData } = usePaginationData()
const { waterfallData, loadData } = useWaterfall()
function useWaterfall() {
  const waterfallData = ref<any>([])

  async function loadData() {
    if (!paginationData.hasMore) {
      return
    }
    paginationData.pageIndex++
    const response = await fetch(`https://mock.yuan.sh/images?page=${paginationData.pageIndex}&size=${paginationData.pageSize}&mode=simple`)
    const result = await response.json()
    paginationData.total = result.total
    waterfallData.value = [...waterfallData.value, ...result.list]
    if (result.list.length < paginationData.pageSize) {
      paginationData.hasMore = false
    }
  }

  return { waterfallData, loadData }
}

const backTop = () => {
  homeRef.value?.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

const showBackToTop = ref(false)
</script>

<template>
  <div
    ref="homeRef"
    class="home"
    v-observer-scroll-to-bottom="{
      callback: loadData,
      onScroll: (scrollTop: number) => showBackToTop = scrollTop > 400,
    }"
  >
    <div class="container">
      <div class="top_bg"></div>

      <h1>和我聊聊， 你想要什么设计～</h1>

      <div class="chatContent">
        <div class="mainContent">
          <div class="uploadCont">
            <Upload />
          </div>

          <div class="textareaCont" contenteditable data-placeholder="和我聊聊，你想要什么设计。"></div>
        </div>

        <div class="bottomContent">
          <div class="selectCont">
            <n-select v-model:value="value" :options="options1" size="small" :consistent-menu-width="false" />
            <n-select v-model:value="value" :options="options2" size="small" :consistent-menu-width="false" />
            <n-select v-model:value="value" :options="options3" size="small" :consistent-menu-width="false" />
          </div>

          <div class="sendCont">
            <i class="icon-ic_hone_bean"></i>
            <span>限免</span>
            <div class="btn">
              <i class="icon-ic_hone_bean"></i>
            </div>
          </div>
        </div>
      </div>

      <div class="preinstall">
        <div class="item" v-for="item in preData" :key="item.name">
          <img src="https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp" alt="" />
          <span>{{ item.name }}</span>
          <i class="icon-ic_home_jump1"></i>
        </div>
      </div>

      <div class="tabContent">
        <Tab v-model="tabFilter.value1" :data="filterData1" />
        <Tab class="tab2" v-model="tabFilter.value2" :data="filterData2" />
      </div>

      <WaterfallVirtualScroller :waterfallData="waterfallData" />

      <div class="scrollToTop" v-show="showBackToTop" @click="backTop">
        <i class="icon-ic_home_jump1"></i>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './index.less';
</style>
