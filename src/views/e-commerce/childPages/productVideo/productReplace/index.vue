<script setup lang="ts">
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('product-replace')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  videoUrl: [] as IVideoItem[],
})
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(() => ({ entryCode: 'productReplacement' }), [])

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

</script>

<template>
  <Container class="commerce" title="商品替换" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #titleExtra>
      <n-popover trigger="click" placement="bottom-start" :show-arrow="false" :style="{ padding: '16px', borderRadius: '12px', maxWidth: '234px' }">
        <template #trigger>
          <svg class="title-help" viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
            <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z" />
            <path d="M623.6 316.7C593.6 290.4 554 276 512 276s-81.6 14.5-111.6 40.7C369.2 344 352 380.7 352 420v7.6c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V420c0-44.1 43.1-80 96-80s96 35.9 96 80c0 31.1-22 59.6-56.1 72.7-21.2 8.1-39.2 22.3-52.1 40.9-13.1 19-19.9 41.8-19.9 64.9V620c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-22.7a48.3 48.3 0 0130.9-44.8c59-22.7 97.1-74.7 97.1-132.5.1-39.3-17.1-76-48.3-103.3zM472 732a40 40 0 1080 0 40 40 0 10-80 0z" />
          </svg>
        </template>
        <div class="title-help-pop">
          <div class="pop-title">上传商品图，一键生成视频</div>
          <div class="pop-desc">拍摄：画面中只存在单件商品，需展示完整商品</div>
        </div>
      </n-popover>
    </template>
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
        <div style="color: #9e9e9e; margin: -8px 0 12px">上传参考样片，AI 精准复刻镜头运镜、色调与画面整体风格</div>
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
        :rightDesc="`保留原有视频场景光影，一键替换画面商品，省去重新拍摄场景成本。`"
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

.title-help {
  color: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  flex-shrink: 0;
}

.title-help-pop {
  .pop-title {
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: #1f1f1f;
  }
  .pop-desc {
    margin-top: 8px;
    font-size: 12px;
    line-height: 16px;
    color: #9e9e9e;
  }
}
</style>
