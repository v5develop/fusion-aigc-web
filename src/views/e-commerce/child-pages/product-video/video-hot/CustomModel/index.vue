<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import {
  assetAll,
  ecommerceSubmit,
  pollingSingleTask,
  faceRecognition,
  faceRecognitionStatusQuery,
} from '@/api/methods.ts'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { useUserInfoStore } from '@/stores/user-info.ts'
import {
  ageOps,
  appearanceOps,
  bodyOps,
  genderOps,
  localModelValue,
} from '@/views/e-commerce/child-pages/product-video/constants.ts'
import SectionTitle from '@/views/e-commerce/child-pages/components/SectionTitle/index.vue'
import Tab from '@/components/Tab/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import ImagePopover from '@/components/ImagePopover/index.vue'
import CustomModelNotice from '@/components/CustomModelNotice/index.vue'
import { modelNoticeObj } from '@/components/CustomModelNotice/useData.ts'
import { registerOverlayCloser } from '@/utils/overlay-guard'
import { useMessage } from 'naive-ui'

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
const { updateUserInfo } = useUserInfoStore()
const modelPollingType = computed(() => {
  // 本地模型
  if (modelCode == localModelValue) return 'customizedModel'

  // seedance模型
  return 'realPersonModel'
})

const switchValue = ref(false)
const modelData = reactive({
  images: [] as any[],
  gender: null,
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
  stopOnError: true, // 出错即停：onError 里会复位按钮并清掉任务 id
  onError() {
    btnLoading.value = false
    localStorage.removeItem('modelTaskId')
    updateUserInfo()
  },
  autoStop(res) {
    if (res.code === 0) {
      // status: 2=成功 3=失败 4=取消，终态都要刷新积分（失败/取消可能退费）
      if (res.data.status === 2) {
        message.success('达人生成成功')
        localStorage.removeItem('modelTaskId')
        btnLoading.value = false
        modelTabValue.value = 'myModel'
        resetData()
        updateUserInfo()
        return true
      }
      if (res.data.status === 3 || res.data.status === 4) {
        message.error(res.data.statusView?.message || res.data.errorMsg || '达人生成失败')
        localStorage.removeItem('modelTaskId')
        btnLoading.value = false
        updateUserInfo()
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
    message.warning('只有XiaoQi-Video-1.0-Lite模型可定制模特')
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
        // 提交即扣费，立即刷新积分余额
        updateUserInfo()
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
  stopOnError: true, // 保持原行为：出错即停
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
    flushQueuedVerify()
    return true
  },
})
/*
 * ImageUpload 的 customResultHandle：一批上传结束调一次；失败格「重试」成功后会再调一次、只带重试成功的地址。
 * 所以这里按「追加」处理，并记下已送验的地址——重试不会让已验证过的图再走一遍人脸认证，只验新地址。
 * 认证进行中（扫码等待）又有重试成功的图时先排队，等这轮认证结束再送验，避免两个认证弹窗互相覆盖。
 */
const verifiedUrls = new Set<string>()
let queuedVerify: string[] = []
const flushQueuedVerify = () => {
  if (!queuedVerify.length) return
  const urls = queuedVerify
  queuedVerify = []
  customResultHandle(urls)
}
const customResultHandle = (urls: string[]) => {
  const fresh = urls.filter((u) => !verifiedUrls.has(u))
  if (!fresh.length) return
  if (faceLoading.value) {
    queuedVerify.push(...fresh.filter((u) => !queuedVerify.includes(u)))
    return
  }
  fresh.forEach((u) => verifiedUrls.add(u))
  uploadImage.value = [...uploadImage.value.filter((u) => !fresh.includes(u)), ...fresh]
  faceRecognition({ modelCode, imageUrls: fresh })
    .then((res) => {
      if (res.code === 0) {
        if (modelCode === localModelValue) {
          resetData()
        } else {
          faceLoading.value = true
          startFaceValidate(res.data.taskId)
          faceAuthDialog.show = true
          faceAuthDialog.qrCode = res.data.h5Link
        }
      } else {
        fresh.forEach((u) => verifiedUrls.delete(u))
      }
    })
    .catch(() => fresh.forEach((u) => verifiedUrls.delete(u)))
}
const windowOpen = () => window.open(faceAuthDialog.qrCode, '_blank')

// 人脸认证弹窗和使用须知弹窗都是 Teleport 到 body 的，不在 keep-alive 的缓存子树里。
// 标签切走后本组件不卸载，遮罩会一直盖在新标签上并吃掉全部点击，只能刷新页面才能恢复。
// 关闭时机和等待过渡的理由见 utils/overlayGuard.ts
onUnmounted(
  registerOverlayCloser(async () => {
    if (!faceAuthDialog.show && !modelNoticeObj.value.show) return
    faceAuthDialog.show = false
    modelNoticeObj.value.show = false
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 350))
  }),
)

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
  <SectionTitle>
    定制专属模特
    <!-- 液态开关 sm 档（原型 SxLiquidSwitch）：34×20、滑块 14；开启为藤紫渐变 -->
    <button
      type="button"
      role="switch"
      :aria-checked="switchValue"
      aria-label="定制专属模特"
      class="relative flex-none w-34px h-20px box-border p-0 rounded-pill border border-solid cursor-pointer transition-[background,border-color] duration-mid ease-sx motion-reduce:transition-none sx-focus"
      :class="
        switchValue
          ? 'border-violet-border sx-grad-primary'
          : 'border-control sx-grad-sunk shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]'
      "
      @click="switchValue = !switchValue"
    >
      <span
        class="absolute top-2px w-14px h-14px rounded-full bg-white shadow-[0_1px_3px_rgba(31,35,41,0.2)] transition-[left] duration-mid ease-sx motion-reduce:transition-none"
        :class="switchValue ? 'left-16px' : 'left-2px'"
        aria-hidden="true"
      />
    </button>
  </SectionTitle>

  <div v-show="switchValue">
    <Tab
      v-model:value="modelTabValue"
      :tabs="[
        { label: '定制达人', value: 'customModel' },
        { label: '上传我的达人', value: 'myModel' },
      ]"
      class="mb-8px"
    />
    <div v-if="modelTabValue === 'customModel'">
      <SelectGroup
        v-model:data="modelData"
        :list="[
          {
            field: 'gender',
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
      <label class="block">
        <span class="block mt-12px mb-6px sx-label leading-16px">外貌细节补充</span>
        <textarea
          v-model="modelData.userInput"
          class="sx-input block w-full !h-108px box-border py-8px leading-20px resize-none"
          placeholder="例如：白皙肤色、长头发、微笑唇等"
        ></textarea>
      </label>
      <button
        v-loading="btnLoading"
        type="button"
        class="sx-btn relative w-full my-12px"
        :aria-busy="btnLoading || undefined"
        @click="generateModel"
      >
        <i class="icon-ic_ds_ljsc" aria-hidden="true"></i>
        <span>生成我的达人</span>
      </button>
    </div>

    <!-- 卡片 116×155、间距 10：三列排满左栏内容区 -->
    <div
      v-else
      class="grid grid-cols-3 gap-10px max-h-500px overflow-auto [scrollbar-width:thin]"
      v-observer-scroll="{ callback: getModelData }"
    >
      <div class="h-155px">
        <ImageUpload
          fromAsset
          v-model:imgList="uploadImage"
          type="card"
          btnName="上传达人"
          :customResultHandle="customResultHandle"
          :customBeforeUpload="customBeforeUpload"
        />
      </div>

      <ImagePopover
        v-model="personUrl"
        :imgList="modelData.images.map((item) => item.coverUrl)"
        :style="{ height: '155px', borderRadius: '8px' }"
      />
    </div>
  </div>

  <n-modal
    v-model:show="faceAuthDialog.show"
    preset="dialog"
    :style="{ width: '600px', borderRadius: '12px' }"
    :on-after-leave="
      () => {
        faceAuthDialog.qrCode = ''
        faceAuthDialog.errorMsg = ''
      }
    "
  >
    <!-- 对话框（规范 §3）：r12、标题 16/600 -->
    <template #header>
      <span class="text-16px font-600 leading-22px text-ink">人脸认证</span>
    </template>
    <div class="pt-18px pb-12px text-13px leading-20px text-ink-2">
      <div>
        <span>电脑端认证：电脑上有摄像头可以点击此按钮，在电脑上进行人脸认证</span>
        <button type="button" class="sx-btn-primary block mt-12px" @click="windowOpen">开始认证</button>
      </div>

      <div class="h-1px my-24px bg-line"></div>

      <div class="flex flex-col items-center">
        <span>手机端认证：手机扫描此二维码</span>
        <n-qr-code :size="300" :value="faceAuthDialog.qrCode" />
      </div>

      <div class="mt-24px text-center text-danger" role="alert">{{ faceAuthDialog.errorMsg }}</div>
    </div>
  </n-modal>

  <CustomModelNotice v-model:data="modelNoticeObj" />
</template>
