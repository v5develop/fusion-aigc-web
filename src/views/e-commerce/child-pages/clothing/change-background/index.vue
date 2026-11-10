<script setup lang="ts">
import SectionTitle from '@/views/e-commerce/child-pages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref } from 'vue'
import Container from '../../../child-pages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import GridImage from '@/views/e-commerce/child-pages/components/GridImage/index.vue'
import { PRESET_SCENE_IMAGES } from '@/views/e-commerce/child-pages/components/GridImage/ColorPicker/constants.ts'
import PromptAssist from '../../../child-pages/components/PromptAssist/index.vue'
import RecordList from '@/views/e-commerce/child-pages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/child-pages/components/Sample/index.vue'
import { publicTemplate } from '@/api/methods.ts'
import { useMessage } from 'naive-ui'
import { useInitCheckTaskStatus } from '@/views/e-commerce/child-pages/hooks.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ChangeBackgroundParams } from '@/views/home/ChatInputBox/target-params'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'change-background' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('change-background')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  bgImageUrl: '',
  description: '',
  refImageUrl: [],
})

const store = useHomeStore()
const { global_formData } = storeToRefs(store)
const { bgTabValue, bgList, bgScrollCallBack } = useBg()
if (global_formData.value.home) {
  const p = global_formData.value.ecommerce.params as ChangeBackgroundParams
  if (p.imageUrls?.length) (formData as any).imageUrls = p.imageUrls
  if (p.bgImageUrl) formData.bgImageUrl = p.bgImageUrl
  if (p.refImageUrl?.length) {
    ;(formData as any).refImageUrl = p.refImageUrl
    bgTabValue.value = 'custom'
  }
  if (p.description) formData.description = p.description
  store.reset()
}
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(() => ({ entryCode: 'backgroundSwitching' }), [])

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传服装图片')
  }

  if (bgTabValue.value === 'recommend' && !formData.bgImageUrl) {
    return message.warning('请选择背景图')
  }
  if (bgTabValue.value === 'custom' && !formData.refImageUrl.length) {
    return message.warning('请上传参考背景图')
  }
  if (bgTabValue.value === 'custom' && !formData.description) {
    return message.warning('请填写背景描述')
  }

  const params = {
    type: 'backgroundSwitching',
    imageUrls: formData.imageUrls,
    params: {
      bgImageUrl: bgTabValue.value === 'recommend' ? formData.bgImageUrl : '',
      description: formData.description,
      refImageUrl: formData.refImageUrl[0],
    },
  }
  execute(params, loading)
}

function useBg() {
  const bgPagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  // recommend:推荐  custom:自定义
  const bgTabValue = ref<'recommend' | 'custom'>('recommend')
  const bgList = ref<any[]>([])

  // 场景列表
  const publicTemplateApi = () => {
    if (bgPagingData.loading) return
    const params = {
      moduleCode: 'backgroundSwitching',
      slotCode: 'background',
      ...bgPagingData,
    } as const
    bgPagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          bgPagingData.page++
          bgList.value.push(...res.data.list)
          if (res.data.list.length < bgPagingData.pageSize) {
            bgPagingData.hasMore = false
          }
        }
      })
      .finally(() => (bgPagingData.loading = false))
  }
  publicTemplateApi()

  const bgScrollCallBack = () => {
    if (bgPagingData.hasMore) publicTemplateApi()
  }

  return { bgTabValue, bgList, bgScrollCallBack }
}
</script>

<template>
  <Container title="人像换背景" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>人像图</SectionTitle>
        <ImageUpload
          fromAsset
          v-model:imgList="formData.imageUrls"
          btnName="上传人像"
          :limitNumber="1"
          :topRightTips="false"
          :tryImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background3.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background4.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background5.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background6.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background7.png',
          ]"
        >
          <span class="mt-12px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <SectionTitle>选择背景</SectionTitle>
        <Tab
          v-model:value="bgTabValue"
          :tabs="[
            { label: '推荐', value: 'recommend' },
            { label: '自定义', value: 'custom' },
          ]"
        />
        <div v-show="bgTabValue === 'recommend'">
          <!--          <SelectGroup
            v-model:data="formData"
            :list="[{ field: 'platform', options: platformOptions }]"
            :col="1"
            class="mt-8px"
          />-->
          <GridImage
            class="mt-8px"
            v-model:imageUrl="formData.bgImageUrl"
            :imgList="bgList.map((item) => item.url)"
            :scrollCallBack="bgScrollCallBack"
            :showColorPicker="true"
            :presets="PRESET_SCENE_IMAGES"
          />
        </div>

        <div v-show="bgTabValue === 'custom'">
          <SectionTitle>添加描述</SectionTitle>
          <PromptAssist
            v-model:value="formData.description"
            :params="{
              prompt: 'ai_writing_background',
              imageUrls: formData.imageUrls,
            }"
            :validate="
              () => {
                if (!formData.imageUrls.length) {
                  message.warning('请先上传产品图')
                  return false
                }
                return true
              }
            "
            placeholder="参考公式：主体对象+场景+元素/光影+风格/氛围/画质"
          />

          <SectionTitle>背景风格参考</SectionTitle>
          <ImageUpload
            fromAsset
            v-model:imgList="formData.refImageUrl"
            btnName="上传参考背景"
            :limitNumber="1"
            :topRightTips="false"
          >
            <span class="mt-12px text-11px leading-17px text-muted">JPG/JPEG/PNG/WEBP 10M以内</span>
          </ImageUpload>
        </div>
      </div>
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample v-else title="人像换背景" :rightDesc="`完整保留模特人像主体，一键切换室内、海景等各类拍摄场景背景。`">
        <video
          class="block w-full mx-auto rounded-lg"
          controls
          :src="VITE_OSS_ASSET_URL + 'e-commerce/video/change-background.mp4'"
        ></video>
      </Sample>
    </template>
  </Container>
</template>
