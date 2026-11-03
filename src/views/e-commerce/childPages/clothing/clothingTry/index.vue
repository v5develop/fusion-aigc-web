<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/childPages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { ageOps, genderOps, clothStyleOps, skinOps } from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
// 与图片模块同一套模型（本地模型 / GPT-Image-2），复用其常量避免两处定义漂移
import { modelOps } from '@/views/picture/constants.ts'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { publicTemplate } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ClothingTryParams } from '@/views/home/ChatInputBox/targetParams'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'clothing-try' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('clothing-try')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  personUrl: '', // 模特库
  uploadPersonUrl: [], // 上传的模特
  poseUrl: '', // 试衣模板图
  uploadPoseUrl: [], // 上传的试衣模板图
  bgImageUrl: '', // 背景图
  modelCode: 'xiaoqi-image-1.0-flash',
})

const store = useHomeStore()
const { global_formData } = storeToRefs(store)
const tabValue = ref<'modelLib' | 'uploadModel'>('modelLib')
if (global_formData.value.home) {
  const p = global_formData.value.ecommerce.params as ClothingTryParams
  if (p.imageUrls?.length) (formData as any).imageUrls = p.imageUrls
  if (p.personUrl) formData.personUrl = p.personUrl
  if (p.uploadPersonUrl?.length) {
    ;(formData as any).uploadPersonUrl = p.uploadPersonUrl
    tabValue.value = 'uploadModel'
  }
  if (p.poseUrl) formData.poseUrl = p.poseUrl
  if (p.bgImageUrl) formData.bgImageUrl = p.bgImageUrl
  store.reset()
}

const { modelFilterData, pagingData, modelList, scrollCallBack } = useModelList()
const { poseFilterData, posePagingData, poseTabValue, poseList, poseScrollCallBack } = usePose()
const { bgList, bgScrollCallBack } = useBg()
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({ entryCode: 'aiClothExchange', modelCode: formData.modelCode }),
  [() => formData.modelCode],
)

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传服装图片')
  }
  if (tabValue.value === 'modelLib' && !formData.personUrl) {
    return message.warning('请选择模特')
  }
  if (tabValue.value === 'uploadModel' && !formData.uploadPersonUrl.length) {
    return message.warning('请上传模特')
  }
  if (poseTabValue.value === 'poseLib' && !formData.poseUrl) {
    return message.warning('请选择试衣模板')
  }
  if (poseTabValue.value === 'uploadPose' && !formData.uploadPoseUrl.length) {
    return message.warning('请上传试衣模板')
  }
  if (!formData.bgImageUrl) {
    return message.warning('请选择背景')
  }

  const params = {
    type: 'aiClothExchange',
    imageUrls: formData.imageUrls,
    modelCode: formData.modelCode,
    params: {
      personUrl: tabValue.value === 'modelLib' ? formData.personUrl : formData.uploadPersonUrl[0],
      poseUrl: poseTabValue.value === 'poseLib' ? formData.poseUrl : formData.uploadPoseUrl[0],
      bgImageUrl: formData.bgImageUrl,
    },
  }
  execute(params, loading)
}

function useModelList() {
  const modelFilterData = reactive({
    gender: null,
    age: null,
    skin: null,
  })
  const pagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  // modelLib:模特库  uploadModel:上传模特
  const modelList = ref<any[]>([])

  // 模特库tab列表
  const publicTemplateApi = () => {
    if (pagingData.loading) return
    const params = {
      moduleCode: 'aiClothExchange',
      slotCode: 'model',
      filters: {
        gender: [modelFilterData.gender],
        age: [modelFilterData.age],
        skin: [modelFilterData.skin],
      },
      page: pagingData.page,
      pageSize: pagingData.pageSize,
    } as const
    pagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          pagingData.page++
          modelList.value.push(...res.data.list)
          if (res.data.list.length < pagingData.pageSize) {
            pagingData.hasMore = false
          }
        }
      })
      .finally(() => (pagingData.loading = false))
  }
  publicTemplateApi()

  const scrollCallBack = () => {
    if (pagingData.hasMore) publicTemplateApi()
  }

  watch(modelFilterData, () => {
    pagingData.page = 1
    pagingData.hasMore = true
    modelList.value = []
    publicTemplateApi()
  })

  return { modelFilterData, pagingData, modelList, scrollCallBack }
}

