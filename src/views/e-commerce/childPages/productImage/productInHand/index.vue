<script setup lang="ts">
import { provide, reactive, ref, watch } from 'vue'
import Container from '@/views/e-commerce/childPages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { platformOps, regionOps, languageOps, aspectRatioOps, genderOps, ageOps, skinOps } from '../../constants.ts'
import Tab from '@/components/Tab/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { publicTemplate, quotePreview } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('product-in-hand')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  modelGesturesUrl: '', // 模特手持图
  gesturesUrl: '', // 纯手持图
  personUrl: '', // 模特图
  bgImageUrl: '', // 背景图
  platform: '淘宝/天猫',
  region: '中国',
  language: '中文',
  aspectRatio: '1:1',
})
const { handPagingData, handTabValue, handListObj, handScrollCallBack } = useHandList()
const { modelFilterData, modelPagingData, modelList, scrollCallBack } = useModelList()
const { bgList, bgScrollCallBack } = useBg()
const { integral } = useIntegral()

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }

  const params = {
    type: 'aiGestures',
    imageUrls: formData.imageUrls,
    params: {
      modelGesturesUrl: handTabValue.value === 'modelGestures' ? formData.modelGesturesUrl : '',
      gesturesUrl: formData.gesturesUrl,
      personUrl: formData.personUrl,
      bgImageUrl: formData.bgImageUrl,
      platform: formData.platform,
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
    },
  }
  execute(params, loading)
}

function useHandList() {
  const handPagingData = reactive<Record<string, any>>({
    modelGestures: {
      page: 1,
      pageSize: 20,
      loading: false,
      hasMore: true,
    },
    handGestures: {
      page: 1,
      pageSize: 20,
      loading: false,
      hasMore: true,
    },
  })
  // modelGestures:模特手持  onlyHand: 纯手手持
  const handTabValue = ref<'modelGestures' | 'handGestures'>('modelGestures')
  const handListObj = reactive<Record<string, any>>({
    modelGesturesList: [],
    handGesturesList: [],
  })

  // 手持姿势列表
  const publicTemplateApi = (handType?: string) => {
    handType = handType ?? handTabValue.value
    if (handPagingData[handType].loading) return
    const params = {
      moduleCode: 'aiGestures',
      slotCode: 'gestures',
      filters: {
        handType,
      },
      ...handPagingData[handType],
    }
    handPagingData[handType].loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          handPagingData[handType].page++
          handListObj[handType + 'List'].push(...res.data.list)
          if (res.data.list.length < handPagingData[handType].pageSize) {
            handPagingData[handType].hasMore = false
          }
        }
      })
      .finally(() => (handPagingData[handType].loading = false))
  }
  publicTemplateApi()
  publicTemplateApi('handGestures')

  const handScrollCallBack = () => {
    if (handPagingData[handTabValue.value].hasMore) publicTemplateApi()
  }

  return { handPagingData, handTabValue, handListObj, handScrollCallBack }
}
function useModelList() {
  const modelFilterData = reactive({
    gender: null,
    age: null,
    skin: null,
  })
  const modelPagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  const modelList = ref<any[]>([])

  // 模特库tab列表
  const publicTemplateApi = (isFilter?: boolean) => {
    if (modelPagingData.loading) return
    const params = {
      moduleCode: 'aiGestures',
      slotCode: 'model',
      filters: {
        gender: [modelFilterData.gender],
        age: [modelFilterData.age],
        skin: [modelFilterData.skin],
      },
      ...modelPagingData,
    } as const
    modelPagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          modelPagingData.page++

          if (isFilter) {
            modelList.value = res.data.list
          } else {
            modelList.value.push(...res.data.list)
          }

          if (res.data.list.length < modelPagingData.pageSize) {
            modelPagingData.hasMore = false
          }
        }
      })
      .finally(() => (modelPagingData.loading = false))
  }
  publicTemplateApi()

  const scrollCallBack = () => {
    if (modelPagingData.hasMore) publicTemplateApi()
  }

  watch(modelFilterData, () => {
    modelPagingData.page = 1
    modelPagingData.hasMore = true
    publicTemplateApi(true)
  })

  return { modelFilterData, modelPagingData, modelList, scrollCallBack }
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
      moduleCode: 'aiGestures',
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
function useIntegral() {
  const integral = ref(0)

  const quotePreviewApi = () => {
    const params = {
      entryCode: 'aiGestures',
    }
    quotePreview(params).then((res) => {
      if (res.code === 0) {
        integral.value = res.data.pricePoints
      }
    })
  }
  quotePreviewApi()

  return { integral }
}
</script>

<template>
  <Container class="commerce" title="手持商品" :submit="submit" :loading="loading" :integral="integral">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          :limitNumber="3"
          multiple
          bottomTips
          :exampleImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-in-hand1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-in-hand2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-in-hand3.png',
          ]"
        />

        <div class="module-title">生成设置</div>
        <SelectGroup
          v-model:data="formData"
          :list="[
            { field: 'platform', options: platformOps },
            { field: 'region', options: regionOps },
            { field: 'language', options: languageOps },
            { field: 'aspectRatio', options: aspectRatioOps },
          ]"
        />

        <div class="module-title">手持姿势</div>
        <div v-loading="handPagingData.modelGestures.loading" style="position: relative">
          <Tab
            v-model:value="handTabValue"
            :tabs="[
              { label: '模特手持', value: 'modelGestures' },
              { label: '纯手手持', value: 'handGestures' },
            ]"
          />
          <div v-show="handTabValue === 'modelGestures'">
            <GridImage
              style="margin-top: 8px"
              v-model:imageUrl="formData.modelGesturesUrl"
              :imgList="handListObj.modelGesturesList.map((item: any) => item.url)"
              :scrollCallBack="handScrollCallBack"
            />
          </div>

          <div v-show="handTabValue === 'handGestures'" style="margin-top: 8px">
            <GridImage
              style="margin-top: 8px"
              v-model:imageUrl="formData.gesturesUrl"
              :imgList="handListObj.handGesturesList.map((item: any) => item.url)"
              :scrollCallBack="handScrollCallBack"
            />
          </div>
        </div>

        <template v-if="handTabValue === 'modelGestures'">
          <div class="module-title">选择模特</div>
          <div v-loading="modelPagingData.loading" style="position: relative">
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
        </template>

        <div class="module-title">选择背景</div>
        <GridImage
          style="margin-top: 8px"
          v-model:imageUrl="formData.bgImageUrl"
          :imgList="bgList.map((item) => item.url)"
          :scrollCallBack="bgScrollCallBack"
        />
      </div>
    </template>

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="手持商品"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的手持商品。`"
        image="e-commerce/product-in-hand-sample.webp"
      />
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
  }
}
</style>
