<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/childPages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
// 自定义场景描述暂时下线（见模板中注释掉的 textarea-cont），恢复时一并放开
// import Textarea from '@/components/Textarea/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { publicTemplate } from '@/api/methods.ts'
import { ageOps, genderOps, skinOps, sceneOps } from '@/views/e-commerce/childPages/constants.ts'
// 与图片模块同一套模型（本地模型 / GPT-Image-2），复用其常量避免两处定义漂移
import { modelOps } from '@/views/image/constants.ts'
import { useMessage } from 'naive-ui'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ClothingKitParams } from '@/views/home/ChatInputBox/targetParams'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'clothing-kit' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('clothing-kit')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  personUrl: '', // 模特库
  uploadPersonUrl: [], // 上传的模特
  aspectRatio: '3:4',
  modelCode: 'xiaoqi-image-1.0-flash',
  prompt: '',
  scenePhoto: [] as string[],
})

const store = useHomeStore()
const { global_formData } = storeToRefs(store)
const tabValue = ref<'modelLib' | 'uploadModel'>('modelLib')
if (global_formData.value.home) {
  const p = global_formData.value.ecommerce.params as ClothingKitParams
  if (p.imageUrls?.length) (formData as any).imageUrls = p.imageUrls
  if (p.personUrl) formData.personUrl = p.personUrl
  if (p.uploadPersonUrl?.length) {
    ;(formData as any).uploadPersonUrl = p.uploadPersonUrl
    tabValue.value = 'uploadModel'
  }
  if (p.aspectRatio) formData.aspectRatio = p.aspectRatio
  if (p.scenePhoto?.length) formData.scenePhoto = p.scenePhoto
  if (p.prompt) formData.prompt = p.prompt
  store.reset()
}

const switchValue = ref(true)
const { modelFilterData, pagingData, modelList, scrollCallBack } = useModelList()
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({
    entryCode: 'wearingProductSetImages',
    modelCode: formData.modelCode,
    params: {
      scenePhoto: formData.prompt ? [...formData.scenePhoto, formData.prompt] : formData.scenePhoto,
    },
  }),
  // deep 是为 scenePhoto 数组保留的，勿删
  [() => formData.scenePhoto, () => formData.modelCode],
  { deep: true },
)

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传服装图')
  }
  if (tabValue.value === 'modelLib' && !formData.personUrl) {
    return message.warning('请选择模特')
  }
  if (tabValue.value === 'uploadModel' && !formData.uploadPersonUrl.length) {
    return message.warning('请上传模特')
  }
  if (!formData.scenePhoto.length && !formData.prompt) {
    return message.warning('请选择拍摄场景')
  }

  const params = {
    type: 'wearingProductSetImages',
    imageUrls: formData.imageUrls,
    modelCode: formData.modelCode,
    params: {
      personUrl: tabValue.value === 'modelLib' ? formData.personUrl : formData.uploadPersonUrl[0],
      aspectRatio: formData.aspectRatio,
      scenePhoto: formData.prompt ? [...formData.scenePhoto, formData.prompt] : formData.scenePhoto,
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
      moduleCode: 'wearingProductSetImages',
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

  return { modelFilterData, pagingData, modelList, scrollCallBack }
}
</script>

<template>
  <Container title="AI穿戴套图" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload fromAsset v-model:imgList="formData.imageUrls" btnName="服装图片" :limitNumber="7" multiple>
          <span class="mt-12px text-11px leading-17px text-muted">建议使用服饰白底图、服饰平铺图，识别效果更佳</span>
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
              multiple
            />
            <GridImage
              class="mt-8px"
              ratio="3:4"
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
            >
              <span class="mt-12px text-11px leading-17px text-muted">建议上传模特全身图</span>
              <span class="mt-4px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
            </ImageUpload>
          </div>
        </div>

        <!-- 「图片比例」栏已隐藏，画幅固定按 formData.aspectRatio 默认值 3:4 提交 -->

        <SectionTitle>拍摄场景（多选）</SectionTitle>
        <!--        <div class="switch-cont">-->
        <!--          <span>AI推荐</span>-->
        <!--          <n-switch v-model:value="switchValue" />-->
        <!--        </div>-->
        <template v-if="switchValue">
          <CheckboxGroup v-model="formData.scenePhoto" :list="sceneOps" :col="2" gap="8px" />
          <!--          <div class="textarea-cont">
            <div class="label">或自定义描述场景（可选）</div>
            <Textarea
              v-model:value="formData.prompt"
              placeholder="描述你想要的场景：春日樱花漫道、柔白窗边天光、女生斜倚木质窗台…"
            />
          </div>-->
        </template>
      </div>
    </template>

    <template #settings>
      <SettingsBar v-model:data="formData" :model-options="modelOps" />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample v-else title="AI穿戴套图" :rightDesc="`同款服饰搭配同一模特，批量生成居家、户外等多种场景穿搭成片。`">
        <!-- 指示条颜色取色板 token（line-strong / violet），不在 theme-overrides 里写死色值 -->
        <n-carousel
          class="h-384px w-full rounded-lg overflow-hidden [&_.n-carousel\_\_dot]:!bg-line-strong [&_.n-carousel\_\_dot--active]:!bg-violet"
          dot-type="line"
          autoplay
          :interval="3000"
        >
          <img class="w-full h-full object-cover" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit1.webp'" alt="" />
          <img class="w-full h-full object-cover" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit2.webp'" alt="" />
          <img class="w-full h-full object-cover" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit3.webp'" alt="" />
          <img class="w-full h-full object-cover" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit4.webp'" alt="" />
        </n-carousel>
      </Sample>
    </template>
  </Container>
</template>
