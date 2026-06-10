<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useDebounce } from '@/utils/composables.ts'
import ImageTab from '@/views/home/ImageTab/index.vue'
import WaterfallVirtualScroller from '@/components/WaterfallVirtualScroller/index.vue'
import { filterData1, filterData2 } from './constants.ts'
import { usePaginationData } from '@/utils/composables.ts'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import ChatTab, { type TTabValue } from './ChatTab/index.vue'
import ChatInputBox from './ChatInputBox/index.vue'

const homeRef = ref<HTMLDivElement | null>(null)
const { activeChatTab, imgList, selectValues, options1, options2, options3 } = useChat()

function useChat() {
  const activeChatTab = ref<TTabValue>('ecommerce')
  const imgList = ref<any[]>([])
  const selectValues = reactive({
    value1: 0,
    value2: 0,
  })
  const options1 = [
    { label: '图生图', value: 0 },
    { label: '文生图', value: 1 },
  ]
  const options2 = [
    { label: '灵动图像2.0', value: 0 },
    { label: '灵动图像3.0', value: 1 },
  ]
  const options3 = [
    { label: '智能比例', value: 0 },
    { label: '智能比例2', value: 1 },
  ]

  return { activeChatTab, imgList, selectValues, options1, options2, options3 }
}

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

const { imageTab } = useImageTab()
function useImageTab() {
  const imageTab = reactive({
    value1: 0,
    value2: 0,
  })

  useDebounce(
    imageTab,
    () => {
      console.log(111)
    },
    0,
  )

  return { imageTab }
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
    const response = await fetch(
      `https://mock.yuan.sh/images?page=${paginationData.pageIndex}&size=${paginationData.pageSize}&mode=simple`,
    )
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
    v-observer-scroll="{
      callback: loadData,
      onScroll: (scrollTop: number) => (showBackToTop = scrollTop > 400),
    }"
  >
    <div class="container">
      <div class="top_bg"></div>

      <h1 class="h1">和我聊聊， 你想要什么设计～</h1>

      <ChatTab v-model="activeChatTab" style="justify-content: center" />

      <ChatInputBox v-model:imgList="imgList">
        <template #bottomSelect>
          <div v-if="activeChatTab === 'image'" class="select-cont">
            <ChatInputSelect v-model:value="selectValues.value1" :options="options1" />
            <ChatInputSelect v-model:value="selectValues.value2" :options="options3" />
          </div>
          <div v-else-if="activeChatTab === 'video'" class="select-cont">
            <ChatInputSelect v-model:value="selectValues.value1" :options="options1" />
          </div>
        </template>
      </ChatInputBox>

      <div v-if="activeChatTab === 'ecommerce'" class="preinstall">
        <div class="item" v-for="item in preData" :key="item.name">
          <img
            src="https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp"
            alt=""
          />
          <span>{{ item.name }}</span>
          <i class="icon-ic_home_jump1"></i>
        </div>
      </div>

      <div class="tab-content">
        <ImageTab v-model="imageTab.value1" :data="filterData1" />
        <ImageTab class="tab2" v-model="imageTab.value2" :data="filterData2" />
      </div>

      <WaterfallVirtualScroller :waterfallData="waterfallData" />

      <div class="scroll-to-top" v-show="showBackToTop" @click="backTop">
        <i class="icon-ic_home_jump1"></i>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './index.less';
</style>
