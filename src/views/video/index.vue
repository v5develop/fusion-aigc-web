<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
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
import { useQuotePreview } from '@/utils/hooks'
import { useEntryCodeFromQuery } from '@/utils/hooks/useEntryCodeFromQuery'
import { videoModelOpsFor } from '@/utils/modelCatalog'
import { useMessage } from 'naive-ui'
import { showDownloadBtn, isFromAigcChat } from '@/views/picture/utils.ts'
import { downloadImagesAsZip, getDownloadableUrls, zipNameOf } from '@/utils/download'
import { getMetaData, isMixedSize, buildResubmitParams, applySameStyleRecipe } from './utils.ts'
import { useSameStyleRecipe } from '@/utils/hooks/useSameStyleRecipe'
import SourceImageStack from '@/components/SourceImageStack/index.vue'
import MediaFallback from '@/components/MediaFallback/index.vue'
import GenerateLoading from '@/components/GenerateLoading/index.vue'
import { isTimeout, displayContents } from '@/utils/utils'
import { isPortraitMedia } from '@/utils/ratio'
import regenerateIcon from '@/assets/icons/regenerate.svg'
import downloadAllIcon from '@/assets/icons/download-all.svg'

const message = useMessage()
const store = useHomeStore()
const { global_formData } = storeToRefs(store)
let _formData: any
if (global_formData.value.home) {
  const {
    entryCode = 'imageToVideo',
    modelCode = 'xiaoqi-video-1.0-lite',
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

// 生成中标志：提交后保持 true 直到本批任务全部到终态（供轮询完成副作用使用）
const loading = ref(false)
// 发送按钮 loading：仅在提交请求期间为 true，提交成功即恢复，生成进度看历史列表
const btnLoading = ref(false)
// 容器深链指定的创作场景。放在 _formData 之后消费：首页带入是「用户上一秒刚做的选择」，
// 而 query 是进场地址——站内跳转（router.push({ name: 'video' })）本来就不带 query，
// 两条路径天然互斥，写死优先级只是防以后首页加了 query 两边打架。
const { entryCode: queryEntryCode, syncToUrl } = useEntryCodeFromQuery(entryCodeOps)

const formData = reactive(
  _formData ?? {
    entryCode: queryEntryCode ?? 'imageToVideo',
    modelCode: 'xiaoqi-video-1.0-lite',
    prompt: '',
    ratio: '9:16',
    resolution: '720p',
    duration: 4,
    images: [],
    video: [],
  },
)

// 页内切换场景后同步地址栏，让刷新／容器重载能落回同一个场景。
// 单向：URL 只在 setup 读一次，不再回写表单，否则两边互相触发成回环。
watch(() => formData.entryCode, syncToUrl)

/** 当前场景可选的模型（服务端 entry_codes 过滤）。抽成 computed 是因为下面的对齐 watch 要盯它。 */
const entryModelOps = computed(() => videoModelOpsFor(formData.entryCode))

/**
 * 把 modelCode 纠正到当前场景的合法模型。
 *
 * <p>模型下拉按 entryCode 过滤，modelCode 却是另一份独立状态：深链 ?entryCode=actionTransfer
 * 进来、或用户手切创作类型时，modelCode 还留着上一个场景的值——下拉看起来是空的，
 * 而询价和提交都会以「无法匹配计费档位」失败。
 *
 * <p>盯 entryModelOps 而非 entryCode：模型表是异步加载的，首屏这会儿还是空数组，
 * 只盯 entryCode 会漏掉「加载完成」这一次，深链带进来的错配就永远纠正不了。
 *
 * <p>声明位置必须在下面 currentModel 那个 watch 之前：同一 flush 内 watcher 按创建顺序
 * 执行，这样档位校验读到的才是对齐后的模型。
 */
watch(
  entryModelOps,
  (ops) => {
    // 模型表未就绪（或该场景确实没配模型）时保持原值：清空会让下拉和已选双双为空，比留个旧值更糟
    if (!ops.length) return
    // 已经合法就不动，别覆盖用户／首页带入的选择
    if (ops.some((m) => m.value === formData.modelCode)) return
    formData.modelCode = ops[0]!.value
  },
  { immediate: true },
)

/**
 * 比例/分辨率/时长按<b>当前模型</b>取值，不用全局静态表。
 *
 * <p>各模型支持的档位不同：xiaoqi-video-1.0-mini（task_type 51）只支持 5 秒，而静态表列的是
 * 4~15 秒——用户选 10 秒会在<b>扣费之后</b>于生成阶段失败，还要走退款。
 * 服务端没下发该模型的档位（旧数据没刷 aigcOptions）时回退静态表，不至于把下拉变空。
 */
const currentModel = computed(() => modelOps.find((m) => m.value === formData.modelCode))
const modelRatioOps = computed(() => (currentModel.value?.ratioOps?.length ? currentModel.value.ratioOps : ratioOps))
const modelResolutionOps = computed(() => currentModel.value?.resolutionOps ?? [])
const modelDurationOps = computed(() =>
  currentModel.value?.durationOps?.length ? currentModel.value.durationOps : durationOps,
)

/**
 * 换模型后把已选档位纠正到新模型支持的范围。
 * <p>不纠正的话，从 lite(10s) 切到 mini(仅 5s) 时下拉里已经没有 10s 这一项，但 formData 还留着它——
 * 界面看不出异常，提交下去必失败。
 * <p>监听 currentModel 而非 modelCode：模型表是异步加载的，首屏那会儿它还是 undefined，
 * 只盯 modelCode 就漏掉「加载完成」这一次，初始默认值不会被纠正。
 * <p>immediate：模型表已加载完再进本页时（站内二次导航），以及上面那个对齐 watch 在
 * setup 阶段就把 modelCode 换掉时，currentModel 在本 watcher 建立前就已是新值，
 * 不 immediate 就永远不校验初始档位——会漏出「模型换了但时长还是 4s，而该模型只支持 5s」。
 */
watch(
  currentModel,
  () => {
    const ratio = modelRatioOps.value[0]
    if (ratio && !modelRatioOps.value.some((o) => o.value === formData.ratio)) {
      formData.ratio = ratio.value
    }
    const resolution = modelResolutionOps.value[0]
    if (resolution && !modelResolutionOps.value.some((o) => o.value === formData.resolution)) {
      formData.resolution = resolution.value
    }
    const duration = modelDurationOps.value[0]
    if (duration && !modelDurationOps.value.some((o) => o.value === formData.duration)) {
      formData.duration = duration.value
    }
  },
  { immediate: true },
)

// 提交前积分预览：镜像提交参数，切换入口/模型/比例/分辨率/时长时防抖重询
const { pricePoints, status: quoteStatus } = useQuotePreview(() => {
  const isAT = formData.entryCode === 'actionTransfer'
  return {
    entryCode: formData.entryCode,
    modelCode: formData.modelCode,
    params: {
      prompt: formData.prompt,
      ...(isAT ? {} : { resolution: formData.resolution, aspectRatio: formData.ratio, duration: formData.duration }),
    },
    imageUrls: formData.images,
    video: isAT ? formData.video[0]?.url || '' : '',
  }
}, [
  () => formData.entryCode,
  () => formData.modelCode,
  () => formData.resolution,
  () => formData.duration,
  () => formData.ratio,
])

// 切换生成模式时校验已选图片：超出新模式上限只保留前面的，文生视频不需要图片则清空
watch(
  () => formData.entryCode,
  (entryCode) => {
    // 动作迁移不可编辑提示词，清掉其他模式的残留文字，避免显示后无法删除且被提交
    if (entryCode === 'actionTransfer') {
      formData.prompt = ''
    }
    if (entryCode === 'textToVideo') {
      formData.images = []
      return
    }
    const limit = config[entryCode]?.imageLimit
    if (limit && formData.images.length > limit) {
      formData.images = formData.images.slice(0, limit)
    }
  },
)

// 做同款：地址栏带 sameStyleId 时拉配方回填表单。配方是异步到的，天然晚于
// 首页带入(pinia)与深链(query)，优先级最高，直接覆盖即可。
// 声明在上面几条 watch 之后：回填要让它们先各跑一轮再写档位与素材（见 utils 里的说明）。
useSameStyleRecipe(entryCodeOps, (recipe, entryCode, isCurrent) =>
  applySameStyleRecipe(formData, recipe, entryCode, isCurrent),
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

  // 动作迁移不需要提示词
  if (!formData.prompt && formData.entryCode !== 'actionTransfer') {
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

  btnLoading.value = true
  const isActionTransfer = formData.entryCode === 'actionTransfer'
  const params: ICreationSubmit = {
    type: 'VIDEO',
    entryCode: formData.entryCode as ICreationSubmit['entryCode'],
    modelCode: formData.modelCode,
    params: {
      prompt: formData.prompt,
      // 动作迁移由参考视频决定画幅/时长，不传比例/分辨率/时长
      ...(isActionTransfer
        ? {}
        : {
            resolution: formData.resolution,
            aspectRatio: formData.ratio,
            duration: formData.duration,
          }),
    },
    images: formData.images,
    video: isActionTransfer ? formData.video[0]?.url || '' : '',
  }
  const success = await execute(params)
  btnLoading.value = false

  // 提交成功后清空输入框及素材，失败保留以便修改后重新提交
  if (success) {
    formData.prompt = ''
    formData.images = []
    formData.video = []
  }
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
      // 返回本次拉取是否成功，供 hook 判断是否需要重试
      return res.code === 0
    })
    .finally(() => (pagingData.loading = false))
}
getData(true)

const { execute } = useInitCheckTaskStatus({ type: 'video', loading, getData, pagingData })

// 生成中不拦截：新任务并入当前会话，轮询按会话整体判终态，两批任务都会被跟进
const generateAgain = (item: any) => {
  execute(buildResubmitParams(item))
}

// 整组下载中的任务 id 集合（打包需先抓全部视频，耗时较长，防重复点击）
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

// 加载失败的视频 URL 集合：失败后以占位图替换该视频
const videoErrorSet = reactive(new Set<string>())

const isActionTransfer = (item: any) => {
  const ip = item?.inputParams
  // 本站提交有 entryCode；Agent 来源无 entryCode，通过是否有参考视频判断（仅动作迁移带视频入参）
  if (ip?.entryCode) return ip.entryCode === 'actionTransfer'
  return !!(ip?.video || ip?.videoUrls?.length)
}

// 容器统一 16:9；竖视频或动作迁移用 contain 居中，横视频用 cover 填满
const useContain = (content: any, parentItem: any) =>
  isActionTransfer(parentItem) || isPortraitMedia(content, parentItem?.inputParams?.params)

// 动作迁移的输入视频 URL；兼容早期历史数据 video 为 { url, thumbnail } 对象的情况
const getSourceVideo = (inputParams: any): string => {
  if (inputParams.entryCode !== 'actionTransfer') return ''
  const video = inputParams.video
  return typeof video === 'string' ? video : video?.url || ''
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
                  v-if="item.inputParams.entryCode !== 'textToVideo'"
                  :images="item.inputParams.images ?? []"
                  :video="getSourceVideo(item.inputParams)"
                />
                <div class="message-group__prompt-wrapper">
                  <p class="message-group__prompt">
                    {{ item.inputParams.params.prompt }}
                    <span class="message-group__prompt-meta">{{ getMetaData(item) }}</span>
                  </p>
                </div>
              </div>

              <!-- 图片网格 -->
              <div class="message-group__images">
                <div
                  v-for="(jtem, j) in displayContents(item)"
                  :key="j"
                  class="message-group__image-wrap"
                  :style="{ aspectRatio: '16 / 9' }"
                >
                  <!-- 违规优先：白卡占位 -->
                  <MediaFallback v-if="jtem.blocked" class="video" type="video" reason="blocked" />
                  <!-- 展示用 watermarkUrl、下载用 resultUrl，即「展示带水印、下载给原件」。
                       watermarkUrl 恒有值：后端在无水印版本时已回落到 resultUrl，故无需判空。
                       水印开关关闭时两者同值，本处代码开关两态通用。
                       poster 为后端异步抽帧的封面，为空时不设、浏览器退回首帧——
                       刚出片的几十秒内封面还没补上，属正常，不是错误态 -->
                  <video
                    v-else-if="jtem.resultUrl && !videoErrorSet.has(jtem.resultUrl)"
                    class="video"
                    :style="useContain(jtem, item) ? { objectFit: 'contain' } : undefined"
                    :src="jtem.watermarkUrl || jtem.resultUrl"
                    :poster="jtem.coverUrl || undefined"
                    preload="metadata"
                    controls
                    @error="videoErrorSet.add(jtem.resultUrl)"
                  />
                  <!-- 成功视频但加载失败：网络原因 -->
                  <MediaFallback v-else-if="jtem.resultUrl" class="video" type="video" reason="loadFailed" />
                  <GenerateLoading v-else-if="jtem.status === 0 || jtem.status === 1" />
                  <MediaFallback
                    v-else-if="jtem.status === 3"
                    class="video"
                    type="video"
                    :reason="isTimeout(jtem) ? 'timeout' : 'generateFailed'"
                  />
                  <div
                    v-if="
                      jtem.resultUrl && !jtem.blocked && (jtem.resolution || jtem.ratio) && isMixedSize(item.contents)
                    "
                    class="image-meta-badge"
                  >
                    <span v-if="jtem.resolution">{{ jtem.resolution }}</span>
                    <span v-if="jtem.ratio">{{ jtem.ratio }}</span>
                  </div>
                </div>
              </div>

              <!-- AI 声明 -->
              <p class="message-group__disclaimer">{{ item.disclaimer }}</p>

              <div style="color: #9e9e9e; margin-bottom: 8px">以上内容由AI生成</div>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button v-show="!isFromAigcChat(item)" class="action-btn" @click="generateAgain(item)">
                  <img :src="regenerateIcon" class="action-btn__icon" width="16" height="16" alt="再次生成" />
                  <span>再次生成</span>
                </button>
                <button
                  v-show="showDownloadBtn(item)"
                  class="action-btn"
                  :disabled="downloadingAllSet.has(item.taskId)"
                  @click="onDownloadAll(item)"
                >
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
        :showImageUpload="formData.entryCode !== 'textToVideo'"
        :showVideoUpload="formData.entryCode === 'actionTransfer'"
        :pricePoints="pricePoints"
        :quoteFailed="quoteStatus === 'error'"
        :quoteLoading="quoteStatus === 'loading'"
        v-bind="config[formData.entryCode]"
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
              :options="entryModelOps"
            />
            <!-- 动作迁移由参考视频决定画幅/时长，无需选择比例/分辨率/时长 -->
            <template v-if="formData.entryCode !== 'actionTransfer'">
              <ChatInputSelect
                v-model:value="formData.ratio"
                title="选择比例"
                icon-category="ratio"
                :options="modelRatioOps"
              />
              <ChatInputSelect
                v-model:value="formData.resolution"
                title="选择分辨率"
                icon-category="resolution"
                :options="modelResolutionOps"
              />
              <ChatInputSelect
                v-model:value="formData.duration"
                title="选择时长"
                icon-category="duration"
                :options="modelDurationOps"
              />
            </template>
          </div>
        </template>
      </ChatInputBox>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '../picture/index.less';

.message-group__images {
  grid-template-columns: repeat(auto-fill, 480px);
}

.select-cont {
  width: 250px;
  display: flex;
  gap: 24px;
}
</style>
