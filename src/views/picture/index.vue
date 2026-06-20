<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue'
import { creationSubmit, assetAll } from '@/api/methods.ts'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import ChatInputBox from '@/views/home/ChatInputBox/index.vue'
import ChatInputSelect from '@/components/ChatInputSelect/index.vue'
import type { ICreationSubmit } from '@/api/types.ts'
import { taskOps, ratioOps } from './constants.ts'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import { usePolling } from '@/utils/hooks/usePolling.ts'

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

const submit2 = () => {
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
      num: formData.entryCode === 'textToImage' ? 4 : 1,
    },
    images: formData.images,
  }
  creationSubmit(params).then((res) => {
    if (res.code === 0) {
      start(res.data.taskId)
      messages.value.push({
        taskTime: '',
        // status: 0=排队 1=处理中 2=成功 3=失败 4=取消，造条假的
        assets: [{ aiPrompt: formData.prompt, status: 1 }],
      })
      nextTick(() => {
        dynamicScrollerRef.value?.scrollToBottom()
      })
    }
  })
}
const submit = () => {
  if (loading.value) return
  loading.value = true

  setTimeout(() => {
    start()
    messages.value.push({
      taskTime: '',
      // status: 0=排队 1=处理中 2=成功 3=失败 4=取消，造条假的
      assets: [{ aiPrompt: formData.prompt, status: 1 }],
    })
    nextTick(() => {
      dynamicScrollerRef.value?.scrollToBottom()
    })
  }, 1000)
}

/*const { start } = usePolling((taskId) => pollingSingleTask(taskId!), 3000, {
  autoStop(res: any) {
    if (res.code === 0) {
      const data = res.data
      // status: 0=排队 1=处理中 2=成功 3=失败 4=取消   terminal: 是否为终态（不再变化）
      if (data.status !== 2 && !data.statusView.terminal) {
        return false
      }
    }

    pagingData.page = 1
    pagingData.hasMore = true
    getData(true)?.finally(() => (loading.value = false))
    return true
  },
})*/
let count = 0
const { start } = usePolling(() => {
  count ++
  return new Promise(resolve => {
    console.log(count)
    resolve({
      code: 0,
      data:{
        status: count < 3 ? 1 : 2,
        statusView: {
          terminal: false
        }
      }
    })
  })
}, 1000, {
  autoStop(res: any) {
    if (res.code === 0) {
      const data = res.data
      console.log(data)
      // status: 0=排队 1=处理中 2=成功 3=失败 4=取消   terminal: 是否为终态（不再变化）
      if (data.status !== 2 && !data.statusView.terminal) {
        return false
      }
    }

    pagingData.page = 1
    pagingData.hasMore = true
    getData(true)?.finally(() => (loading.value = false))
    return true
  },
})

const getData2 = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (pagingData.loading) return
  pagingData.loading = true

  const params = {
    ...pagingData,
    type: 'image',
  }
  return assetAll(params)
    .then((res) => {
      if (res.code === 0) {
        pagingData.page++

        const records = res.data.records
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
const getData = (isReplace?: boolean) => {
  if (!pagingData.hasMore) return

  if (pagingData.loading) return
  pagingData.loading = true

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      pagingData.page++

      const records = [
        {
          taskTime: '2029',
          assets: [
            {
              aiPrompt: 'xxxxxxxxxxxxxxxxxxxxx',
              resultUrl: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/logo.png'
            },
            {
              aiPrompt: 'qqqqqqqqq',
              resultUrl: 'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp'
            },
          ]
        },
        {
          taskTime: '2028',
          assets: [
            {
              aiPrompt: 'xxxxxxxxxxxxxxxxxxxxx',
              resultUrl: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/logo.png'
            }
          ]
        },
        {
          taskTime: '2027',
          assets: [
            {
              aiPrompt: 'xxxxxxxxxxxxxxxxxxxxx',
              resultUrl: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/logo.png'
            }
          ]
        },
        {
          taskTime: '2026',
          assets: [
            {
              aiPrompt: 'xxxxxxxxxxxxxxxxxxxxx',
              resultUrl: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/logo.png'
            }
          ]
        },
        {
          taskTime: '2025',
          assets: [
            {
              aiPrompt: 'xxxxxxxxxxxxxxxxxxxxx',
              resultUrl: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/logo.png'
            }
          ]
        },
        {
          taskTime: '2024',
          assets: [
            {
              aiPrompt: 'xxxxxxxxxxxxxxxxxxxxx',
              resultUrl: 'http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/logo.png'
            },
          ]
        },
      ]
      records.reverse()
      if (isReplace) messages.value = records
      else messages.value.unshift(...records)

      if (records.length < pagingData.pageSize) pagingData.hasMore = false

      if (isReplace) {
        nextTick(() => {
          dynamicScrollerRef.value?.scrollToBottom()
        })
      }
      pagingData.loading = false
      resolve('')
    }, 500)
  })
}
getData(true)

const generateAgain2 = (item: any) => {
  if (loading.value) return
  loading.value = true

  creationSubmit(item.params).then((res) => {
    if (res.code === 0) {
      start(res.data.taskId)
      messages.value.push({
        taskTime: '',
        // status: 0=排队 1=处理中 2=成功 3=失败 4=取消，造条假的
        assets: [{ aiPrompt: formData.prompt, status: 1 }],
      })
      nextTick(() => {
        dynamicScrollerRef.value?.scrollToBottom()
      })
    }
  })
}
const generateAgain = (item: any) => {
  if (loading.value) return
  console.log('generateAgain')
  loading.value = true

  setTimeout(() => {
    start()
    messages.value.push({
      taskTime: '',
      // status: 0=排队 1=处理中 2=成功 3=失败 4=取消，造条假的
      assets: [{ aiPrompt: formData.prompt, status: 1 }],
    })
    nextTick(() => {
      dynamicScrollerRef.value?.scrollToBottom()
    })
  }, 1000)
}

const download = (item: any) => {
  const urls = item.assets.map((item: any) => item.resultUrl)

  urls.forEach((url: string, index: number) => {
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = url
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }, index * 150) // 每张间隔150ms，足够浏览器响应
  })
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
              <h2 class="message-group__date">{{ item.taskTime }}</h2>

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
                  <div v-if="jtem.status === 1" class="pending">生成中...</div>
                </div>
              </div>

              <!-- AI 声明 -->
              <p class="message-group__disclaimer">{{ item.disclaimer }}</p>

              <!-- 操作按钮 -->
              <div class="message-group__actions">
                <button class="action-btn" @click="generateAgain(item)">
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
                <button class="action-btn" @click="download(item)">
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
        v-model:imgList="formData.images"
        v-model:prompt="formData.prompt"
        :submit="submit"
        :btnLoading="loading"
      >
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