function usePose() {
  // 试衣模版筛选只保留款式模版
  const poseFilterData = reactive({
    clothStyle: null,
  })
  const posePagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  // modelLib:试衣模版库  uploadModel:上传试衣模版
  const poseTabValue = ref<'poseLib' | 'uploadPose'>('poseLib')
  const poseList = ref<any[]>([])

  // 试衣模版列表
  const publicTemplateApi = () => {
    if (posePagingData.loading) return
    const params = {
      moduleCode: 'aiClothExchange',
      slotCode: 'tryOnTemplate',
      filters: {
        clothStyle: [poseFilterData.clothStyle],
      },
      page: posePagingData.page,
      pageSize: posePagingData.pageSize,
    } as const
    posePagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          posePagingData.page++
          poseList.value.push(...res.data.list)
          if (res.data.list.length < posePagingData.pageSize) {
            posePagingData.hasMore = false
          }
        }
      })
      .finally(() => (posePagingData.loading = false))
  }
  publicTemplateApi()

  watch(poseFilterData, () => {
    posePagingData.page = 1
    posePagingData.hasMore = true
    poseList.value = []
    publicTemplateApi()
  })

  const poseScrollCallBack = () => {
    if (posePagingData.hasMore) publicTemplateApi()
  }

  return { poseFilterData, posePagingData, poseTabValue, poseList, poseScrollCallBack }
}

function useBg() {
  const bgPagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  const bgList = ref<any[]>([])

  // 场景列表
  const publicTemplateApi = () => {
    if (bgPagingData.loading) return
    const params = {
      moduleCode: 'aiClothExchange',
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

  return { bgList, bgScrollCallBack }
}
</script>

<template>
  <Container title="AI试衣" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload
          fromAsset
          v-model:imgList="formData.imageUrls"
          btnName="上传产品图"
          :limitNumber="1"
          :topRightTips="false"
          :tryImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try3.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try4.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try5.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try6.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/clothing-try7.png',
          ]"
        >
          <span class="mt-12px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <SectionTitle>选择模特</SectionTitle>
        <div v-loading="pagingData.loading" class="relative">
          <Tab
            v-model:value="tabValue"
            :tabs="[
              { label: '模特库', value: 'modelLib' },
              { label: '上传模特', value: 'uploadModel' },
            ]"
          />
          <div v-show="tabValue === 'modelLib'">
            <SelectGroup
              v-model:data="modelFilterData"
              :list="[
                { field: 'gender', options: genderOps, placeholder: '性别' },
                { field: 'age', options: ageOps, placeholder: '年龄' },
                { field: 'skin', options: skinOps, placeholder: '肤色' },
              ]"
              :col="3"
              class="mt-8px"
              clearable
            />
            <GridImage
              class="mt-8px"
              v-model:imageUrl="formData.personUrl"
              :imgList="modelList.map((item) => item.url)"
              :scrollCallBack="scrollCallBack"
              :loading="pagingData.loading"
            />
          </div>

          <div v-show="tabValue === 'uploadModel'" class="mt-8px">
            <ImageUpload
              fromAsset
              v-model:imgList="formData.uploadPersonUrl"
              btnName="上传模特图"
              :limitNumber="1"
              :topRightTips="false"
            />
          </div>
        </div>

        <SectionTitle>试衣模版</SectionTitle>
        <div v-loading="posePagingData.loading" class="relative">
          <Tab
            v-model:value="poseTabValue"
            :tabs="[
              { label: '试衣模版', value: 'poseLib' },
              { label: '自定义模版', value: 'uploadPose' },
            ]"
          />
          <div v-show="poseTabValue === 'poseLib'">
            <SelectGroup
              v-model:data="poseFilterData"
              :list="[{ field: 'clothStyle', options: clothStyleOps, placeholder: '款式模版' }]"
              :col="1"
              class="mt-8px"
              clearable
            />
            <GridImage
              class="mt-8px"
              ratio="3:4"
              v-model:imageUrl="formData.poseUrl"
              :imgList="poseList.map((item) => item.url)"
              :scrollCallBack="poseScrollCallBack"
              :loading="posePagingData.loading"
            />
          </div>

          <div v-show="poseTabValue === 'uploadPose'" class="mt-8px">
            <ImageUpload
              fromAsset
              v-model:imgList="formData.uploadPoseUrl"
              btnName="上传模板"
              :limitNumber="1"
              :topRightTips="false"
            />
          </div>
        </div>

        <SectionTitle>选择背景</SectionTitle>
        <GridImage
          class="mt-8px"
          v-model:imageUrl="formData.bgImageUrl"
          :imgList="bgList.map((item) => item.url)"
          :scrollCallBack="bgScrollCallBack"
        />
      </div>
    </template>

    <template #settings>
      <SettingsBar v-model:data="formData" :model-options="modelOps" />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample
        v-else
        title="AI试衣"
        :rightDesc="`上传服装平铺原图，智能匹配真人模特，生成实景上身穿搭展示效果图。`"
        image="e-commerce/clothing-try.webp"
      >
      </Sample>
    </template>
  </Container>
</template>
