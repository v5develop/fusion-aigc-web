<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { publicDisplay, promptList, promptDetail } from '@/api/methods.ts'
import type { IPromptCard, IQuotePreview } from '@/api/types'
import { useDebounce, useQuotePreview } from '@/utils/hooks'
import ImageTab from './ImageTab/index.vue'
import WaterfallVirtualScroller from '@/components/WaterfallVirtualScroller/index.vue'
import { filterData1, filterData2 } from './constants.ts'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import ChatTab, { type TTabValue } from './ChatTab/index.vue'
import ChatInputBox from './ChatInputBox/index.vue'
import type { PromptSlot, FileItem } from './ChatInputBox/types'
import { slotsToPrompt, promptDetailToSlots } from './ChatInputBox/utils'
import { buildTargetParams } from './ChatInputBox/targetParams'
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
    images: [] as string[],
  },
  video: {
    entryCode: 'imageToVideo',
    modelCode: 'local-video',
    prompt: '',
    ratio: '9:16',
    resolution: '720p',
    duration: 4,
    images: [] as string[],
    video: [] as FileItem[],
  },
  ecommerce: {
    slots: [] as PromptSlot[],
    images: [] as FileItem[],
  },
})
const homeRef = ref<HTMLDivElement | null>(null)

const currentTemplateCode = ref('')

// 电商模板路由 → 完整询价入参，用于首页 ecommerce Tab 按当前模板询基础价。
// 需要额外 modelCode/params 的模板，按对应子页面初始默认值补齐（缺失会导致 1003 或价格不一致）
const ECOMMERCE_QUOTE: Record<string, IQuotePreview> = {
  '/e-commerce/product-detail': { entryCode: 'aPlusDetailPage', params: { image_types: [] } },
  '/e-commerce/product-kit': { entryCode: 'productSetImages', params: { white: 1, scence: 1, key_points: 1, detail: 0 } },
  '/e-commerce/product-clone': { entryCode: 'hitReplication' },
  '/e-commerce/product-in-hand': { entryCode: 'aiGestures' },
  '/e-commerce/video-clone': { entryCode: 'hitVideoReplication', modelCode: 'local' },
  '/e-commerce/video-hot': { entryCode: 'hitVideo', modelCode: 'local' },
  '/e-commerce/model-replace': { entryCode: 'personReplacement' },
  '/e-commerce/product-replace': { entryCode: 'productReplacement' },
  '/e-commerce/change-background': { entryCode: 'backgroundSwitching' },
  '/e-commerce/clothing-kit': { entryCode: 'wearingProductSetImages', params: { scenePhoto: [] } },
  '/e-commerce/clothing-try': { entryCode: 'aiClothExchange' },
  '/e-commerce/clothing-remove-wrinkle': { entryCode: 'removeWrinkles' },
  '/e-commerce/merge-image': { entryCode: 'mergeClothes' },
  '/e-commerce/try-shoe': { entryCode: 'shoeSwapping' },
}

// 提交前积分预览：按当前 Tab 镜像各自提交参数；ecommerce 按模板取 entryCode 询基础价
const { pricePoints, status: quoteStatus } = useQuotePreview(
  () => {
    const tab = activeChatTab.value
    if (tab === 'picture') {
      const p = formData.picture
      const [w, h] = p.ratio.split(',')
      return {
        entryCode: p.entryCode,
        modelCode: 'local-image',
        params: { prompt: p.prompt, width: +w!, height: +h!, num: p.entryCode === 'textToImage' ? 4 : 1 },
        imageUrls: p.images,
      }
    }
    if (tab === 'video') {
      const v = formData.video
      const isAT = v.entryCode === 'actionTransfer'
      return {
        entryCode: v.entryCode,
        modelCode: v.modelCode,
        params: { prompt: v.prompt, ...(isAT ? {} : { resolution: v.resolution, aspectRatio: v.ratio, duration: v.duration }) },
        imageUrls: v.images,
        video: isAT ? v.video[0]?.url || '' : '',
      }
    }
    // ecommerce：按当前模板路由取完整询价入参（含默认 modelCode/params），未知模板 → null（兜底「限免」）
    return ECOMMERCE_QUOTE[currentTemplateCode.value] ?? null
  },
  [
    () => activeChatTab.value,
    () => currentTemplateCode.value,
    () => formData.picture.entryCode,
    () => formData.picture.ratio,
    () => formData.video.entryCode,
    () => formData.video.modelCode,
    () => formData.video.resolution,
    () => formData.video.duration,
    () => formData.video.ratio,
  ],
)

