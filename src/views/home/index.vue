<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { publicDisplay, promptList, promptDetail } from '@/api/methods.ts'
import type { IPromptCard } from '@/api/types'
import { useDebounce } from '@/utils/hooks'
import ImageTab from './ImageTab/index.vue'
import WaterfallVirtualScroller from '@/components/WaterfallVirtualScroller/index.vue'
import { filterData1, filterData2 } from './constants.ts'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import ChatTab, { type TTabValue } from './ChatTab/index.vue'
import ChatInputBox from './ChatInputBox/index.vue'
import type { PromptSlot, SlotSelect, FileItem } from './ChatInputBox/types'
import { slotsToPrompt, promptDetailToSlots } from './ChatInputBox/utils'
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
const message = useMessage()
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

const { preData, preinstallFallbackImg, handlePreinstallClick } = usePreinstall()
function usePreinstall() {
  const preData = ref<IPromptCard[]>([])
  const preinstallFallbackImg =
    'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp'
  let requestSeq = 0

  // 点击卡片：拉取模板详情，解析为插槽后填充输入框。
  // 「最后请求胜出」：用户点击总是拿到最新序号，可打断进行中的默认填充；晚到的旧响应被丢弃
  async function handlePreinstallClick(item: IPromptCard, isDefaultFill = false) {
    const seq = ++requestSeq
    // 业务错误拦截器已 toast，这里只需吞掉 rejection
    const res = await promptDetail(item.id).catch(() => null)
    if (!res || seq !== requestSeq) return
    const slots = promptDetailToSlots(res.data)
    if (!slots.length) return
    // 默认填充是异步的，用户此时可能已开始输入（编辑器打字会同步 slots），不覆盖
    if (isDefaultFill && formData.ecommerce.slots.length > 0) return
    formData.ecommerce.slots = slots
  }

  // 首屏卡片取电商分类第一页前 4 个
  promptList({ category: 'ecommerce', page: 1, pageSize: 4 })
    .then((res) => {
      preData.value = (res.data?.list ?? []).slice(0, 4)
      // 默认填入第一个模板
      if (preData.value[0]) handlePreinstallClick(preData.value[0], true)
    })
    .catch(() => {}) // 列表失败则不展示卡片区，拦截器已负责错误提示

  return { preData, preinstallFallbackImg, handlePreinstallClick }
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
    // 未选择的 select（如后端暂未配置选项）不会输出到 prompt，提交前必须拦下，避免发出残句
    const unselected = formData.ecommerce.slots.find((s): s is SlotSelect => s.type === 'select' && !s.value)
    if (unselected) {
      const tip = unselected.title || unselected.label
      message.warning(tip.startsWith('请') ? tip : tip.startsWith('选择') ? `请${tip}` : `请选择${tip}`)
      return
    }
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

      <div v-if="activeChatTab === 'ecommerce' && preData.length" class="preinstall">
        <div class="item" v-for="item in preData" :key="item.id" :title="item.description" @click="handlePreinstallClick(item)">
          <img :src="item.coverImage || item.icon || preinstallFallbackImg" alt="" />
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
