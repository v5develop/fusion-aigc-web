<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  assetAll,
  ecommerceSubmit,
  pollingSingleTask,
  faceRecognition,
  faceRecognitionStatusQuery,
} from '@/api/methods.ts'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { ageOps, appearanceOps, bodyOps, genderOps } from '@/views/e-commerce/childPages/productVideo/constants.ts'
import Textarea from '@/components/Textarea/index.vue'
import Tab from '@/components/Tab/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import ImagePopover from '@/components/ImagePopover/index.vue'

const { modelName } = defineProps<{
  modelName: string
}>()
const personUrl = defineModel<string>('personUrl', { required: true })

const modelPollingType = computed(() => {
  if (['seedance2.0', 'seedance2.0-fast'].includes(modelName)) return 'realpersonmodel'
  // 本地模型
  return 'customizedmodel'
})

const switchValue = ref(false)
const modelData = reactive({
  images: [] as any[],
  sex: null,
  age: null,
  appearance: null,
  body: null,
  userInput: '',
})
const modelTabValue = ref<'customModel' | 'myModel'>('myModel')
const btnLoading = ref(false)
const pagingData = reactive({
  page: 1,
  size: 15,
  loadMore: true,
  loading: false,
})
const uploadImage = ref<string[]>([])

// 轮询达人生成
const { start: startModelPolling } = usePolling((taskId) => pollingSingleTask(taskId!), 3000, {
  onError() {
    btnLoading.value = false
    localStorage.removeItem('modelTaskId')
  },
  autoStop(res) {
    if (res.code === 0) {
      if (res.data.status === 2) {
        localStorage.removeItem('modelTaskId')
        getModelData()
        return true
      }
    }
    return false
  },
})

// 初始化检查本地是否有达人taskId，有则轮询生成结果
const localModelTaskId = localStorage.getItem('modelTaskId')
if (localModelTaskId) {
  btnLoading.value = true
  startModelPolling(localModelTaskId)
}

// 生成达人
const generateModel = () => {
  if (btnLoading.value) return

  const params = {
    type: 'aiExpert',
    params: modelData,
  }
  btnLoading.value = true
  ecommerceSubmit(params)
    .then((res) => {
      if (res.code === 0) {
        // 开始轮询，生成完清除localStorage的modelTaskId
        const modelTaskId = res.data.taskId
        localStorage.setItem('modelTaskId', modelTaskId)
        startModelPolling(modelTaskId)
      }
    })
    .finally(() => (btnLoading.value = false))
}
// 获取达人列表
const getModelData = () => {
  if (pagingData.loading || !pagingData.loadMore) return
  pagingData.loading = true
  assetAll({ type: modelPollingType.value, ...pagingData })
    .then((res) => {
      if (res.code === 0) {
        const data = res.data
        pagingData.page += 1
        modelData.images.push(...data.records)
        /*modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })
        modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })
        modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })
        modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })
        modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })
        modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })
        modelData.images.push({
          items: [
            {
              imageUrl:
                'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png',
            },
          ],
        })*/
        if (data.records.length < pagingData.size) {
          pagingData.loadMore = false
        }
      }
    })
    .finally(() => (pagingData.loading = false))
}
const resetData = () => {
  pagingData.page = 1
  modelData.images = []
  pagingData.loadMore = true
  getModelData()
}

watch(modelPollingType, resetData, { immediate: true })

// 轮询人脸验证结果
const { start: startFaceValidate } = usePolling((taskId) => faceRecognitionStatusQuery(taskId!), 3000, {
  autoStop(res) {
    const { data } = res
    // 0待处理  1处理中  2已完成  3失败
    if ([0, 1].includes(data.status)) {
      return false
    }

    resetData()
    return true
  },
})
const customResultHandle = (urls: string[]) => {
  uploadImage.value = urls
  faceRecognition({ modelName, imageUrls: urls }).then((res) => {
    if (res.code === 0) {
      if (modelName === 'local') {
        resetData()
      } else {
        startFaceValidate(res.data.taskId)
        window.open(res.data.h5Link, '_blank')
      }
    }
  })
}
</script>

<template>
  <div class="module-title">
    定制专属模特
    <n-switch class="switch-pos" v-model:value="switchValue" />
  </div>
  <div class="custom-model-cont" v-show="switchValue">
    <Tab
      v-model:value="modelTabValue"
      :tabs="[
        { label: '定制达人', value: 'customModel' },
        { label: '上传我的达人', value: 'myModel' },
      ]"
      style="margin-bottom: 12px"
    />
    <div v-if="modelTabValue === 'customModel'" class="custom-model">
      <SelectGroup
        v-model:data="modelData"
        :list="[
          {
            field: 'sex',
            options: genderOps,
            placeholder: '性别',
          },
          {
            field: 'age',
            options: ageOps,
            placeholder: '年龄段',
          },
          {
            field: 'appearance',
            options: appearanceOps,
            placeholder: '外观特征',
          },
          {
            field: 'body',
            options: bodyOps,
            placeholder: '体型',
          },
        ]"
        gap="4px"
      />
      <div class="textarea-area">
        <div class="title">外貌细节补充</div>
        <Textarea v-model:value="modelData.userInput" placeholder="例如：白皙肤色、长头发、微笑唇等" />
      </div>
      <div v-loading="btnLoading" class="generate-btn" @click="generateModel">
        <i class="icon-ic_ds_ljsc"></i>
        <span>生成我的达人</span>
      </div>
    </div>

    <div
      v-else
      class="my-model"
      v-observer-scroll="{
        callback() {
          if (pagingData.loadMore) getModelData()
        },
      }"
    >
      <div style="height: 86px">
        <ImageUpload v-model:imgList="uploadImage" type="card" :customResultHandle="customResultHandle" />
      </div>

      <ImagePopover
        v-model="personUrl"
        :imgList="modelData.images.map((item) => item.items[0].imageUrl)"
        style="height: 86px"
      />
    </div>
  </div>
</template>

<style scoped lang="less">
@import '../../../common.less';

.switch-pos {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
}
.custom-model-cont {
  > .custom-model {
    > .textarea-area {
      font-size: 0;
      > .title {
        font-size: 14px;
        line-height: 20px;
        color: #9e9e9e;
        margin: 12px 0 8px;
      }
    }
    > .generate-btn {
      height: 32px;
      margin: 12px 0;
      border-radius: 8px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      background: #f5f6f8;
      cursor: pointer;
      position: relative;
      &:hover {
        background: #ebecef;
      }
    }
  }

  > .my-model {
    max-height: 500px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    overflow: auto;
    .active {
      border: 1px solid var(--main-color);
    }
  }
}
</style>
