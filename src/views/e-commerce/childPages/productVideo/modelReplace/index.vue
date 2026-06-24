<script setup lang="ts">
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { genderOps, ageOps, skinOps } from '../../constants.ts'
import Tab from '@/components/Tab/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import { publicTemplate, quotePreview } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { useMessage } from 'naive-ui'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('model-replace')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  personUrl: '', // 模特库
  uploadPersonUrl: [], // 上传的模特
  videoUrl: [] as IVideoItem[],
  target: 'face', // face:换脸  head:换头  person:换全身
})
const { modelFilterData, pagingData, tabValue, modelList, scrollCallBack } = useModelList()
const { integral } = useIntegral()

const submit = () => {
  if (loading.value) return

  if (!formData.videoUrl.length) {
    return message.warning('请上传参考视频')
  }
  if (tabValue.value === 'modelLib' && !formData.personUrl) {
    return message.warning('请选择模特')
  }
  if (tabValue.value === 'uploadModel' && !formData.uploadPersonUrl.length) {
    return message.warning('请上传模特')
  }

  const params = {
    type: 'personReplacement',
    videoUrl: formData.videoUrl[0]!.url,
    params: {
      personUrl: tabValue.value === 'modelLib' ? formData.personUrl : formData.uploadPersonUrl[0],
      target: formData.target,
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
      moduleCode: 'personReplacement',
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
function useIntegral() {
  const integral = ref(0)

  const quotePreviewApi = () => {
    const params = {
      entryCode: 'personReplacement',
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
  <Container class="commerce" title="模特替换" :submit="submit" :loading="loading" :integral="integral">
    <template #default>
      <div class="default-content">
        <div class="module-title">参考视频</div>
        <VideoUpload v-model:videoList="formData.videoUrl" btnName="上传参考视频">
          <span style="color: #9e9e9e; margin-top: 15px">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </VideoUpload>

        <div v-loading="pagingData.loading" style="position: relative">
          <div class="module-title">选择模特</div>
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
              :tryImages="[
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace1.png',
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace2.png',
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace3.png',
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace4.png',
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace5.png',
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace6.png',
                VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/model-replace7.png',
              ]"
            />
          </div>
        </div>

        <div class="module-title">替换区域</div>
        <Tab
          v-model:value="formData.target"
          :tabs="[
            { label: '换脸', value: 'face' },
            { label: '换头', value: 'head' },
            { label: '换模特/服装', value: 'person' },
          ]"
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
        title="模特替换"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
      >
        <video class="video" controls :src="VITE_OSS_ASSET_URL + 'e-commerce/video/model-replace.mp4'"></video>
      </Sample>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
    > .checkbox-cont {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      > .item {
        flex: 1;
        min-width: 40%;
      }
    }
    .switch-pos {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    .model-diy-cont {
      > .model-diy {
        > .textarea-area {
          font-size: 0;
          > .title {
            font-size: 14px;
            line-height: 20px;
            color: #9e9e9e;
            margin: 12px 0 8px;
          }
        }
        > .generate-btn {
          height: 32px;
          margin: 12px 0;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          background: #f5f6f8;
          cursor: pointer;
          &:hover {
            background: #ebecef;
          }
        }
      }
    }
  }

  .video {
    width: 100%;
    display: block;
    margin: 0 auto;
    border-radius: 5px;
  }
}
</style>
