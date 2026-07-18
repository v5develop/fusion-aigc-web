<script setup lang="ts">
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
import { modelOps } from '@/views/picture/constants.ts'
import { useMessage } from 'naive-ui'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ClothingKitParams } from '@/views/home/ChatInputBox/targetParams'

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
  modelCode: 'local-image',
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
    (formData as any).uploadPersonUrl = p.uploadPersonUrl
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
  <Container class="commerce" title="AI穿戴套图" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload v-model:imgList="formData.imageUrls" btnName="服装图片" :limitNumber="3" multiple>
          <span style="color: #9e9e9e; margin-top: 15px">建议使用服饰白底图、服饰平铺图，识别效果更佳</span>
        </ImageUpload>

        <div class="module-title">选择模特</div>
        <div v-loading="pagingData.loading" style="position: relative">
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
              style="margin-top: 12px"
              clearable
              multiple
            />
            <GridImage
              style="margin-top: 8px"
              v-model:imageUrl="formData.personUrl"
              :imgList="modelList.map((item) => item.url)"
              :scrollCallBack="scrollCallBack"
            />
          </div>

          <div v-show="tabValue === 'uploadModel'" style="margin-top: 8px">
            <ImageUpload
              v-model:imgList="formData.uploadPersonUrl"
              btnName="上传模特图"
              :limitNumber="1"
              :topRightTips="false"
            >
              <span style="color: #9e9e9e; margin-top: 15px">建议上传模特全身图</span>
              <span style="color: #9e9e9e; margin-top: 4px">图片大小20k-15M，分辨率大于400*400</span>
            </ImageUpload>
          </div>
        </div>

        <div class="module-title">图片比例</div>
        <Tab
          v-model:value="formData.aspectRatio"
          :tabs="[
            { label: '3:4', value: '3:4' },
            { label: '1:1', value: '1:1' },
            { label: '9:16', value: '9:16' },
          ]"
        />

        <div class="module-title">选择模型</div>
        <SelectGroup v-model:data="formData" :list="[{ field: 'modelCode', options: modelOps }]" :col="1" />

        <div class="module-title">拍摄场景（多选）</div>
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

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="AI穿戴套图"
        :rightDesc="`同款服饰搭配同一模特，批量生成居家、户外等多种场景穿搭成片。`"
      >
        <n-carousel
          style="height: 384px; width: 100%"
          dot-type="line"
          autoplay
          :interval="3000"
          :theme-overrides="{ dotColor: '#c4c4c4', dotColorActive: '#8e66f9' }"
        >
          <img class="carousel-img" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit1.webp'" alt="" />
          <img class="carousel-img" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit2.webp'" alt="" />
          <img class="carousel-img" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit3.webp'" alt="" />
          <img class="carousel-img" :src="VITE_OSS_ASSET_URL + 'e-commerce/clothing-kit4.webp'" alt="" />
        </n-carousel>
      </Sample>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
    > .switch-cont {
      height: 52px;
      border-radius: 12px;
      border: 1px solid #f0f0f0;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    > .textarea-cont {
      margin: 12px 0;
      > .label {
        line-height: 20px;
        color: #9e9e9e;
        margin-bottom: 12px;
      }
    }
  }
  :deep(.n-carousel) {
    border-radius: 24px;
    // 指示器颜色改用 n-carousel 的 theme-overrides（dotColor/dotColorActive）设置，
    // 避免自定义 CSS 与 naive 运行时规则同权重打架导致非激活点仍是半透明白而"看不见"
  }
  .carousel-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
