<script setup lang="ts">
import { provide, reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { poseOps, shoeStyleOps, genderOps } from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { useMessage } from 'naive-ui'
import { publicTemplate, quotePreview } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('try-shoe')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  personUrl: '', // 鞋库
  uploadPersonUrl: [], // 上传的鞋
})
const { shoeFilterData, pagingData, tabValue, shoeList, scrollCallBack } = useShoeList()
const { integral } = useIntegral()

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }
  if (tabValue.value === 'shoeLib' && !formData.personUrl) {
    return message.warning('请选择鞋子')
  }
  if (tabValue.value === 'uploadShoe' && !formData.uploadPersonUrl.length) {
    return message.warning('请上传鞋子')
  }

  const params = {
    type: 'shoeSwapping',
    imageUrls: formData.imageUrls,
    params: {
      personUrl: tabValue.value === 'shoeLib' ? formData.personUrl : formData.uploadPersonUrl[0],
    },
  }
  execute(params, loading)
}

function useShoeList() {
  const shoeFilterData = reactive({
    gender: null,
    pose: null,
    shoeStyle: null,
  })
  const pagingData = reactive({
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
  })
  // shoeLib:鞋库  uploadShoe:上传的鞋
  const tabValue = ref<'shoeLib' | 'uploadShoe'>('shoeLib')
  const shoeList = ref<any[]>([])

  // 鞋库tab列表
  const publicTemplateApi = () => {
    if (pagingData.loading) return
    const params = {
      moduleCode: 'shoeSwapping',
      slotCode: 'shoeTemplate',
      filters: {
        gender: [shoeFilterData.gender],
        pose: [shoeFilterData.pose],
        shoeStyle: [shoeFilterData.shoeStyle],
      },
      ...pagingData,
    } as const
    pagingData.loading = true
    publicTemplate(params)
      .then((res) => {
        if (res.code === 0) {
          pagingData.page++
          shoeList.value.push(...res.data.list)
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

  watch(shoeFilterData, () => {
    pagingData.page = 1
    pagingData.hasMore = true
    shoeList.value = []
    publicTemplateApi()
  })

  return { shoeFilterData, pagingData, tabValue, shoeList, scrollCallBack }
}
function useIntegral() {
  const integral = ref(0)

  const quotePreviewApi = () => {
    const params = {
      entryCode: 'shoeSwapping',
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
  <Container class="commerce" title="AI试鞋" :submit="submit" :loading="loading" :integral="integral">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          btnName="上传产品图"
          :limitNumber="1"
          :topRightTips="false"
          :tryImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe3.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe4.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe5.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe6.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/try/try-shoe7.png',
          ]"
        >
          <span style="color: #9e9e9e; margin-top: 15px; text-align: center"
            >建议上传白底、无杂物的单独鞋子素材，复杂背景会影响试鞋合成效果</span
          >
          <span style="color: #9e9e9e; margin-top: 4px">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>

        <div class="module-title">试鞋模版</div>
        <div v-loading="pagingData.loading" style="position: relative">
          <Tab
            v-model:value="tabValue"
            :tabs="[
              { label: '模特库', value: 'shoeLib' },
              { label: '上传模特', value: 'uploadShoe' },
            ]"
          />
          <div v-show="tabValue === 'shoeLib'">
            <SelectGroup
              v-model:data="shoeFilterData"
              :list="[
                { field: 'gender', options: genderOps, placeholder: '性别' },
                { field: 'pose', options: poseOps, placeholder: '姿势' },
                { field: 'shoeStyle', options: shoeStyleOps, placeholder: '款式' },
              ]"
              :col="3"
              style="margin-top: 12px"
              clearable
            />
            <GridImage
              style="margin-top: 8px"
              v-model:imageUrl="formData.personUrl"
              :imgList="shoeList.map((item) => item.url)"
              :scrollCallBack="scrollCallBack"
            />
          </div>

          <div v-show="tabValue === 'uploadShoe'" style="margin-top: 8px">
            <ImageUpload
              v-model:imgList="formData.uploadPersonUrl"
              btnName="上传模特图"
              :limitNumber="1"
              :topRightTips="false"
            />
          </div>
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
        title="AI试鞋"
        :rightDesc="`上传鞋子单品图，自动生成真人上脚实拍图，省去线下实景拍摄流程。`"
        image="e-commerce/try-shoe.webp"
      >
      </Sample>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
    > .switch-cont {
      height: 52px;
      border-radius: 12px;
      border: 1px solid #f0f0f0;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    > .textarea-cont {
      margin: 12px 0;
      > .label {
        line-height: 20px;
        color: #9e9e9e;
        margin-bottom: 12px;
      }
    }
  }

  .sample-cont {
  }
}
</style>
