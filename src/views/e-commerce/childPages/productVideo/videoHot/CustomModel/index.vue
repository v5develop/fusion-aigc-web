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
import {
  ageOps,
  appearanceOps,
  bodyOps,
  genderOps,
  localModelValue,
} from '@/views/e-commerce/childPages/productVideo/constants.ts'
import Textarea from '@/components/Textarea/index.vue'
import Tab from '@/components/Tab/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import ImagePopover from '@/components/ImagePopover/index.vue'
import CustomModelNotice from '@/components/CustomModelNotice/index.vue'
import { modelNoticeObj } from '@/components/CustomModelNotice/useData.ts'
import { useMessage } from 'naive-ui'
import { un } from 'vue-router/dist/useApi-D6ckOsFy'

const { modelCode } = defineProps<{
  modelCode: string
}>()
const personUrl = defineModel<string>('personUrl', { required: true })
const personUrlHs = defineModel<string | undefined>('personUrlHs', { required: true })

watch(personUrl, () => {
  if (modelCode !== localModelValue) {
    const item = modelData.images.find((item) => item.coverUrl === personUrl.value)
    let properties = item?.assets?.[0]?.items?.[0]?.properties
    if (properties) {
      properties = JSON.parse(properties)
      personUrlHs.value = properties.doubaoAddress
      return
    }
  }

  personUrlHs.value = undefined
})

const message = useMessage()
const modelPollingType = computed(() => {
  // 本地模型
  if (modelCode == localModelValue) return 'customizedModel'

  // seedance模型
  return 'realPersonModel'
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
const modelTabValue = ref<'customModel' | 'myModel'>('customModel')
const btnLoading = ref(false) // 定制达人loading
const faceLoading = ref(false) // 人脸验证loading
const pagingData = reactive({
  page: 1,
  size: 15,
  loadMore: true,
  loading: false,
})
const uploadImage = ref<string[]>([])
const faceAuthDialog = reactive({
  show: false,
  qrCode: '',
  errorMsg: '',
})

// 轮询达人生成
const { start } = usePolling((taskId) => pollingSingleTask(taskId!), 3000, {
  onError() {
    btnLoading.value = false
    localStorage.removeItem('modelTaskId')
  },
  autoStop(res) {
    if (res.code === 0) {
      if (res.data.status === 2) {
        message.success('达人生成成功')
        localStorage.removeItem('modelTaskId')
        btnLoading.value = false
        modelTabValue.value = 'myModel'
        resetData()
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
  start(localModelTaskId)
}

// 生成达人
const generateModel = () => {
  if (btnLoading.value) return

  if (modelCode !== localModelValue) {
    message.warning('只有本地模型可定制模特')
    return
  }

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
        start(modelTaskId)
      }
    })
    .catch(() => {
      btnLoading.value = false
    })
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
    if ([0, 1].includes(data.status)) return false

    if (data.status === 3) {
      faceAuthDialog.errorMsg = data.errorMsg
    } else {
      message.success('认证成功')
      faceAuthDialog.show = false
      faceAuthDialog.qrCode = ''
      resetData()
    }

    faceLoading.value = false
    return true
  },
})
const customResultHandle = (urls: string[]) => {
  uploadImage.value = urls
  faceRecognition({ modelCode, imageUrls: urls }).then((res) => {
    if (res.code === 0) {
      if (modelCode === localModelValue) {
        resetData()
      } else {
        faceLoading.value = true
        startFaceValidate(res.data.taskId)
        faceAuthDialog.show = true
        faceAuthDialog.qrCode = res.data.h5Link
      }
    }
  })
}
const windowOpen = () => window.open(faceAuthDialog.qrCode, '_blank')

const customBeforeUpload = () => {
  if (!modelNoticeObj.value.customModelNoticeConfirmed) {
    modelNoticeObj.value.show = true
    return false
  }

  if (faceLoading.value) {
    message.warning('等待人脸认证结果中，请稍等...')
    return false
  }

  return true
}

watch([switchValue, modelPollingType], () => {
  personUrl.value = ''
  personUrlHs.value = ''
})
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
        { label: '我的达人', value: 'myModel' },
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

    <div v-else class="my-model" v-observer-scroll="{ callback: getModelData }">
      <div style="height: 86px">
        <ImageUpload
          v-model:imgList="uploadImage"
          type="card"
          :customResultHandle="customResultHandle"
          :customBeforeUpload="customBeforeUpload"
        />
      </div>

      <ImagePopover v-model="personUrl" :imgList="modelData.images.map((item) => item.coverUrl)" style="height: 86px" />
    </div>
  </div>

  <n-modal
    v-model:show="faceAuthDialog.show"
    preset="dialog"
    title="人脸认证"
    :style="{ width: '600px' }"
    :on-after-leave="
      () => {
        faceAuthDialog.qrCode = ''
        faceAuthDialog.errorMsg = ''
      }
    "
  >
    <div class="face-auth-cont">
      <div>
        <span>电脑端认证：电脑上有摄像头可以点击此按钮，在电脑上进行人脸认证</span>
        <div class="auth-btn" @click="windowOpen">开始认证</div>
      </div>

      <div class="split-line"></div>

      <div style="display: flex; flex-direction: column; align-items: center">
        <span>手机端认证：手机扫描此二维码</span>
        <n-qr-code :size="300" :value="faceAuthDialog.qrCode" />
      </div>

      <div style="color: #f30000; margin-top: 40px; text-align: center">{{ faceAuthDialog.errorMsg }}</div>
    </div>
  </n-modal>

  <CustomModelNotice v-model:data="modelNoticeObj" />
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

.face-auth-cont {
  padding: 30px 0 10px;
  .auth-btn {
    width: 80px;
    height: 32px;
    line-height: 32px;
    text-align: center;
    margin-top: 10px;
    border-radius: 5px;
    background-color: var(--main-color);
    color: #fff;
    cursor: pointer;
    &:hover {
      opacity: 0.8;
    }
  }
  > .split-line {
    height: 1px;
    margin: 30px 0;
    background-color: #dcdcdc;
  }
}
</style>
