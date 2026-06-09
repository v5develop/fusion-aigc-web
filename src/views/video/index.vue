<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, useTemplateRef } from 'vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'

const dynamicScrollerRef = useTemplateRef('dynamicScrollerRef')
// ==================== 输入框相关 ====================
const { imgList, selectValues, options1, options3 } = useChat()

function useChat() {
  const imgList = ref<any[]>([])
  const selectValues = reactive({
    value1: 0,
    value2: 0,
  })
  const options1 = [
    { label: '图生图', value: 0 },
    { label: '文生图', value: 1 },
  ]
  const options3 = [
    { label: '智能比例', value: 0 },
    { label: '智能比例2', value: 1 },
  ]
  return { imgList, selectValues, options1, options3 }
}

// ==================== 消息数据 ====================
interface ChatMessage {
  id: string
  date: string
  showDate: boolean
  prompt: string
  meta: string
  images: string[]
  disclaimer: string
}

// 图片资源（从设计稿提取）
const yesterdayImages = [
  'https://image-resource.mastergo.com/189358671263899/189358671263901/e4c51f9d36c48b8e0f1347fb7de085dd.png',
]

const todayImages = [
  'https://image-resource.mastergo.com/189358671263899/189358671263901/c0527ba40fd9b69b9dd44fcd0e09ea80.png',
]

const messages = ref<ChatMessage[]>([
  {
    id: '1',
    date: '昨天',
    showDate: true,
    prompt:
      '（电影级面光：1.6），（光线追踪：1.5），（冷白皮漫感质感的光滑皮肤：1.7），（人物有最好的骨相：1.2），（网感脸：1.6），身材完美，莫兰迪配色，高颜值网红，INS风，幼态脸，19岁女生尖下巴，三庭五眼比例均衡，身材娇小，细腻陶瓷水嫩肌肤，偏冷白皮，随机的妆容，随机的饰品，随机的动作，侧光，',
    meta: '本地模型 ｜1:1 ｜4K',
    images: yesterdayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '2',
    date: '等了好久终于等到今天',
    showDate: true,
    prompt:
      '（电影级面光：1.6），（光线追踪：1.5），（冷白皮漫感质感的光滑皮肤：1.7），（人物有最好的骨相：1.2），（网感脸：1.6），身材完美，莫兰迪配色，高颜值网红，INS风，幼态脸，19岁女生尖下巴，三庭五眼比例均衡，身材娇小，细腻陶瓷水嫩肌肤，偏冷白皮，随机的妆容，随机的饰品，随机的动作，侧光，',
    meta: '本地模型 ｜1:1 ｜4K',
    images: yesterdayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
])

// ==================== 虚拟列表高度 ====================
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
  setTimeout(() => {
    console.log(dynamicScrollerRef.value?.scrollToItem(100))
  })
})
onUnmounted(() => {
  resizeObserver?.disconnect()
})
const id = ref(9)
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
        key-field="id"
        :style="{ height: scrollerHeight + 'px' }"
        class="scroller"
        v-observer-scroll="{
          callbackTop() {
            messages.unshift({
              id: id++ + '',
              date: '今天' + id,
              showDate: true,
              prompt: '这是一张瑞幸咖啡，杯身呈梦幻浅蓝色',
              meta: '本地模型 ｜9:16 ｜4K',
              images: todayImages,
              disclaimer: '以上内容由AI生成 | 本次消耗0积分',
            })
          },
          distanceTop: 100,
        }"
      >
        <template #default="{ item, index, active }">
          <DynamicScrollerItem :item="item" :active="active" :size-dependencies="[item.images]" :data-index="index">
            <div class="message-group">
              <!-- 日期标题 -->
              <h2 v-if="item.showDate" class="message-group__date">
                {{ item.date }}
              </h2>

              <!-- 提示词 -->
              <p class="message-group__prompt">{{ item.prompt }}</p>

              <!-- 元信息 -->
              <div class="message-group__meta">
                <span>{{ item.meta }}</span>
              </div>

              <!-- 图片网格 -->
              <div class="message-group__images">
                <div v-for="(img, i) in item.images" :key="i" class="message-group__image-wrap">
                  <img :src="img" alt="" class="message-group__image" />
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

      <ChatInputBox v-model:imgList="imgList">
        <template #bottomSelect>
          <ChatInputSelect v-model:value="selectValues.value1" :options="options1" />
          <ChatInputSelect v-model:value="selectValues.value2" :options="options3" />
        </template>
      </ChatInputBox>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '../picture/index.less';
</style>
