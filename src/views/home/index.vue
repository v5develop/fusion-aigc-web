<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { publicDisplay } from '@/api/methods.ts'
import { useDebounce } from '@/utils/hooks'
import ImageTab from './ImageTab/index.vue'
import WaterfallVirtualScroller from '@/components/WaterfallVirtualScroller/index.vue'
import { filterData1, filterData2 } from './constants.ts'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import ChatTab, { type TTabValue } from './ChatTab/index.vue'
import ChatInputBox from './ChatInputBox/index.vue'
import type { PromptSlot, FileItem } from './ChatInputBox/types'
import { slotsToPrompt } from './ChatInputBox/utils'
import { ICON_SHOP, ICON_RATIO_1_1, ICON_RATIO_3_4, ICON_RATIO_9_16, ICON_RATIO_16_9, ICON_STYLE, ICON_PERSON, ICON_LOCATION } from './ChatInputBox/slots/icons'
import { entryCodeOps, ratioOps } from '@/views/picture/constants.ts'
import {
  entryCodeOps as videoEntryCodeOps,
  ratioOps as videoRatioOps,
  durationOps,
  modelOps,
  config as videoConfig,
} from '@/views/video/constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'

const router = useRouter()
const store = useHomeStore()
const { global_formData } = storeToRefs(store)

const activeChatTab = ref<TTabValue>('picture')
const formData = reactive({
  picture: {
    entryCode: 'imageToImage',
    prompt: '',
    ratio: '1024,1024',
    images: [],
  },
  video: {
    entryCode: 'imageToVideo',
    modelCode: 'local-video',
    prompt: '',
    ratio: '720,1280',
    resolution: '720p',
    duration: 4,
    images: [],
    video: [],
  },
  ecommerce: {
    slots: [] as PromptSlot[],
    images: [] as FileItem[],
  },
})
const homeRef = ref<HTMLDivElement | null>(null)

