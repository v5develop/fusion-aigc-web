<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/childPages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { computed, provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import { regionOps, languageOps, aspectRatioVideoOps } from '@/views/e-commerce/childPages/constants.ts'
import { localDurationOps, videoModelOpsFor, seedanceDurationOps } from '../constants.ts'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import CustomModel from './CustomModel/index.vue'
import { checkboxOps, videoList } from './constants.ts'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'video-hot' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('video-hot')
provide('recordsData', taskList)
// 结果为视频：卡片按视频渲染，失败/超时占位也用视频文案
provide('recordMediaType', 'video')

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  region: '中国',
  language: '中文',
  aspectRatio: '9:16',
  duration: 16,
  buyPoint: '',
  modelCode: 'xiaoqi-video-1.0-lite',
  checked: [] as string[],
  personUrl: '',
  personUrlHs: '',
})
const isSeedanceModel = (code: string) => code.startsWith('doubao-seedance')
const currentDurationOps = computed(() =>
  isSeedanceModel(formData.modelCode) ? seedanceDurationOps : localDurationOps,
)

watch(
  () => formData.modelCode,
  (newCode) => {
    if (isSeedanceModel(newCode)) {
      formData.duration = 15
    } else if (formData.duration === 15) {
      formData.duration = 16
    }
  },
)

const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({ entryCode: 'hitVideo', modelCode: formData.modelCode }),
  [() => formData.modelCode],
)

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) return message.warning('请先上传产品图')
  if (!formData.checked.length) return message.warning('请选择视频类型')
  if (!formData.buyPoint) return message.warning('请填写商品卖点')

  const params = {
    type: 'hitVideo',
    imageUrls: formData.imageUrls,
    modelCode: formData.modelCode,
    params: {
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
      duration: formData.duration,
      buyPoint: formData.buyPoint,
      templateName: formData.checked[0],
      personUrl: formData.personUrl,
      personUrlHs: formData.personUrlHs,
    },
  }
  execute(params, loading)
}
</script>

<template>
  <Container title="爆款视频" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus" :submit-hint="`一条商品图生成一条 ${formData.duration} 秒短片`">
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
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/video-hot1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/video-hot2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/video-hot3.png',
          ]"
        />

        <CustomModel
          v-model:personUrl="formData.personUrl"
          v-model:personUrlHs="formData.personUrlHs"
          :modelCode="formData.modelCode"
        />

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

        <SectionTitle>视频类型</SectionTitle>
        <CheckboxGroup
          v-model="formData.checked"
          :list="checkboxOps"
          :customHandle="(value) => (formData.checked = [value])"
          :col="2"
          gap="8px"
          vertical
        />
      </div>
    </template>

    <template #settings>
      <!-- 外面的模型只能选自己上传的达人，本地模型不做限制 -->
      <SettingsBar
        v-model:data="formData"
        :model-options="videoModelOpsFor('hitVideo')"
        :fields="[
          { field: 'region', label: '地区', options: regionOps },
          { field: 'language', label: '语言', options: languageOps },
          { field: 'aspectRatio', label: '比例', options: aspectRatioVideoOps },
          { field: 'duration', label: '时长', options: currentDurationOps },
        ]"
      />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample
        v-else
        title="爆款视频"
        :rightDesc="`上传商品素材，一键生成短平快带货短片，适配全平台店铺短视频流量需求。`"
      >
        <div class="grid grid-cols-4 gap-12px p-12px rounded-lg border border-solid border-line bg-white">
          <div
            v-for="item in videoList"
            :key="item.title"
            class="flex flex-col gap-6px h-354px text-center whitespace-nowrap"
          >
            <video class="flex-1 min-h-0 w-full rounded-md bg-sunken" controls :src="item.url"></video>
            <div class="text-13px font-600 leading-20px text-ink">{{ item.title }}</div>
            <div class="text-12px leading-16px text-muted">{{ item.desc }}</div>
          </div>
        </div>
      </Sample>
    </template>
  </Container>
</template>
