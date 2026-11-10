<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/child-pages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/child-pages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { reactive, ref, provide } from 'vue'
import Container from '../../../child-pages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import PromptAssist from '../../../child-pages/components/PromptAssist/index.vue'
import { regionOps, languageOps } from '@/views/e-commerce/child-pages/constants.ts'
import { videoModelOpsFor } from '../../../child-pages/product-video/constants.ts'
import Sample from '@/views/e-commerce/child-pages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/child-pages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/child-pages/hooks.ts'
import CustomModel from '@/views/e-commerce/child-pages/product-video/video-hot/CustomModel/index.vue'
import { videoList } from '../../../child-pages/product-video/video-clone/constants.ts'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'video-clone' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('video-clone')
provide('recordsData', taskList)
// 结果为视频：卡片按视频渲染，失败/超时占位也用视频文案
provide('recordMediaType', 'video')

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  videoUrl: [] as IVideoItem[],
  region: '中国',
  language: '中文',
  buyPoint: '',
  modelCode: 'xiaoqi-video-1.0-lite',
  checked: [] as string[],
  personUrl: '',
  personUrlHs: '',
})
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({ entryCode: 'hitVideoReplication', modelCode: formData.modelCode }),
  [() => formData.modelCode],
)

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) return message.warning('请先上传产品图')
  if (!formData.videoUrl.length) return message.warning('请上传参考视频')
  if (!formData.buyPoint) return message.warning('请填写商品卖点')

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
</script>

<template>
  <Container title="视频复刻" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload
          fromAsset
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

        <SectionTitle>参考视频</SectionTitle>
        <VideoUpload fromAsset v-model:videoList="formData.videoUrl" btnName="上传参考视频" multiple>
          <span class="mt-12px text-11px leading-17px text-muted">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </VideoUpload>

        <SectionTitle>商品卖点&要求</SectionTitle>
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

        <CustomModel
          v-model:personUrl="formData.personUrl"
          v-model:personUrlHs="formData.personUrlHs"
          :modelCode="formData.modelCode"
        />
      </div>
    </template>

    <template #settings>
      <!-- 外面的模型只能选自己上传的达人，本地模型不做限制 -->
      <SettingsBar
        v-model:data="formData"
        :model-options="videoModelOpsFor('hitVideoReplication')"
        :fields="[
          { field: 'region', label: '地区', options: regionOps },
          { field: 'language', label: '语言', options: languageOps },
        ]"
      />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample v-else title="视频复刻" :rightDesc="`导入热门参考视频，复刻运镜色调，低成本快速制作同款风格带货视频。`">
        <div class="flex gap-24px p-18px rounded-lg border border-solid border-line bg-white">
          <div class="relative flex items-end justify-between gap-12px w-1/2 text-center">
            <div>
              <video class="block w-[90%] mx-auto rounded-lg" controls :src="videoList[0]!.url"></video>
              <div class="mt-6px text-13px leading-20px text-ink-2">{{ videoList[0]!.title }}</div>
            </div>
            <img
              class="absolute top-0 left-[40%] w-48px [transform:rotateX(180deg)]"
              :src="VITE_OSS_ASSET_URL + 'e-commerce/video-clone-arrow.png'"
              alt=""
            />
            <div class="overflow-hidden">
              <video class="block w-full rounded-lg" controls :src="videoList[1]!.url"></video>
              <div class="mt-6px text-13px leading-20px text-ink-2">{{ videoList[1]!.title }}</div>
            </div>
          </div>

          <div class="relative flex items-end justify-between gap-12px w-1/2 text-center">
            <div>
              <video class="block w-[90%] mx-auto rounded-lg" controls :src="videoList[2]!.url"></video>
              <div class="mt-6px text-13px leading-20px text-ink-2">{{ videoList[2]!.title }}</div>
            </div>
            <img
              class="absolute top-0 left-[40%] w-48px [transform:rotateX(180deg)]"
              :src="VITE_OSS_ASSET_URL + 'e-commerce/video-clone-arrow.png'"
              alt=""
            />
            <div class="overflow-hidden">
              <video class="block w-full rounded-lg" controls :src="videoList[3]!.url"></video>
              <div class="mt-6px text-13px leading-20px text-ink-2">{{ videoList[3]!.title }}</div>
            </div>
          </div>
        </div>
      </Sample>
    </template>
  </Container>
</template>