const { preData, handlePreinstallClick } = usePreinstall()
function usePreinstall() {
  const preData = [
    {
      name: '全套主图生成',
      img: 'aaaaaaaa',
      slots: [
        { type: 'upload' as const, label: '上传产品图', value: [], limit: 5 },
        { type: 'text' as const, value: '，生成一套完整主图，商品名称为' },
        { type: 'text' as const, value: '' },
        { type: 'text' as const, value: '，适配' },
        {
          type: 'select' as const, title: '选择平台',
          label: '淘宝/天猫', value: 'taobao',
          options: [{ label: '淘宝/天猫', value: 'taobao', icon: ICON_SHOP }, { label: '京东', value: 'jd', icon: ICON_SHOP }, { label: '拼多多', value: 'pdd', icon: ICON_SHOP }],
        },
        { type: 'text' as const, value: ' 平台，单图比例为' },
        {
          type: 'select' as const, title: '选择比例',
          label: '1:1', value: '1:1',
          options: [{ label: '1:1', value: '1:1', icon: ICON_RATIO_1_1 }, { label: '3:4', value: '3:4', icon: ICON_RATIO_3_4 }, { label: '9:16', value: '9:16', icon: ICON_RATIO_9_16 }, { label: '16:9', value: '16:9', icon: ICON_RATIO_16_9 }],
        },
        { type: 'text' as const, value: '。' },
      ] as PromptSlot[],
    },
    {
      name: '商品场景图',
      img: 'aaaaaaaa',
      slots: [
        { type: 'upload' as const, label: '上传产品图', value: [], limit: 5 },
        { type: 'text' as const, value: '，为商品生成场景图，放置于' },
        { type: 'text' as const, value: '' },
        { type: 'text' as const, value: ' 场景中，风格为' },
        {
          type: 'select' as const, title: '选择风格',
          label: '简约', value: 'simple',
          options: [{ label: '简约', value: 'simple', icon: ICON_STYLE }, { label: '奢华', value: 'luxury', icon: ICON_STYLE }, { label: '自然', value: 'natural', icon: ICON_STYLE }],
        },
        { type: 'text' as const, value: '，比例为 ' },
        {
          type: 'select' as const, title: '选择比例',
          label: '1:1', value: '1:1',
          options: [{ label: '1:1', value: '1:1', icon: ICON_RATIO_1_1 }, { label: '3:4', value: '3:4', icon: ICON_RATIO_3_4 }, { label: '9:16', value: '9:16', icon: ICON_RATIO_9_16 }],
        },
        { type: 'text' as const, value: '。' },
      ] as PromptSlot[],
    },
    {
      name: '电商详情页',
      img: 'aaaaaaaa',
      slots: [
        { type: 'upload' as const, label: '上传产品图', value: [], limit: 5 },
        { type: 'text' as const, value: '，生成一套详情页，商品名称为' },
        { type: 'text' as const, value: '' },
        { type: 'text' as const, value: '，适配' },
        {
          type: 'select' as const, title: '选择平台',
          label: '淘宝/天猫', value: 'taobao',
          options: [{ label: '淘宝/天猫', value: 'taobao', icon: ICON_SHOP }, { label: '京东', value: 'jd', icon: ICON_SHOP }, { label: '拼多多', value: 'pdd', icon: ICON_SHOP }],
        },
        { type: 'text' as const, value: ' 平台，需求屏数为' },
        { type: 'text' as const, value: '' },
        { type: 'text' as const, value: ' 张。' },
      ] as PromptSlot[],
    },
    {
      name: 'AI模特试衣',
      img: 'aaaaaaaa',
      slots: [
        { type: 'upload' as const, label: '上传服装图', value: [], limit: 5 },
        { type: 'text' as const, value: '，模特' },
        {
          type: 'select' as const, title: '选择性别',
          label: '女性', value: 'female',
          options: [{ label: '女性', value: 'female', icon: ICON_PERSON }, { label: '男性', value: 'male', icon: ICON_PERSON }, { label: '儿童', value: 'child', icon: ICON_PERSON }],
        },
        { type: 'text' as const, value: '，' },
        {
          type: 'select' as const, title: '选择人种',
          label: '亚洲', value: 'asian',
          options: [{ label: '亚洲', value: 'asian', icon: ICON_PERSON }, { label: '欧美', value: 'western', icon: ICON_PERSON }],
        },
        { type: 'text' as const, value: ' 面孔，场景为' },
        {
          type: 'select' as const, title: '选择场景',
          label: '室内', value: 'indoor',
          options: [{ label: '室内', value: 'indoor', icon: ICON_LOCATION }, { label: '户外街拍', value: 'street', icon: ICON_LOCATION }, { label: '影棚', value: 'studio', icon: ICON_LOCATION }],
        },
        { type: 'text' as const, value: '。' },
      ] as PromptSlot[],
    },
  ]

  function handlePreinstallClick(item: (typeof preData)[number]) {
    formData.ecommerce.slots = JSON.parse(JSON.stringify(item.slots))
  }

  // 默认填入第一个预设
  if (preData[0]) {
    formData.ecommerce.slots = JSON.parse(JSON.stringify(preData[0].slots))
  }

  return { preData, handlePreinstallClick }
}

const { imageTab, waterfallData, getList } = useWaterfall()
function useWaterfall() {
  const pagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  const imageTab = reactive({
    value1: '',
    value2: 'hot',
  })
  const waterfallData = ref<any>([])

  const getList = (isReplace?: boolean) => {
    if (!pagingData.hasMore) return

    if (pagingData.loading) return
    pagingData.loading = true

    const params = {
      page: pagingData.page,
      pageSize: pagingData.pageSize,
      type: imageTab.value1,
      category: imageTab.value2 === 'hot' ? '' : imageTab.value2,
      hot: imageTab.value2 === 'hot',
    }
    publicDisplay(params)
      .then((res) => {
        if (res.code === 0) {
          pagingData.page++

          if (isReplace) waterfallData.value = res.data.list
          else waterfallData.value.push(...res.data.list)

          if (res.data.list.length < pagingData.pageSize) {
            pagingData.hasMore = false
          }
        }
      })
      .finally(() => (pagingData.loading = false))
  }
  getList()

  useDebounce({
    data: imageTab,
    callback: () => {
      pagingData.page = 1
      pagingData.hasMore = true
      getList(true)
    },
    delay: 0,
  })

  return { imageTab, waterfallData, getList }
}

