<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import VideoUpload from '@/components/VideoUpload/index.vue'
import { ecommerceSubmit } from '@/api/methods.ts'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/asset/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, getSessionId, startPolling } = useInitCheckTaskStatus('video-clone')
provide('recordsData', taskList)

const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  videoUrl: [],
})

const submit = () => {
  if (loading.value) return

  const sessionId = getSessionId()
  const params = {
    sessionId,
    type: 'productReplacement',
    imageUrls: formData.imageUrls,
    videoUrl: formData.videoUrl[0],
  }
  loading.value = true
  ecommerceSubmit(params)
    .then((res) => {
      if (res.code === 0) {
        // 开始轮询
        startPolling(sessionId)
      }
    })
    .finally(() => (loading.value = false))
}
</script>

<template>
  <Container class="commerce" title="商品替换" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          btnName="上传参产品图"
          :tryImages="[
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
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
      <div v-if="taskList?.length">
        <div class="right-content-title">生成结果</div>
        <RecordList :showSelect="false" />
      </div>
      <Sample
        v-else
        title="商品替换"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
      >
        <video class="video" controls :src="VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot2.mp4'"></video>
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
    height: 50vh;
    display: block;
    margin: 0 auto;
  }
}
</style>
