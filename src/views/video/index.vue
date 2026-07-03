<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import { durationOps, modelOps, ratioOps, entryCodeOps, config } from './constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ICreationSubmit } from '@/api/types.ts'
import { creationHistory } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/picture/hooks.ts'
import { useMessage } from 'naive-ui'
import { download, showDownloadBtn } from '@/views/picture/utils.ts'
import { getMetaData } from './utils.ts'
import SourceImageStack from '@/components/SourceImageStack/index.vue'

const message = useMessage()
const store = useHomeStore()
const { global_formData } = storeToRefs(store)
let _formData: any
if (global_formData.value.home) {
  const {
    entryCode = 'imageToVideo',
    modelCode = 'local-video',
    prompt = '',
    ratio = '9:16',
    resolution = '720p',
    duration = 4,
    images = [],
    video = [],
  } = global_formData.value.video
  _formData = { entryCode, modelCode, prompt, ratio, resolution, duration, images, video }
  store.reset()
}

// 提交任务loading，跑图完成后再设为false
const loading = ref(false)
const formData = reactive(
  _formData ?? {
    entryCode: 'imageToVideo',
    modelCode: 'local-video',
    prompt: '',
    ratio: '9:16',
    resolution: '720p',
    duration: 4,
    images: [],
    video: [],
  },
)
const pagingData = reactive({
  page: 1,
  pageSize: 8,
  loading: false,
  hasMore: true,
})
const messages = ref<any[]>([])

const dynamicScrollerRef = useTemplateRef('dynamicScrollerRef')
const virtualListContainer = ref<HTMLElement>()
const scrollerHeight = ref(0)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (virtualListContainer.value) {
    resizeObserver = new ResizeObserver((entries) => {
      scrollerHeight.value = entries[0]?.contentRect.height ?? 0
    })
    resizeObserver.observe(virtualListContainer.value)
  }
})
onUnmounted(() => {
  resizeObserver?.disconnect()
})

const submit = () => {
  if (loading.value) return

  if (!formData.prompt) {
    message.warning('请输入提示词')
    return
  }

  if (['imageToVideo'].includes(formData.entryCode) && !formData.images.length) {
    message.warning('请上传图片')
    return
  }

  if (['firstLastFrames'].includes(formData.entryCode) && formData.images.length < 2) {
    message.warning('请上传2张图片')
    return
  }

  if (['actionTransfer'].includes(formData.entryCode)) {
    if (!formData.images.length) {
      message.warning('请上传图片')
      return
    }
    if (!formData.video.length) {
      message.warning('请上传视频')
      return
    }
  }

  loading.value = true
  const params: ICreationSubmit = {
    type: 'VIDEO',
    entryCode: formData.entryCode as ICreationSubmit['entryCode'],
    modelCode: formData.modelCode,
    params: {
      prompt: formData.prompt,
      resolution: formData.resolution,
      aspectRatio: formData.ratio,
      duration: formData.duration,
    },
    images: formData.images,
    video: ['actionTransfer'].includes(formData.entryCode) ? formData.video[0] : '',
  }
  execute(params)
}

const getData = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (pagingData.loading) return
  pagingData.loading = true

  const params = {
    type: 'video' as const,
    page: pagingData.page,
    pageSize: pagingData.pageSize,
  }
  return creationHistory(params)
    .then((res) => {
      if (res.code === 0) {
        pagingData.page++

        const records = res.data.list
        records.reverse()
        if (isReplace) messages.value = records
        else messages.value.unshift(...records)

        if (records.length < pagingData.pageSize) pagingData.hasMore = false

        // 类微信聊天：仅首次加载数据后自动滚动到底部
        if (isReplace) {
          nextTick(() => {
            dynamicScrollerRef.value?.scrollToBottom()
          })
        }
      }
    })
    .finally(() => (pagingData.loading = false))
}
getData(true)

const { execute } = useInitCheckTaskStatus({ type: 'video', loading, getData, pagingData })

const generateAgain = (item: any) => {
  if (loading.value) return

  execute(item.inputParams)
}
</script>

