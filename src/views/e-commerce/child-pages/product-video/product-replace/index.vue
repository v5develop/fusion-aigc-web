<script setup lang="ts">
import SectionTitle from '@/views/e-commerce/child-pages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref } from 'vue'
import Container from '../../../child-pages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import Sample from '@/views/e-commerce/child-pages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/child-pages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/child-pages/hooks.ts'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'product-replace' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('product-replace')
provide('recordsData', taskList)
// 结果为视频：卡片按视频渲染，失败/超时占位也用视频文案
provide('recordMediaType', 'video')

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
  <Container title="商品替换" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #titleExtra>
      <!-- 使用说明弹层：raw + sx-pop（line 描边、r10、shadow-pop），与触发钮隔 8 -->
      <n-popover raw trigger="click" placement="bottom-start" :show-arrow="false">
        <template #trigger>
          <button
            type="button"
            class="grid place-items-center p-0 border-none rounded-sm bg-transparent text-placeholder cursor-pointer hover:text-ink-2 sx-focus"
            aria-label="使用说明"
          >
            <svg class="block" viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path
                d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z"
              />
              <path
                d="M623.6 316.7C593.6 290.4 554 276 512 276s-81.6 14.5-111.6 40.7C369.2 344 352 380.7 352 420v7.6c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V420c0-44.1 43.1-80 96-80s96 35.9 96 80c0 31.1-22 59.6-56.1 72.7-21.2 8.1-39.2 22.3-52.1 40.9-13.1 19-19.9 41.8-19.9 64.9V620c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-22.7a48.3 48.3 0 0130.9-44.8c59-22.7 97.1-74.7 97.1-132.5.1-39.3-17.1-76-48.3-103.3zM472 732a40 40 0 1080 0 40 40 0 10-80 0z"
              />
            </svg>
          </button>
        </template>
        <div class="my-8px sx-pop max-w-234px p-14px box-border" role="note" aria-label="使用说明">
          <div class="text-14px font-600 leading-20px text-ink">上传商品图，一键生成视频</div>
          <div class="mt-6px text-11px leading-17px text-muted">拍摄：画面中只存在单件商品，需展示完整商品</div>
        </div>
      </n-popover>
    </template>
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload
          pastePrimary
          fromAsset
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
          <span class="mt-12px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <SectionTitle>参考视频</SectionTitle>
        <p class="-mt-4px mb-8px text-11px leading-17px text-muted">
          上传参考样片，AI 精准复刻镜头运镜、色调与画面整体风格
        </p>
        <VideoUpload fromAsset v-model:videoList="formData.videoUrl">
          <span class="mt-12px text-11px leading-17px text-muted">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </VideoUpload>
      </div>
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample v-else title="商品替换" :rightDesc="`保留原有视频场景光影，一键替换画面商品，省去重新拍摄场景成本。`">
        <video
          class="block w-full mx-auto rounded-lg"
          controls
          :src="VITE_OSS_ASSET_URL + 'e-commerce/video/product-replace.mp4'"
        ></video>
      </Sample>
    </template>
  </Container>
</template>