function getOssThumbnail(url?: string): string {
  if (!url) return ''
  const base = url.split('?')[0]!
  return `${base}?x-oss-process=image/resize,w_60,h_60/format,webp`
}

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
    const slots = promptDetailToSlots(res.data, item.code)
    if (!slots.length) return
    // 默认填充是异步的，用户此时可能已开始输入（编辑器打字会同步 slots），不覆盖
    if (isDefaultFill && formData.ecommerce.slots.length > 0) return
    currentTemplateCode.value = item.code || ''
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
    // 按模板详情 slot 的 required 语义校验；非必填空 select（如后端暂未配置 options）不拦截，
    // slotsToPrompt 对空值 select 输出空串，不会混入占位 label
    for (const s of formData.ecommerce.slots) {
      if (s.type === 'select' && s.required && !s.value) {
        const tip = s.title || s.label
        message.warning(tip.startsWith('请') ? tip : tip.startsWith('选择') ? `请${tip}` : `请选择${tip}`)
        return
      }
      if (s.type === 'upload' && s.required && s.value.length === 0) {
        const tip = s.label
        message.warning(tip.startsWith('请') ? tip : tip.startsWith('上传') ? `请${tip}` : `请上传${tip}`)
        return
      }
    }
    const { plainText, images: slotImages } = slotsToPrompt(formData.ecommerce.slots)
    const allImages = [...slotImages, ...formData.ecommerce.images]
    const targetCode = currentTemplateCode.value || '/e-commerce'
    // 只传侧边栏图片作为兜底，插槽图片由 builder 从 slots 中按 key 精确提取
    const params = buildTargetParams(targetCode, formData.ecommerce.slots, formData.ecommerce.images)
    global_formData.value = {
      ...global_formData.value,
      home: true,
      ecommerce: {
        prompt: plainText,
        images: allImages,
        slots: formData.ecommerce.slots,
        templateCode: targetCode,
        params,
      },
    }
    router.push({ path: targetCode })
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
        :pricePoints="pricePoints"
        :quoteFailed="quoteStatus === 'error'"
        v-bind="activeChatTab === 'video' ? videoConfig[formData.video.entryCode] : {}"
      >
        <template #bottomSelect>
          <div v-if="activeChatTab === 'picture'" class="select-cont">
            <ChatInputSelect
              v-model:value="formData.picture.entryCode"
              title="选择创作类型"
              icon-category="entryCode"
              :options="entryCodeOps"
            />
            <ChatInputSelect
              v-model:value="formData.picture.ratio"
              title="选择比例"
              icon-category="ratio"
              :options="ratioOps"
            />
          </div>
          <div v-else-if="activeChatTab === 'video'" class="select-cont">
            <ChatInputSelect
              v-model:value="formData.video.entryCode"
              title="选择创作类型"
              icon-category="entryCode"
              :options="videoEntryCodeOps"
            />
            <ChatInputSelect
              v-model:value="formData.video.modelCode"
              title="选择模型"
              icon-category="model"
              :options="videoEntryCodeOps.find((item) => item.value === formData.video.entryCode)?.modelOps!"
            />
            <!-- 动作迁移由参考视频决定画幅/时长，无需选择比例/分辨率/时长 -->
            <template v-if="formData.video.entryCode !== 'actionTransfer'">
              <ChatInputSelect
                v-model:value="formData.video.ratio"
                title="选择比例"
                icon-category="ratio"
                :options="videoRatioOps"
              />
              <ChatInputSelect
                v-model:value="formData.video.resolution"
                title="选择分辨率"
                icon-category="resolution"
                :options="modelOps.find((item) => item.value === formData.video.modelCode)?.resolutionOps!"
              />
              <ChatInputSelect
                v-model:value="formData.video.duration"
                title="选择时长"
                icon-category="duration"
                :options="durationOps"
              />
            </template>
          </div>
        </template>
      </ChatInputBox>

      <div v-if="activeChatTab === 'ecommerce' && preData.length" class="preinstall">
        <div class="item" v-for="item in preData" :key="item.id" @click="handlePreinstallClick(item)">
          <div class="icon-wrap">
            <img :src="getOssThumbnail(item.icon) || item.coverImage || preinstallFallbackImg" alt="" />
          </div>
          <span>{{ item.name }}</span>
          <i class="icon-ic_home_jump1"></i>
          <div v-if="item.icon" class="preview-panel">
            <img :src="item.icon" alt="" />
          </div>
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
  gap: 24px;
}
</style>

