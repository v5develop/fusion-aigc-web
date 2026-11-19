<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { creationHistory } from '@/api/methods.ts'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import type { ICreationSubmit } from '@/api/types.ts'
import { entryCodeOps, modelOps, ratioOps, numOps } from './constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import { mergeLiveTasks, useInitCheckTaskStatus } from './hooks.ts'
import { useQuotePreview } from '@/utils/hooks'
import { useEntryCodeFromQuery } from '@/utils/hooks/useEntryCodeFromQuery'
import { useSameStyleRecipe } from '@/utils/hooks/useSameStyleRecipe'
import { useMessage } from 'naive-ui'
import * as utils from './utils.ts'
import SourceImageStack from '@/components/SourceImageStack/index.vue'
import MediaFallback from '@/components/MediaFallback/index.vue'
import GenerateLoading from '@/components/GenerateLoading/index.vue'
import { saveImagesAsJpg } from '@/utils/batchDownload'
import { canSaveAsJpg, saveImageAsJpg, downloadImage, downloadImagesAsZip, getDownloadableUrls, zipNameOf } from '@/utils/download'
import { ossResize, withWatermark } from '@/utils/oss'
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
    num = 1,
    images = [],
  } = global_formData.value.picture
  _formData = { entryCode, modelCode, prompt, ratio, num, images }
  store.reset()
}

// 生成中标志：提交后保持 true 直到本批任务全部到终态（供轮询完成副作用使用）
const loading = ref(false)
// 发送按钮 loading：仅在提交请求期间为 true，提交成功即恢复，生成进度看历史列表。
// 与 loading 解耦，避免后端某张子图卡在处理中时把发送按钮永久锁死（且刷新也无法恢复）。
const btnLoading = ref(false)
// 容器深链指定的创作场景。放在 _formData 之后消费：首页带入是「用户上一秒刚做的选择」，
// 而 query 是进场地址——站内跳转（router.push({ name: 'image-generate' })）本来就不带 query，
// 两条路径天然互斥，写死优先级只是防以后首页加了 query 两边打架。
const { entryCode: queryEntryCode, syncToUrl } = useEntryCodeFromQuery(entryCodeOps)

const formData = reactive(
  _formData ?? {
    entryCode: queryEntryCode ?? 'imageToImage',
    modelCode: 'xiaoqi-image-1.0-flash',
    prompt: '',
    ratio: '1024,1024',
    num: 1,
    images: [],
  },
)
// 页内切换场景后同步地址栏，让刷新／容器重载能落回同一个场景。
// 单向：URL 只在 setup 读一次，不再回写表单，否则两边互相触发成回环。
watch(() => formData.entryCode, syncToUrl)

// 做同款：地址栏带 sameStyleId 时拉配方回填表单。配方是异步到的，天然晚于
// 首页带入(pinia)与深链(query)，优先级最高，直接覆盖即可。
useSameStyleRecipe(entryCodeOps, (recipe, entryCode, isCurrent) =>
  utils.applySameStyleRecipe(formData, recipe, entryCode, isCurrent),
)

// 提交前积分预览：镜像提交参数，切换入口/比例时防抖重询
const { pricePoints, status: quoteStatus } = useQuotePreview(() => {
  const [w, h] = formData.ratio.split(',')
  return {
    entryCode: formData.entryCode,
    modelCode: formData.modelCode,
    params: {
      prompt: formData.prompt,
      width: +w!,
      height: +h!,
      num: formData.num,
    },
    imageUrls: formData.images,
  }
}, [() => formData.entryCode, () => formData.modelCode, () => formData.ratio, () => formData.num])

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
      num: formData.num,
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

// 逐条出图：会话轮询每轮把已出的产出并回列表，不等整批跑完
const { execute } = useInitCheckTaskStatus({
  type: 'picture',
  loading,
  getData,
  pagingData,
  onTasks: (tasks) => mergeLiveTasks(messages, tasks),
})

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

