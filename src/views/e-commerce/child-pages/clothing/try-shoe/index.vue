<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/child-pages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/child-pages/components/SectionTitle/index.vue'
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../../child-pages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { poseOps, shoeStyleOps, genderOps } from '@/views/e-commerce/child-pages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
// 与图片模块同一套模型（本地模型 / GPT-Image-2），复用其常量避免两处定义漂移
import { modelOps } from '@/views/image/constants.ts'
import GridImage from '@/views/e-commerce/child-pages/components/GridImage/index.vue'
import RecordList from '@/views/e-commerce/child-pages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/child-pages/components/Sample/index.vue'
import { useMessage } from 'naive-ui'
import { publicTemplate } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/child-pages/hooks.ts'
import { useQuotePreview } from '@/utils/hooks'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'try-shoe' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('try-shoe')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  personUrl: '', // 鞋库
  uploadPersonUrl: [], // 上传的鞋
  modelCode: 'xiaoqi-image-1.0-flash',
})
const { shoeFilterData, pagingData, tabValue, shoeList, scrollCallBack } = useShoeList()
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({ entryCode: 'shoeSwapping', modelCode: formData.modelCode }),
  [() => formData.modelCode],
)

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }
  if (tabValue.value === 'shoeLib' && !formData.personUrl) {
    return message.warning('请选择鞋子')
  }
  if (tabValue.value === 'uploadShoe' && !formData.uploadPersonUrl.length) {
    return message.warning('请上传鞋子')
  }

  const params = {
    type: 'shoeSwapping',
    imageUrls: formData.imageUrls,
    modelCode: formData.modelCode,
    params: {
      personUrl: tabValue.value === 'shoeLib' ? formData.personUrl : formData.uploadPersonUrl[0],
    },
  }
  execute(params, loading)
}

function useShoeList() {
  const shoeFilterData = reactive({
    gender: null,
    pose: null,
    shoeStyle: null,
  })
  const pagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  // shoeLib:鞋库  uploadShoe:上传的鞋
  const tabValue = ref<'shoeLib' | 'uploadShoe'>('shoeLib')
  const shoeList = ref<any[]>([])

  // 鞋库tab列表
  const publicTemplateApi = () => {
    if (pagingData.loading) return
    const params = {
      moduleCode: 'shoeSwapping',
      slotCode: 'shoeTemplate',
      filters: {
        gender: [shoeFilterData.gender],
        pose: [shoeFilterData.pose],
        shoeStyle: [shoeFilterData.shoeStyle],
      },
      ...pagingData,
    } as const
    pagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          pagingData.page++
          shoeList.value.push(...res.data.list)
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

  watch(shoeFilterData, () => {
    pagingData.page = 1
    pagingData.hasMore = true
    shoeList.value = []
    publicTemplateApi()
  })

  return { shoeFilterData, pagingData, tabValue, shoeList, scrollCallBack }
}
</script>

<template>
  <Container title="AI试鞋" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload
          pastePrimary
          fromAsset
          v-model:imgList="formData.imageUrls"
          btnName="上传产品图"
          :limitNumber="1"
          :topRightTips="false"
          :tryImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe3.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe4.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe5.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe6.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe7.png',
          ]"
        >
          <span class="mt-12px px-20px text-center text-11px leading-17px text-muted"
            >建议上传白底、无杂物的单独鞋子素材，复杂背景会影响试鞋合成效果</span
          >
          <span class="mt-4px px-20px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <SectionTitle>试鞋模版</SectionTitle>
        <div v-loading="pagingData.loading" class="relative">
          <Tab
            v-model:value="tabValue"
            :tabs="[
              { label: '试鞋模版', value: 'shoeLib' },
              { label: '上传模版', value: 'uploadShoe' },
            ]"
          />
          <div v-show="tabValue === 'shoeLib'">
            <SelectGroup
              v-model:data="shoeFilterData"
              :list="[
                { field: 'gender', options: genderOps, placeholder: '性别' },
                { field: 'pose', options: poseOps, placeholder: '姿势' },
                { field: 'shoeStyle', options: shoeStyleOps, placeholder: '款式' },
              ]"
              :col="3"
              class="mt-8px"
              clearable
            />
            <GridImage
              class="mt-8px"
              ratio="3:4"
              v-model:imageUrl="formData.personUrl"
              :imgList="shoeList.map((item) => item.url)"
              :scrollCallBack="scrollCallBack"
              :loading="pagingData.loading"
            />
          </div>

          <div v-show="tabValue === 'uploadShoe'" class="mt-8px">
            <ImageUpload
              fromAsset
              v-model:imgList="formData.uploadPersonUrl"
              btnName="上传模版图"
              :limitNumber="1"
              :topRightTips="false"
            />
          </div>
        </div>
      </div>
    </template>

    <template #settings>
      <SettingsBar v-model:data="formData" :model-options="modelOps" />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample
        v-else
        title="AI试鞋"
        :rightDesc="`上传鞋子单品图，自动生成真人上脚实拍图，省去线下实景拍摄流程。`"
        image="e-commerce/try-shoe.webp"
      >
      </Sample>
    </template>
  </Container>
</template>
