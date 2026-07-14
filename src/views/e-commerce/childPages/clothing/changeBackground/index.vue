<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { publicTemplate, quotePreview } from '@/api/methods.ts'
import { useMessage } from 'naive-ui'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ChangeBackgroundParams } from '@/views/home/ChatInputBox/targetParams'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('clothing-remove-wrinkle')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  bgImageUrl: '',
  description: '',
  refImageUrl: [],
})

const store = useHomeStore()
const { global_formData } = storeToRefs(store)
if (global_formData.value.home) {
  const p = global_formData.value.ecommerce.params as ChangeBackgroundParams
  if (p.imageUrls?.length) (formData as any).imageUrls = p.imageUrls
  if (p.bgImageUrl) formData.bgImageUrl = p.bgImageUrl
  if (p.description) formData.description = p.description
  store.reset()
}

const { bgTabValue, bgList, bgScrollCallBack } = useBg()
const { integral } = useIntegral()

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传服装图片')
  }

  if (bgTabValue.value === 'recommend' && !formData.bgImageUrl) {
    return message.warning('请选择背景图')
  }
  if (bgTabValue.value === 'custom' && !formData.refImageUrl.length) {
    return message.warning('请上传参考背景图')
  }
  if (bgTabValue.value === 'custom' && !formData.description) {
    return message.warning('请填写背景描述')
  }

  const params = {
    type: 'backgroundSwitching',
    imageUrls: formData.imageUrls,
    params: {
      bgImageUrl: bgTabValue.value === 'recommend' ? formData.bgImageUrl : '',
      description: formData.description,
      refImageUrl: formData.refImageUrl[0],
    },
  }
  execute(params, loading)
}

function useBg() {
  const bgPagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  // recommend:推荐  custom:自定义
  const bgTabValue = ref<'recommend' | 'custom'>('recommend')
  const bgList = ref<any[]>([])

  // 场景列表
  const publicTemplateApi = () => {
    if (bgPagingData.loading) return
    const params = {
      moduleCode: 'backgroundSwitching',
      slotCode: 'background',
      ...bgPagingData,
    } as const
    bgPagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          bgPagingData.page++
          bgList.value.push(...res.data.list)
          if (res.data.list.length < bgPagingData.pageSize) {
            bgPagingData.hasMore = false
          }
        }
      })
      .finally(() => (bgPagingData.loading = false))
  }
  publicTemplateApi()

  const bgScrollCallBack = () => {
    if (bgPagingData.hasMore) publicTemplateApi()
  }

  return { bgTabValue, bgList, bgScrollCallBack }
}
function useIntegral() {
  const integral = ref(0)

  const quotePreviewApi = () => {
    const params = {
      entryCode: 'backgroundSwitching',
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
  <Container class="commerce" title="人像换背景" :submit="submit" :loading="loading" :integral="integral">
    <template #default>
      <div class="default-content">
        <div class="module-title">人像图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          btnName="上传人像"
          :limitNumber="1"
          :topRightTips="false"
          :tryImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background3.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background4.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background5.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background6.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/change-background7.png',
          ]"
        >
          <span style="color: #9e9e9e; margin-top: 15px">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <div class="module-title">选择背景</div>
        <Tab
          v-model:value="bgTabValue"
          :tabs="[
            { label: '推荐', value: 'recommend' },
            { label: '自定义', value: 'custom' },
          ]"
        />
        <div v-show="bgTabValue === 'recommend'">
          <!--          <SelectGroup
            v-model:data="formData"
            :list="[{ field: 'platform', options: platformOptions }]"
            :col="1"
            style="margin-top: 12px"
          />-->
          <GridImage
            style="margin-top: 8px"
            v-model:imageUrl="formData.bgImageUrl"
            :imgList="bgList.map((item) => item.url)"
            :scrollCallBack="bgScrollCallBack"
            :showColorPicker="false"
          />
        </div>

        <div v-show="bgTabValue === 'custom'">
          <div class="module-title">添加描述</div>
          <PromptAssist
            v-model:value="formData.description"
            :params="{
              prompt: 'ai_writing_background',
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
            placeholder="参考公式：主体对象+场景+元素/光影+风格/氛围/画质"
          />

          <div class="module-title">背景风格参考</div>
          <ImageUpload
            v-model:imgList="formData.refImageUrl"
            btnName="上传参考背景"
            :limitNumber="1"
            :topRightTips="false"
          >
            <span style="color: #9e9e9e; margin-top: 15px">JPG/JPEG/PNG/WEBP 10M以内</span>
          </ImageUpload>
        </div>
      </div>
    </template>

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="人像换背景"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
      >
        <video class="video" controls :src="VITE_OSS_ASSET_URL + 'e-commerce/video/change-background.mp4'"></video>
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
