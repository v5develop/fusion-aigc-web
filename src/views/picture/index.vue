<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { creationSubmit, assetAll } from '@/api/methods.ts'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import type { ICreationSubmit } from '@/api/types.ts'
import { taskOps, ratioOps } from './constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'

const store = useHomeStore()
const { global_formData } = storeToRefs(store)
let _formData: any
if (global_formData.value.home) {
  const { entryCode = 'imageToImage', prompt = '', ratio = '1024,1024', images = [] } = global_formData.value.picture
  _formData = { entryCode, prompt, ratio, images }
  store.reset()
}

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
const dynamicScrollerRef = useTemplateRef('dynamicScrollerRef')

interface ChatMessage {
  id: string
  date: string
  showDate: boolean
  prompt: string
  meta: string
  images: string[]
  disclaimer: string
}

const messages = ref<any[]>([
  // {
  //   id: '1',
  //   date: '昨天',
  //   showDate: true,
  //   prompt:
  //     '（电影级面光：1.6），（光线追踪：1.5），（冷白皮漫感质感的光滑皮肤：1.7），（人物有最好的骨相：1.2），（网感脸：1.6），身材完美，莫兰迪配色，高颜值网红，INS风，幼态脸，19岁女生尖下巴，三庭五眼比例均衡，身材娇小，细腻陶瓷水嫩肌肤，偏冷白皮，随机的妆容，随机的饰品，随机的动作，侧光，',
  //   meta: '本地模型 ｜1:1 ｜4K',
  //   images: yesterdayImages,
  //   disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  // },
])

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
  loading.value = true

  const wh = formData.ratio.split(',')
  const params: ICreationSubmit = {
    type: 'IMAGE',
    entryCode: formData.entryCode as ICreationSubmit['entryCode'],
    modelCode: 'local-image',
    params: {
      prompt: formData.prompt,
      width: +wh[0]!,
      height: +wh[1]!,
    },
    images: formData.images,
  }
  creationSubmit(params).then((res) => {
    if (res.code === 0) {
    }
  })
}

const getData = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (pagingData.loading) return
  pagingData.loading = true

  const params = {
    ...pagingData,
    type: 'image',
  }
  assetAll(params)
    .then((res) => {
      if (res.code === 0) {
        pagingData.page++

        const records = res.data.records
        const isEmpty = messages.value.length === 0
        records.reverse()
        if (isReplace) messages.value = records
        else messages.value.unshift(...records)

        if (records.length < pagingData.pageSize) pagingData.hasMore = false

        // 类微信聊天：仅首次加载数据后自动滚动到底部
        if (isEmpty) {
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
getData()
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
        key-field="taskTime"
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
              <h2 class="message-group__date">{{ item.taskTime }} -- {{ index }}</h2>

              <!-- 提示词 -->
              <p class="message-group__prompt">{{ item.assets[0].aiPrompt }}</p>

              <!-- 元信息 -->
              <!--              <div class="message-group__meta">-->
              <!--                <span>{{ item.meta }}</span>-->
              <!--              </div>-->

              <!-- 图片网格 -->
              <div class="message-group__images">
                <div v-for="(jtem, j) in item.assets" :key="j" class="message-group__image-wrap">
                  <n-image :src="jtem.resultUrl" alt="" width="100%" height="100%" object-fit="cover" />
                </div>
              </div>

              <!-- AI 声明 -->
              <p class="message-group__disclaimer">{{ item.disclaimer }}</p>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button class="action-btn">
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
                <button class="action-btn">
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

      <ChatInputBox v-model:imgList="formData.images" v-model:prompt="formData.prompt" :submit="submit">
        <template #bottomSelect>
          <ChatInputSelect v-model:value="formData.entryCode" :options="taskOps" />
          <ChatInputSelect v-model:value="formData.ratio" :options="ratioOps" style="margin-left: 10px" />
        </template>
      </ChatInputBox>
    </div>
  </div>
</template>

<style scoped lang="less">
@import './index';
</style>
