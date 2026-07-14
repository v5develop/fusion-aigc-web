<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'
import { quotePreview } from '@/api/methods.ts'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('product-replace')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  videoUrl: [] as IVideoItem[],
})
const { integral } = useIntegral()

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) return message.warning('请先上传产品图')
  if (!formData.videoUrl.length) return message.warning('请上传参考视频')

  const params = {
    type: 'productReplacement',
    imageUrls: formData.imageUrls,
    videoUrl: formData.videoUrl[0]?.url,
  }
  execute(params, loading)
}

function useIntegral() {
  const integral = ref(0)

  const quotePreviewApi = () => {
    const params = {
      entryCode: 'productReplacement',
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
  <Container class="commerce" title="商品替换" :submit="submit" :loading="loading" :integral="integral">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          btnName="上传参产品图"
          :topRightTips="false"
          :limitNumber="1"
          :tryImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace3.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace4.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace5.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace6.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/product-replace7.png',
          ]"
        >
          <span style="color: #9e9e9e; margin-top: 15px">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <div class="module-title">参考视频</div>
        <VideoUpload v-model:videoList="formData.videoUrl">
          <span style="color: #9e9e9e; margin-top: 10px">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </VideoUpload>
      </div>
    </template>

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="商品替换"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
      >
        <video class="video" controls :src="VITE_OSS_ASSET_URL + 'e-commerce/video/product-replace.mp4'"></video>
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
  .video {
    width: 100%;
    display: block;
    margin: 0 auto;
    border-radius: 10px;
  }
}
</style>
