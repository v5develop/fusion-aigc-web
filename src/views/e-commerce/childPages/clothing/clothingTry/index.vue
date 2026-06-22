<script setup lang="ts">
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import {
  ageOps,
  genderOps,
  angleOps,
  shotTypeOps,
  clothStyleOps,
  styleOps,
  skinOps,
} from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { publicTemplate } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

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
})
const { modelFilterData, pagingData, tabValue, modelList, scrollCallBack } = useModelList()
const { poseFilterData, posePagingData, poseTabValue, poseList, poseScrollCallBack } = usePose()
const { bgList, bgScrollCallBack } = useBg()

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

  const params = {
    type: 'aiClothExchange',
    imageUrls: formData.imageUrls,
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
  const tabValue = ref<'modelLib' | 'uploadModel'>('modelLib')
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

function usePose() {
  const poseFilterData = reactive({
    gender: null,
    age: null,
    angle: null,
    shotType: null,
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
        gender: [poseFilterData.gender],
        age: [poseFilterData.age],
        angle: [poseFilterData.angle],
        shotType: [poseFilterData.shotType],
        clothStyle: [poseFilterData.clothStyle],
      },
      ...posePagingData,
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
  <Container class="commerce" title="AI试衣" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          btnName="上传产品图"
          :limitNumber="1"
          :topRightTips="false"
        >
          <span style="color: #9e9e9e; margin-top: 15px">图片大小20k-15M，分辨率大于400*400</span>
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
            />
          </div>
        </div>

        <div class="module-title">选择试衣模版</div>
        <div v-loading="posePagingData.loading" style="position: relative">
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
              :list="[
                { field: 'gender', options: genderOps, placeholder: '性别' },
                { field: 'age', options: ageOps, placeholder: '年龄' },
                { field: 'angle', options: angleOps, placeholder: '角度' },
                { field: 'shotType', options: shotTypeOps, placeholder: '景别' },
                { field: 'style', options: styleOps, placeholder: '风格' },
                { field: 'clothStyle', options: clothStyleOps, placeholder: '款式模版' },
              ]"
              :col="3"
              style="margin-top: 12px"
              clearable
              multiple
            />
            <GridImage
              style="margin-top: 8px"
              v-model:imageUrl="formData.poseUrl"
              :imgList="poseList.map((item) => item.url)"
              :scrollCallBack="poseScrollCallBack"
            />
          </div>

          <div v-show="poseTabValue === 'uploadPose'" style="margin-top: 8px">
            <ImageUpload
              v-model:imgList="formData.uploadPoseUrl"
              btnName="上传模板"
              :limitNumber="1"
              :topRightTips="false"
            />
          </div>
        </div>

        <div class="module-title">选择场景</div>
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
        title="AI试衣"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
        image="e-commerce/clothing-try.webp"
      >
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
}
</style>
