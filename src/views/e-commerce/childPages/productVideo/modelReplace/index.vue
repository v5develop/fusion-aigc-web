<script setup lang="ts">
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import VideoUpload, { type IVideoItem } from '@/components/VideoUpload/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { genderOps, ageOps, skinOps } from '../../constants.ts'
import Tab from '@/components/Tab/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import { publicTemplate } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'model-replace' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('model-replace')
provide('recordsData', taskList)
// 结果为视频：卡片按视频渲染，失败/超时占位也用视频文案
provide('recordMediaType', 'video')

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  personUrl: '', // 模特库
  uploadPersonUrl: [], // 上传的模特
  videoUrl: [] as IVideoItem[],
  target: 'face', // face:换脸  head:换头  person:换全身
})
const { modelFilterData, pagingData, tabValue, modelList, scrollCallBack } = useModelList()
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(() => ({ entryCode: 'personReplacement' }), [])

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
</script>

<template>
  <Container title="模特替换" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
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
          <div class="text-14px font-600 leading-20px text-ink">上传单人正面站立图，一键生成视频</div>
          <div class="mt-6px text-11px leading-17px text-muted">
            拍摄：必须露出人脸，只有一人不能多人，正面站立，露出完整人体，背景简单更佳。
          </div>
        </div>
      </n-popover>
    </template>
    <template #default>
      <div>
        <SectionTitle>参考视频</SectionTitle>
        <p class="-mt-4px mb-8px text-11px leading-17px text-muted">
          上传参考样片，AI 精准复刻镜头运镜、色调与画面整体风格
        </p>
        <VideoUpload fromAsset v-model:videoList="formData.videoUrl" btnName="上传参考视频">
          <span class="mt-12px text-11px leading-17px text-muted">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
        </VideoUpload>

        <div v-loading="pagingData.loading" class="relative">
          <SectionTitle>选择模特</SectionTitle>
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
              class="mt-8px"
              clearable
              multiple
            />
            <GridImage
              class="mt-8px"
              v-model:imageUrl="formData.personUrl"
              :imgList="modelList.map((item) => item.url)"
              :scrollCallBack="scrollCallBack"
            />
          </div>

          <div v-show="tabValue === 'uploadModel'" class="mt-8px">
            <ImageUpload
              fromAsset
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

        <SectionTitle>替换区域</SectionTitle>
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
      <RecordList v-if="showList" />
      <Sample v-else title="模特替换" :rightDesc="`锁定画面场景灯光不变，自由更换出镜模特，快速更新商品人像展示素材。`">
        <video
          class="block w-full mx-auto rounded-lg"
          controls
          :src="VITE_OSS_ASSET_URL + 'e-commerce/video/model-replace.mp4'"
        ></video>
      </Sample>
    </template>
  </Container>
</template>
