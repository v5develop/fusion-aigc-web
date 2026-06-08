<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'

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
  'https://image-resource.mastergo.com/189358671263899/189358671263901/0efd354dd9eef62fb678d879d01ca5c1.png',
  'https://image-resource.mastergo.com/189358671263899/189358671263901/4b27e10abd11e9308e47d3afcf9cb790.png',
  'https://image-resource.mastergo.com/189358671263899/189358671263901/0efd354dd9eef62fb678d879d01ca5c1.png',
]

const todayImages = [
  'https://image-resource.mastergo.com/189358671263899/189358671263901/c0527ba40fd9b69b9dd44fcd0e09ea80.png',
  'https://image-resource.mastergo.com/189358671263899/189358671263901/8857d3ae74f176d920aa07996529fcac.png',
  'https://image-resource.mastergo.com/189358671263899/189358671263901/f62513cd98210212e92f7c4a2fc67407.png',
  'https://image-resource.mastergo.com/189358671263899/189358671263901/cf72ecc2c50db6c902c1310d866774f9.png',
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
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '3',
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '5',
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '6',
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '7',
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '8',
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
    disclaimer: '以上内容由AI生成 | 本次消耗0积分',
  },
  {
    id: '9',
    date: '今天',
    showDate: true,
    prompt:
      '这是一张瑞幸咖啡"瓦尔登蓝系列"新品宣传海报。背景为蓝色水波纹，营造出清凉梦幻的氛围。左上角是"luckin coffee"品牌标识。上方醒目标语"可以喝的\'天空之镜\' 颜值MAX 瓦尔登蓝系列 全新上市"，吸引视线。画面展示两款新品：左侧"瓦尔登蓝钻瑞纳冰"，杯身呈梦幻浅蓝色',
    meta: '本地模型 ｜9:16 ｜4K',
    images: todayImages,
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
      console.log(entries, 99)
      scrollerHeight.value = entries[0]?.contentRect.height ?? 0
    })
    resizeObserver.observe(virtualListContainer.value)
  }
})
onUnmounted(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <div class="picture">
    <div class="top_bg"></div>

    <div ref="virtualListContainer" class="virtual-list">
      <DynamicScroller
        v-if="scrollerHeight > 0"
        :items="messages"
        :min-item-size="300"
        key-field="id"
        :style="{ height: scrollerHeight + 'px' }"
        class="scroller"
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

    <div class="input-box">
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
.picture {
  width: 100%;
  height: 100%;
  padding: 45px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: absolute;
  left: 0;
  top: 0;

  > .top_bg {
    width: 100%;
    position: relative;

    &::before {
      content: '';
      width: 100%;
      max-width: 948px;
      height: 241px;
      position: absolute;
      top: -220px;
      left: 50%;
      transform: translateX(-50%);
      opacity: 1;
      background: linear-gradient(270deg, #ffacd7 0%, #bba2ff 100%);
      filter: blur(120px);
    }
  }

  > .virtual-list {
    flex: 1;
    width: 100%;
    max-width: 1024px;
    min-height: 0;
    padding: 12px;
    box-sizing: border-box;
  }

  > .h1 {
    font-size: 28px;
    font-weight: bold;
    text-align: center;
    color: #1f1f1f;
    margin: 0 0 40px;
  }
  > .input-box {
    width: 100%;
    padding-top: 5px;
    > div {
      box-shadow: 0 0 5px #dcdcdc;
    }
  }
}

// ==================== 虚拟列表容器样式覆盖 ====================
:deep(.scroller) {
  // 隐藏默认滚动条样式，保持设计稿简洁感
  &::-webkit-scrollbar {
    width: 5px;
  }
  &::-webkit-scrollbar-track {
    background-color: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background-color: #dcdcdc;
    border-radius: 10px;
  }
}

// ==================== 消息组 ====================
.message-group {
  padding-bottom: 24px;

  // 日期标题
  &__date {
    /* token: 中性色/标题文字 */
    font-family: 'PingFang SC', sans-serif;
    font-size: 24px;
    font-weight: 600;
    color: #1f1f1f;
    margin: 0 0 21px;
    line-height: 1;
  }

  // 提示词
  &__prompt {
    /* token: 中性色/正文文字 */
    font-family: 'PingFang SC', sans-serif;
    font-size: 14px;
    font-weight: 400;
    color: #3a3a3a;
    line-height: 26px;
    margin: 0 0 6px;
    word-break: break-all;
  }

  // 元信息
  &__meta {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;

    span {
      /* token: 中性色/辅助文字 */
      font-family: 'Source Han Sans SC', 'PingFang SC', sans-serif;
      font-size: 14px;
      color: #9e9e9e;
      line-height: 20px;
    }
  }

  // 图片网格 - 4 列
  &__images {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-bottom: 16px;
  }

  &__image-wrap {
    width: 100%;
    aspect-ratio: 253 / 348;
    border-radius: 4px;
    overflow: hidden;
    background: #f0f0f0;
  }

  &__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  // AI 声明
  &__disclaimer {
    /* token: 中性色/辅助文字 */
    font-family: 'PingFang SC', sans-serif;
    font-size: 14px;
    font-weight: 400;
    color: #9e9e9e;
    line-height: 20px;
    margin: 0 0 8px;
  }

  // 操作按钮区
  &__actions {
    display: flex;
    gap: 8px;
  }
}

// ==================== 操作按钮 ====================
.action-btn {
  /* token: 中性色/背景色 */
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  background: #edeef0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  color: #3a3a3a;
  transition: background 0.15s ease;

  &:hover {
    background: #e0e1e3;
  }

  &__icon {
    flex-shrink: 0;
    color: #3a3a3a;
  }
}
</style>
