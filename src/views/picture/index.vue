<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { creationHistory } from '@/api/methods.ts'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import type { ICreationSubmit } from '@/api/types.ts'
import { entryCodeOps, ratioOps } from './constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import { useInitCheckTaskStatus } from './hooks.ts'
import { useMessage } from 'naive-ui'
import * as utils from './utils.ts'
import SourceImageStack from '@/components/SourceImageStack/index.vue'
import downloadSingleIcon from '@/assets/icons/download-single.svg'
import regenerateIcon from '@/assets/icons/regenerate.svg'
import downloadAllIcon from '@/assets/icons/download-all.svg'

const message = useMessage()
const store = useHomeStore()
const { global_formData } = storeToRefs(store)
let _formData: any
if (global_formData.value.home) {
  const { entryCode = 'imageToImage', prompt = '', ratio = '1024,1024', images = [] } = global_formData.value.picture
  _formData = { entryCode, prompt, ratio, images }
  store.reset()
}

// 提交任务loading，跑图完成后再设为false
const loading = ref(false)
const formData = reactive(
  _formData ?? {
    entryCode: 'imageToImage',
    prompt: '',
    ratio: '1024,1024',
    images: [],
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

  if (formData.entryCode === 'imageToImage' && !formData.images.length) {
    message.warning('请上传图片')
    return
  }

  const wh = formData.ratio.split(',')
  const params: ICreationSubmit = {
    type: 'IMAGE',
    entryCode: formData.entryCode as ICreationSubmit['entryCode'],
    modelCode: 'local-image',
    params: {
      prompt: formData.prompt,
      width: +wh[0]!,
      height: +wh[1]!,
      num: formData.entryCode === 'textToImage' ? 4 : 1,
    },
    images: formData.images,
  }
  execute(params)

  // 发送后清空输入框及素材
  formData.prompt = ''
  formData.images = []
}

const getData = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (pagingData.loading) return
  pagingData.loading = true

  const params = {
    type: 'image' as const,
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
          // scrollToBottom() 源码内部已处理时序问题：
          // 通过 _undefinedSizes 计数器 + requestAnimationFrame 循环，
          // 直到所有 item 尺寸被 ResizeObserver 测量完成后才停止
          /*const doScroll = () => {
            if (dynamicScrollerRef.value) {
              dynamicScrollerRef.value.scrollToBottom()
              console.log(1111)
            } else {
              console.log(2222)
              // DynamicScroller 受 v-if="scrollerHeight > 0" 控制，
              // 若 API 返回较快、组件尚未挂载，则监听 scrollerHeight 就绪后再滚动
              const stop = watch(scrollerHeight, (h) => {
                if (h > 0) {
                  stop()
                  nextTick(() => dynamicScrollerRef.value?.scrollToBottom())
                }
              })
            }
          }*/
          nextTick(() => {
            dynamicScrollerRef.value?.scrollToBottom()
          })
        }
      }
    })
    .finally(() => (pagingData.loading = false))
}
getData(true)

const { execute } = useInitCheckTaskStatus({ type: 'picture', loading, getData, pagingData })

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
                  v-if="item.inputParams.entryCode === 'imageToImage'"
                  :images="item.inputParams.images ?? []"
                />
                <div class="message-group__prompt-wrapper">
                  <p class="message-group__prompt">
                    {{ item.inputParams.params.prompt }}
                    <span class="message-group__prompt-meta">{{ utils.getMetaData(item) }}</span>
                  </p>
                </div>
              </div>

              <!-- 图片网格 -->
              <div class="message-group__images">
                <div v-for="(jtem, j) in item.contents" :key="j" class="message-group__image-wrap">
                  <n-image
                    v-if="jtem.resultUrl"
                    :src="jtem.resultUrl"
                    alt=""
                    width="100%"
                    height="100%"
                    object-fit="cover"
                  />
                  <div v-if="jtem.resultUrl && (jtem.resolution || jtem.ratio)" class="image-meta-badge">
                    <span v-if="jtem.resolution">{{ jtem.resolution }}</span>
                    <span v-if="jtem.ratio">{{ jtem.ratio }}</span>
                  </div>
                  <div v-if="jtem.status === 1" class="pending">处理中...</div>
                  <div v-else-if="jtem.status === 3" class="pending">{{ jtem.errorMsg }}</div>
                  <button
                    v-if="jtem.resultUrl"
                    class="single-download-btn"
                    @click.stop="utils.downloadSingle(jtem.resultUrl)"
                  >
                    <img :src="downloadSingleIcon" width="24" height="24" alt="下载" />
                  </button>
                </div>
              </div>

              <!-- AI 声明 -->
              <p class="message-group__disclaimer">{{ item.disclaimer }}</p>

              <div style="color: #9e9e9e; margin-bottom: 8px;">以上内容由AI生成</div>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button v-show="!loading" class="action-btn" @click="generateAgain(item)">
                  <img :src="regenerateIcon" class="action-btn__icon" width="16" height="16" alt="再次生成" />
                  <span>再次生成</span>
                </button>
                <button v-show="utils.showDownloadBtn(item)" class="action-btn" @click="utils.download(item)">
                  <img :src="downloadAllIcon" class="action-btn__icon" width="16" height="16" alt="全部下载" />
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
        :imageLimit="3"
        :showImageUpload="formData.entryCode === 'imageToImage'"
      >
        <template #bottomSelect>
          <ChatInputSelect v-model:value="formData.entryCode" :options="entryCodeOps" />
          <ChatInputSelect v-model:value="formData.ratio" :options="ratioOps" style="margin-left: 10px" />
        </template>
      </ChatInputBox>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './index';
</style>