<template>
  <div class="picture">
    <div class="top_bg"></div>

    <div ref="virtualListContainer" class="virtual-list">
      <DynamicScroller
        ref="dynamicScrollerRef"
        v-if="scrollerHeight > 0"
        :items="messages"
        :min-item-size="300"
        key-field="createTime"
        :style="{ height: scrollerHeight + 'px' }"
        class="scroller"
        v-observer-scroll="{
          callbackTop: getData,
          distanceTop: 100,
        }"
      >
        <template #default="{ item, index, active }">
          <DynamicScrollerItem :item="item" :active="active" :data-index="index">
            <div class="message-group">
              <!-- 日期标题 -->
              <h2 class="message-group__date">{{ item.createTime }}</h2>

              <!-- 原图 + 提示词 -->
              <div class="message-group__header">
                <SourceImageStack
                  v-if="item.inputParams.entryCode === 'imageToVideo'"
                  :images="item.inputParams.images ?? []"
                />
                <div class="message-group__prompt-wrapper">
                  <p class="message-group__prompt">
                    {{ item.inputParams.params.prompt }}
                    <span class="message-group__prompt-meta">{{ getMetaData(item.inputParams) }}</span>
                  </p>
                </div>
              </div>

              <!-- 图片网格 -->
              <div class="message-group__images">
                <div v-for="(jtem, j) in item.contents" :key="j" class="message-group__image-wrap">
                  <video v-if="jtem.resultUrl" class="video" :src="jtem.resultUrl" controls />
                  <div v-if="jtem.status === 1" class="pending">处理中...</div>
                  <div v-else-if="jtem.status === 3" class="pending">{{ jtem.errorMsg }}</div>
                </div>
              </div>

              <!-- AI 声明 -->
              <p class="message-group__disclaimer">{{ item.disclaimer }}</p>

              <div style="color: #9e9e9e; margin-bottom: 8px">以上内容由AI生成</div>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button v-show="!loading" class="action-btn" @click="generateAgain(item)">
                  <svg class="action-btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <!-- 重新生成图标 -->
                    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.333" />
                    <path
                      d="M14 8a6 6 0 0 0-6-6C4.896 2 2.472 4.065 2.042 6.857"
                      stroke="currentColor"
                      stroke-width="1.333"
                      stroke-linecap="round"
                    />
                    <path
                      d="M5.333 8.667 2.042 6.857 2.809 4.376"
                      stroke="currentColor"
                      stroke-width="1.333"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M9.333 5.333v5.334M12 5.333v5.334"
                      stroke="currentColor"
                      stroke-width="1.333"
                      stroke-linecap="round"
                    />
                  </svg>
                  <span>再次生成</span>
                </button>
                <button v-show="showDownloadBtn(item)" class="action-btn" @click="download(item)">
                  <svg class="action-btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <!-- 下载图标 -->
                    <path
                      d="M8 1.333v9.334M4.667 8 8 11.333 11.333 8"
                      stroke="currentColor"
                      stroke-width="1.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path d="M2 12.667V14h12v-1.333" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  </svg>
                  <span>全部下载</span>
                </button>
              </div>
            </div>
          </DynamicScrollerItem>
        </template>
      </DynamicScroller>
    </div>

    <div class="input-box" :class="!messages.length ? 'input-box-center' : ''">
      <h1 v-if="!messages.length" class="h1">和我聊聊， 你想要什么设计～</h1>

      <ChatInputBox
        v-model:formData="formData"
        :submit="submit"
        :btnLoading="loading"
        :showImageUpload="formData.entryCode !== 'textToVideo'"
        :showVideoUpload="formData.entryCode === 'actionTransfer'"
        v-bind="config[formData.entryCode]"
      >
        <template #bottomSelect>
          <div class="select-cont">
            <ChatInputSelect v-model:value="formData.entryCode" :options="entryCodeOps" />
            <ChatInputSelect
              v-model:value="formData.modelCode"
              :options="entryCodeOps.find((item) => item.value === formData.entryCode)?.modelOps!"
            />
            <ChatInputSelect v-model:value="formData.ratio" :options="ratioOps" />
            <ChatInputSelect
              v-model:value="formData.resolution"
              :options="modelOps.find((item) => item.value === formData.modelCode)?.resolutionOps!"
            />
            <ChatInputSelect v-model:value="formData.duration" :options="durationOps" />
          </div>
        </template>
      </ChatInputBox>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '../picture/index.less';
.select-cont {
  width: 250px;
  display: flex;
  gap: 12px;
}
</style>
