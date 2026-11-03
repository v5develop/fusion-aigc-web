<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/childPages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { reactive, ref, provide, watch, computed } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { ageOps, aspectRatioOps, genderOps, skinOps } from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
// 与图片模块同一套模型（本地模型 / GPT-Image-2），复用其常量避免两处定义漂移
import { modelOps } from '@/views/picture/constants.ts'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { publicTemplate } from '@/api/methods.ts'
import { useMessage } from 'naive-ui'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'merge-image' })

const { taskList, showList, execute } = useInitCheckTaskStatus('merge-image')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  personUrl: '', // 模特库
  uploadPersonUrl: [], // 上传的模特
  imageUrls: [] as string[],
  aspectRatio: '1:1',
  modelCode: 'xiaoqi-image-1.0-flash',
  userInput: '',
})
const { modelFilterData, pagingData, tabValue, modelList, scrollCallBack } = useModelList()
const promptImages = computed(() => {
  const images: string[] = []
  if (tabValue.value === 'modelLib') images.push(formData.personUrl)
  else images.push(formData.uploadPersonUrl[0] ?? '')

  images.push(...formData.imageUrls)
  return images
})
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({ entryCode: 'mergeClothes', modelCode: formData.modelCode }),
  [() => formData.modelCode],
)

const submit = () => {
  if (loading.value) return

  if (tabValue.value === 'modelLib' && !formData.personUrl) {
    return message.warning('请选择模特')
  }
  if (tabValue.value === 'uploadModel' && !formData.uploadPersonUrl.length) {
    return message.warning('请上传模特')
  }
  if (!formData.imageUrls.length) {
    return message.warning('请上传搭配图')
  }

  const params = {
    type: 'mergeClothes',
    imageUrls: formData.imageUrls,
    modelCode: formData.modelCode,
    params: {
      personUrl: tabValue.value === 'modelLib' ? formData.personUrl : formData.uploadPersonUrl[0],
      aspectRatio: formData.aspectRatio,
      userInput: formData.userInput,
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
  const tabValue = ref<'modelLib' | 'uploadModel'>('modelLib')
  const modelList = ref<any[]>([])

  // 模特库tab列表
  const publicTemplateApi = () => {
    if (pagingData.loading) return
    const params = {
      moduleCode: 'mergeClothes',
      slotCode: 'model',
      filters: {
        gender: [modelFilterData.gender],
        age: [modelFilterData.age],
        skin: [modelFilterData.skin],
      },
      ...pagingData,
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

  return { modelFilterData, pagingData, tabValue, modelList, scrollCallBack }
}
</script>

<template>
  <Container title="搭配融图" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
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
              multiple
            />
            <GridImage
              class="mt-8px"
              v-model:imageUrl="formData.personUrl"
              :imgList="modelList.map((item) => item.url)"
              :scrollCallBack="scrollCallBack"
            />
          </div>

          <div v-show="tabValue === 'uploadModel'" class="mt-8px">
            <ImageUpload
              fromAsset
              v-model:imgList="formData.uploadPersonUrl"
              btnName="上传模特图"
              :limitNumber="1"
              :topRightTips="false"
            >
              <span class="mt-12px text-11px leading-17px text-muted">建议上传模特全身图</span>
              <span class="mt-4px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
            </ImageUpload>
          </div>
        </div>

        <SectionTitle>选择搭配图</SectionTitle>
        <ImageUpload fromAsset v-model:imgList="formData.imageUrls" :limitNumber="7" btnName="上传搭配图">
          <span class="mt-12px text-11px leading-17px text-muted">建议使用服饰白底图、服饰平铺图，识别效果更佳</span>
        </ImageUpload>

        <SectionTitle>生成要求</SectionTitle>
        <PromptAssist
          v-model:value="formData.userInput"
          :params="{
            prompt: 'aiMergeClothes',
            imageUrls: promptImages,
          }"
          :validate="
            () => {
              if (tabValue === 'modelLib' && !formData.personUrl) {
                message.warning('请选择模特图')
                return false
              }
              if (tabValue === 'uploadModel' && !formData.uploadPersonUrl.length) {
                message.warning('请上传模特图')
                return false
              }

              if (!formData.imageUrls.length) {
                message.warning('请上传产品图')
                return false
              }

              return true
            }
          "
          placeholder="填写单品款式、整套搭配组合、风格卖点、拍摄场景、版型面料要求，融合多件素材生成光影色调统一、自然协调的真人成套穿搭效果图，画质高清干净，符合电商店铺商用标准。"
        />
      </div>
    </template>

    <template #settings>
      <SettingsBar
        v-model:data="formData"
        :model-options="modelOps"
        :fields="[{ field: 'aspectRatio', label: '比例', options: aspectRatioOps }]"
      />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample
        v-else
        title="搭配融图"
        :rightDesc="`上衣、下装、配饰自由融合拼接，直观呈现完整成套穿搭视觉效果。`"
        image="e-commerce/merge-image.webp"
      >
      </Sample>
    </template>
  </Container>
</template>
