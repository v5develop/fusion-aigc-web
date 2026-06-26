<script setup lang="ts">
import { reactive, ref, provide } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import { regionOps, languageOps } from '@/views/e-commerce/childPages/constants.ts'
import { modelOps } from '../constants.ts'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import CustomModel from '@/views/e-commerce/childPages/productVideo/videoHot/CustomModel/index.vue'
import { videoList } from './constants.ts'
import { useMessage } from 'naive-ui'
import { quotePreview } from '@/api/methods.ts'
import { useDebounce } from '@/utils/hooks'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('video-clone')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  videoUrl: [] as IVideoItem[],
  region: '中国',
  language: '中文',
  buyPoint: '',
  modelCode: 'local',
  checked: [] as string[],
  personUrl: '',
  personUrlHs: '',
})
const { integral } = useIntegral()

const submit = () => {
  if (loading.value) return

  const params = {
    type: 'hitVideoReplication',
    imageUrls: formData.imageUrls,
    videoUrl: formData.videoUrl[0]?.url,
    modelCode: formData.modelCode,
    params: {
      region: formData.region,
      language: formData.language,
      buyPoint: formData.buyPoint,
      personUrl: formData.personUrl,
      personUrlHs: formData.personUrlHs,
    },
  }
  execute(params, loading)
}

function useIntegral() {
  const integral = ref(0)

  const quotePreviewApi = () => {
    const params = {
      entryCode: 'hitVideoReplication',
      modelCode: formData.modelCode,
    }
    quotePreview(params).then((res) => {
      if (res.code === 0) {
        integral.value = res.data.pricePoints
      }
    })
  }
  quotePreviewApi()

  useDebounce({
    data: [() => formData.modelCode],
    callback: quotePreviewApi,
    delay: 1000,
  })

  return { integral }
}
</script>

<template>
  <Container class="commerce" title="复刻视频" :submit="submit" :loading="loading" :integral="integral">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          :limitNumber="3"
          multiple
          bottomTips
          :exampleImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/video-clone1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/video-clone2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/video-clone3.png',
          ]"
        />

        <div class="module-title">参考视频</div>
        <VideoUpload v-model:videoList="formData.videoUrl" btnName="上传参考视频" multiple>
          <span style="color: #9e9e9e; margin-top: 15px">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </VideoUpload>

        <div class="module-title">目标市场与语言</div>
        <SelectGroup
          v-model:data="formData"
          :list="[
            { field: 'region', options: regionOps },
            { field: 'language', options: languageOps },
          ]"
        />

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist
          v-model:value="formData.buyPoint"
          :params="{
            prompt: 'ai_writing',
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
          placeholder="输入商品核心点、适用人群、使用场景等信息"
        />

        <!--        外面的模型只能选自己上传的达人，本地模型不做限制-->
        <div class="module-title">选择模型</div>
        <SelectGroup v-model:data="formData" :list="[{ field: 'modelCode', options: modelOps }]" :col="1" />

        <CustomModel
          v-model:personUrl="formData.personUrl"
          v-model:personUrlHs="formData.personUrlHs"
          :modelCode="formData.modelCode"
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
        title="爆款视频"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的爆款视频。`"
      >
        <div class="video-cont">
          <div class="item">
            <div class="origin-video">
              <video class="video" controls :src="videoList[0]!.url"></video>
              <div class="title">{{ videoList[0]!.title }}</div>
            </div>
            <img class="arrow" :src="VITE_OSS_ASSET_URL + 'e-commerce/video-clone-arrow.png'" alt="" />
            <div class="origin-video generate-video">
              <video class="video" controls :src="videoList[1]!.url"></video>
              <div class="title">{{ videoList[1]!.title }}</div>
            </div>
          </div>

          <div class="item">
            <div class="origin-video">
              <video class="video" controls :src="videoList[2]!.url"></video>
              <div class="title">{{ videoList[2]!.title }}</div>
            </div>
            <img class="arrow" :src="VITE_OSS_ASSET_URL + 'e-commerce/video-clone-arrow.png'" alt="" />
            <div class="origin-video generate-video">
              <video class="video" controls :src="videoList[3]!.url"></video>
              <div class="title">{{ videoList[3]!.title }}</div>
            </div>
          </div>
        </div>
      </Sample>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
  }

  .video-cont {
    display: flex;
    gap: 30px;
    background-color: white;
    padding: 20px;
    border-radius: 10px;
    > .item {
      width: 50%;
      text-align: center;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 15px;
      position: relative;
      > .origin-video {
        > .video {
          width: 90%;
          border-radius: 10px;
        }
      }
      > .generate-video {
        overflow: hidden;
        > .video {
          width: 100%;
        }
      }
      > .arrow {
        width: 50px;
        position: absolute;
        top: 0;
        left: 40%;
        transform: rotateX(180deg);
      }
      > .title {
        font-size: 16px;
      }
    }
  }
}
</style>
