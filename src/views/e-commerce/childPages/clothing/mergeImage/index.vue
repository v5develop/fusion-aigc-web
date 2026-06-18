<script setup lang="ts">
import { reactive, ref, provide, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { ageOps, aspectRatioOps, genderOps, skinOps } from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { publicTemplate } from '@/api/methods.ts'
import { useMessage } from 'naive-ui'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'

const { taskList, showList, execute } = useInitCheckTaskStatus('merge-image')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  personUrl: '', // 模特库
  uploadPersonUrl: [], // 上传的模特
  imageUrls: [] as string[],
  aspectRatio: '1:1',
  userInput: '',
})
const { modelFilterData, pagingData, tabValue, modelList, scrollCallBack } = useModelList()

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
  <Container class="commerce" title="搭配融图" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
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

        <div class="module-title">选择搭配图</div>
        <ImageUpload v-model:imgList="formData.imageUrls" :limitNumber="7" btnName="上传搭配图" />

        <div class="module-title">生成设置</div>
        <SelectGroup
          v-model:data="formData"
          :list="[{ field: 'aspectRatio', options: aspectRatioOps }]"
          style="margin-top: 12px"
          :col="1"
        />

        <div class="module-title">生成要求</div>
        <PromptAssist
          v-model:value="formData.userInput"
          placeholder="请输入生成穿搭描述，您也可以在上传多张素材图后点击【A帮写】一键分析"
          style="margin-bottom: 15px"
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
        title="搭配融图"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
        image="e-commerce/merge-image.webp"
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

  .sample-cont {
  }
}
</style>
