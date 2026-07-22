<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { creationHistory } from '@/api/methods.ts'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import type { ICreationSubmit } from '@/api/types.ts'
import { entryCodeOps, modelOps, ratioOps } from './constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import { useInitCheckTaskStatus } from './hooks.ts'
import { useQuotePreview } from '@/utils/hooks'
import { useMessage } from 'naive-ui'
import * as utils from './utils.ts'
import SourceImageStack from '@/components/SourceImageStack/index.vue'
import MediaFallback from '@/components/MediaFallback/index.vue'
import GenerateLoading from '@/components/GenerateLoading/index.vue'
import { downloadImage } from '@/utils/download'
import { withWatermark } from '@/utils/oss'
import { mediaAspectRatio } from '@/utils/ratio'
import { isTimeout, displayContents } from '@/utils/utils'
import downloadSingleIcon from '@/assets/icons/download-single.svg'
import regenerateIcon from '@/assets/icons/regenerate.svg'
import regenerateWhiteIcon from '@/assets/icons/regenerate-white.svg'
import downloadAllIcon from '@/assets/icons/download-all.svg'

const message = useMessage()
const store = useHomeStore()
const { global_formData } = storeToRefs(store)
let _formData: any
if (global_formData.value.home) {
  const {
    entryCode = 'imageToImage',
    modelCode = 'xiaoqi-image-1.0-flash',
    prompt = '',
    ratio = '1024,1024',
    images = [],
  } = global_formData.value.picture
  _formData = { entryCode, modelCode, prompt, ratio, images }
  store.reset()
}

// 生成中标志：提交后保持 true 直到本批任务全部到终态（供轮询完成副作用使用）
const loading = ref(false)
// 发送按钮 loading：仅在提交请求期间为 true，提交成功即恢复，生成进度看历史列表。
// 与 loading 解耦，避免后端某张子图卡在处理中时把发送按钮永久锁死（且刷新也无法恢复）。
const btnLoading = ref(false)
const formData = reactive(
  _formData ?? {
    entryCode: 'imageToImage',
    modelCode: 'xiaoqi-image-1.0-flash',
    prompt: '',
    ratio: '1024,1024',
    images: [],
  },
)
// 提交前积分预览：镜像提交参数，切换入口/比例时防抖重询
const { pricePoints, status: quoteStatus } = useQuotePreview(
  () => {
    const [w, h] = formData.ratio.split(',')
    return {
      entryCode: formData.entryCode,
      modelCode: formData.modelCode,
      params: {
        prompt: formData.prompt,
        width: +w!,
        height: +h!,
        num: formData.entryCode === 'textToImage' ? 4 : 1,
      },
      imageUrls: formData.images,
    }
  },
  [() => formData.entryCode, () => formData.modelCode, () => formData.ratio],
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

const submit = async () => {
  if (btnLoading.value) return

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
    modelCode: formData.modelCode,
    params: {
      prompt: formData.prompt,
      width: +wh[0]!,
      height: +wh[1]!,
      num: formData.entryCode === 'textToImage' ? 4 : 1,
    },
    images: formData.images,
  }
  btnLoading.value = true
  const success = await execute(params)
  btnLoading.value = false

  // 提交成功后清空输入框及素材，失败保留以便修改后重新提交
  if (success) {
    formData.prompt = ''
    formData.images = []
  }
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
      // 返回本次拉取是否成功，供 hook 判断是否需要重试
      return res.code === 0
    })
    .finally(() => (pagingData.loading = false))
}
getData(true)

const { execute } = useInitCheckTaskStatus({ type: 'picture', loading, getData, pagingData })

// 生成中不拦截：新任务并入当前会话，轮询按会话整体判终态，两批任务都会被跟进
const generateAgain = (item: any) => {
  execute(utils.buildResubmitParams(item))
}

// 单资源卡片：下载中的资源 URL 集合（用于按钮 loading 动效）
const downloadingSet = reactive(new Set<string>())
const onDownloadSingle = async (url: string) => {
  if (!url || downloadingSet.has(url)) return
  downloadingSet.add(url)
  try {
    await downloadImage(url)
  } finally {
    downloadingSet.delete(url)
  }
}