// 整组下载中的任务 id 集合（打包需先抓全部图片，耗时较长，防重复点击）
const onSaveJpg = async (url: string) => {
  const key = 'jpg:' + url
  if (!url || downloadingSet.has(key)) return
  downloadingSet.add(key)
  try {
    await saveImageAsJpg(url)
  } finally {
    downloadingSet.delete(key)
  }
}

const downloadingAllSet = reactive(new Set<string>())
const onDownloadAll = async (item: any) => {
  const key = item?.taskId
  if (!key || downloadingAllSet.has(key)) return
  downloadingAllSet.add(key)
  try {
    await downloadImagesAsZip(getDownloadableUrls(item), zipNameOf(item))
  } finally {
    downloadingAllSet.delete(key)
  }
}

// 整组「全部另存为 JPG」：同一份下载清单，包名同「全部下载」（后缀 _JPG）
const savingAllJpgSet = reactive(new Set<string>())
const hasJpgImages = (item: any) => getDownloadableUrls(item).some((u) => canSaveAsJpg(u))
const onSaveAllJpg = async (item: any) => {
  const key = item?.taskId
  if (!key || savingAllJpgSet.has(key)) return
  savingAllJpgSet.add(key)
  try {
    const name = zipNameOf(item)
    await saveImagesAsJpg(
      getDownloadableUrls(item).map((src) => ({ src, name })),
      { zipName: name },
    )
  } finally {
    savingAllJpgSet.delete(key)
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
                  :style="{
                    aspectRatio: mediaAspectRatio(jtem, mediaAspectRatio(item.inputParams?.params, '253 / 348')),
                  }"
                >
                  <!-- 违规优先：白卡占位，不再显示原图/操作 -->
                  <MediaFallback v-if="jtem.blocked" type="image" reason="blocked" />
                  <n-image
                    v-else-if="jtem.resultUrl"
                    :src="ossResize(withWatermark(jtem.resultUrl), 320)"
                    :preview-src="withWatermark(jtem.resultUrl)"
                    :fallback-src="withWatermark(jtem.resultUrl)"
                    :img-props="{ loading: 'lazy', decoding: 'async' }"
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
                    v-if="
                      jtem.resultUrl &&
                      !jtem.blocked &&
                      (jtem.resolution || jtem.ratio) &&
                      utils.isMixedSize(item.contents)
                    "
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
                    <button
                      v-if="jtem.status === 2 && canSaveAsJpg(jtem.resultUrl)"
                      class="single-action-btn"
                      title="另存为 JPG"
                      :disabled="downloadingSet.has('jpg:' + jtem.resultUrl)"
                      @click.stop="onSaveJpg(jtem.resultUrl)"
                    >
                      <span v-if="downloadingSet.has('jpg:' + jtem.resultUrl)" class="single-action-spinner"></span>
                      <svg
                        v-else
                        class="single-action-jpg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-label="另存为 JPG"
                      >
                        <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
                        <text x="12" y="15.2" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">JPG</text>
                      </svg>
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

              <div style="color: var(--xq-placeholder); margin-bottom: 8px">以上内容由AI生成</div>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button v-if="!utils.isFromAigcChat(item)" class="action-btn" @click="generateAgain(item)">
                  <img :src="regenerateIcon" class="action-btn__icon" width="16" height="16" alt="再次生成" />
                  <span>再次生成</span>
                </button>
                <button
                  v-show="utils.showDownloadBtn(item)"
                  class="action-btn"
                  :disabled="downloadingAllSet.has(item.taskId)"
                  @click="onDownloadAll(item)"
                >
                  <img :src="downloadAllIcon" class="action-btn__icon" width="16" height="16" alt="全部下载" />
                  <span>全部下载</span>
                </button>
                <button
                  v-if="utils.showDownloadBtn(item) && hasJpgImages(item) && getDownloadableUrls(item).length > 1"
                  class="action-btn"
                  :disabled="savingAllJpgSet.has(item.taskId)"
                  @click="onSaveAllJpg(item)"
                >
                  <span>{{ savingAllJpgSet.has(item.taskId) ? '转换中' : '全部另存为 JPG' }}</span>
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
            <ChatInputSelect v-model:value="formData.num" title="选择数量" icon-category="num" :options="numOps" />
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