const backTop = () => {
  homeRef.value?.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

const showBackToTop = ref(false)

const submit = () => {
  if (activeChatTab.value === 'ecommerce') {
    const { plainText, images: slotImages } = slotsToPrompt(formData.ecommerce.slots)
    const allImages = [...slotImages, ...formData.ecommerce.images]
    global_formData.value = {
      ...global_formData.value,
      home: true,
      ecommerce: {
        prompt: plainText,
        images: allImages,
      },
    }
    router.push({ name: 'e-commerce' })
    return
  }
  global_formData.value = {
    ...global_formData.value,
    home: true,
    [activeChatTab.value]: formData[activeChatTab.value],
  }
  router.push({ name: activeChatTab.value })
}
</script>

<template>
  <div
    ref="homeRef"
    class="home"
    v-observer-scroll="{
      callback: getList,
      onScroll: (scrollTop: number) => (showBackToTop = scrollTop > 400),
    }"
  >
    <div class="container">
      <div class="top_bg"></div>

      <h1 class="h1">和我聊聊， 你想要什么设计～</h1>

      <ChatTab v-model="activeChatTab" />

      <ChatInputBox
        :activeChatTab="activeChatTab"
        :mode="activeChatTab === 'ecommerce' ? 'slot' : 'default'"
        v-model:formData="formData[activeChatTab]"
        v-model:slots="formData.ecommerce.slots"
        v-model:sideImages="formData.ecommerce.images"
        :showVideoUpload="activeChatTab === 'video' && formData.video.entryCode === 'actionTransfer'"
        :showImageUpload="
          (activeChatTab === 'picture' && formData.picture.entryCode === 'imageToImage') ||
          (activeChatTab === 'video' && formData.video.entryCode !== 'textToVideo')
        "
        :submit="submit"
        v-bind="activeChatTab === 'video' ? videoConfig[formData.video.entryCode] : {}"
      >
        <template #bottomSelect>
          <div v-if="activeChatTab === 'picture'" class="select-cont">
            <ChatInputSelect v-model:value="formData.picture.entryCode" :options="entryCodeOps" />
            <ChatInputSelect v-model:value="formData.picture.ratio" :options="ratioOps" style="margin-left: 10px" />
          </div>
          <div v-else-if="activeChatTab === 'video'" class="select-cont">
            <ChatInputSelect v-model:value="formData.video.entryCode" :options="videoEntryCodeOps" />
            <ChatInputSelect
              v-model:value="formData.video.modelCode"
              :options="videoEntryCodeOps.find((item) => item.value === formData.video.entryCode)?.modelOps!"
            />
            <ChatInputSelect v-model:value="formData.video.ratio" :options="videoRatioOps" />
            <ChatInputSelect
              v-model:value="formData.video.resolution"
              :options="modelOps.find((item) => item.value === formData.video.modelCode)?.resolutionOps!"
            />
            <ChatInputSelect v-model:value="formData.video.duration" :options="durationOps" />
          </div>
        </template>
      </ChatInputBox>

      <div v-if="activeChatTab === 'ecommerce'" class="preinstall">
        <div class="item" v-for="item in preData" :key="item.name" @click="handlePreinstallClick(item)">
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
.select-cont {
  width: 250px;
  display: flex;
  gap: 12px;
}
</style>