// 单资源卡片：重新生成中的资源 key 集合（用于按钮 loading 动效）
const regeneratingSet = reactive(new Set<string>())
// 单张重新生成：沿用原任务入参（提示词/图片/比例/模型），仅生成 1 张
const generateAgainSingle = async (item: any, key: string) => {
  if (loading.value || regeneratingSet.has(key)) return
  regeneratingSet.add(key)
  try {
    await execute(utils.buildResubmitParams(item, true))
  } finally {
    regeneratingSet.delete(key)
  }
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
        key-field="taskId"
        :style="{ height: scrollerHeight + 'px' }"
        class="scroller"
        v-observer-scroll="{
          callbackTop: getData,
          distanceTop: 100,
        }"
      >
        <template #default="{ item, index, active }">
          <DynamicScrollerItem
            :item="item"
            :active="active"
            :size-dependencies="[
              item.inputParams?.params?.prompt,
              item.status,
              item.contents,
              item.inputParams?.entryCode,
            ]"
            :data-index="index"
          >
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
                <div
                  v-for="(jtem, j) in displayContents(item)"
                  :key="j"
                  class="message-group__image-wrap"
                  :style="{ aspectRatio: mediaAspectRatio(jtem, mediaAspectRatio(item.inputParams?.params, '253 / 348')) }"
                >
                  <!-- 违规优先：白卡占位，不再显示原图/操作 -->
                  <MediaFallback v-if="jtem.blocked" type="image" reason="blocked" />
                  <n-image
                    v-else-if="jtem.resultUrl"
                    :src="withWatermark(jtem.resultUrl)"
                    alt=""
                    width="100%"
                    height="100%"
                    object-fit="cover"
                  >
                    <template #error>
                      <!-- 成功图但加载失败：网络原因 -->
                      <MediaFallback type="image" reason="loadFailed" />
                    </template>
                  </n-image>
                  <GenerateLoading v-else-if="jtem.status === 0 || jtem.status === 1" />
                  <MediaFallback
                    v-else-if="jtem.status === 3"
                    type="image"
                    :reason="isTimeout(jtem) ? 'timeout' : 'generateFailed'"
                  />
                  <div
                    v-if="jtem.resultUrl && !jtem.blocked && (jtem.resolution || jtem.ratio) && utils.isMixedSize(item.contents)"
                    class="image-meta-badge"
                  >
                    <span v-if="jtem.resolution">{{ jtem.resolution }}</span>
                    <span v-if="jtem.ratio">{{ jtem.ratio }}</span>
                  </div>
                  <div v-if="jtem.resultUrl && !jtem.blocked" class="single-actions" @click.stop>
                    <button
                      v-if="jtem.status === 2"
                      class="single-action-btn"
                      title="下载"
                      :disabled="downloadingSet.has(jtem.resultUrl)"
                      @click.stop="onDownloadSingle(jtem.resultUrl)"
                    >
                      <span v-if="downloadingSet.has(jtem.resultUrl)" class="single-action-spinner"></span>
                      <img v-else :src="downloadSingleIcon" width="24" height="24" alt="下载" />
                    </button>
                    <template v-if="!utils.isFromAigcChat(item)">
                      <span class="single-action-divider"></span>
                      <button
                        class="single-action-btn"
                        title="重新生成"
                        :disabled="loading || regeneratingSet.has(jtem.resultUrl)"
                        @click.stop="generateAgainSingle(item, jtem.resultUrl)"
                      >
                        <span v-if="regeneratingSet.has(jtem.resultUrl)" class="single-action-spinner"></span>
                        <img v-else :src="regenerateWhiteIcon" width="24" height="24" alt="重新生成" />
                      </button>
                    </template>
                  </div>
                </div>
              </div>

              <!-- AI 声明 -->
              <p class="message-group__disclaimer">{{ item.disclaimer }}</p>

              <div style="color: #9e9e9e; margin-bottom: 8px;">以上内容由AI生成</div>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button v-if="!utils.isFromAigcChat(item)" class="action-btn" @click="generateAgain(item)">
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
        :btnLoading="btnLoading"
        :imageLimit="3"
        :showImageUpload="formData.entryCode === 'imageToImage'"
        :pricePoints="pricePoints"
        :quoteFailed="quoteStatus === 'error'"
        :quoteLoading="quoteStatus === 'loading'"
      >
        <template #bottomSelect>
          <div class="select-cont">
            <ChatInputSelect
              v-model:value="formData.entryCode"
              title="选择创作类型"
              icon-category="entryCode"
              :options="entryCodeOps"
            />
            <ChatInputSelect
              v-model:value="formData.modelCode"
              title="选择模型"
              icon-category="model"
              :options="modelOps"
            />
            <ChatInputSelect
              v-model:value="formData.ratio"
              title="选择比例"
              icon-category="ratio"
              :options="ratioOps"
            />
          </div>
        </template>
      </ChatInputBox>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './index';

.select-cont {
  display: flex;
  gap: 24px;
}

</style>
