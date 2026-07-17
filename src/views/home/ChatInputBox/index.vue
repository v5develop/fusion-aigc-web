<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Upload from '@/components/ChatImageUpload/index.vue'
import PromptEditor from './PromptEditor.vue'
import type { PromptSlot, FileItem } from './types'

interface IProps {
  submit: () => void
  activeChatTab?: string
  btnLoading?: boolean
  showImageUpload?: boolean
  showVideoUpload?: boolean
  imageLimit?: number
  videoLimit?: number
  /** 视频时长上限（秒） */
  videoDuration?: number
  /** 禁用提示词输入（如动作迁移模式无需提示词） */
  promptDisabled?: boolean
  promptPlaceholder?: string
  mode?: 'default' | 'slot'
  /** 本次生成所需积分：>0 显示数字，0/null 显示「限免」 */
  pricePoints?: number | null
  /** 询价失败：显示「获取失败」 */
  quoteFailed?: boolean
  /** 询价进行中：显示转圈，避免未返回时误显示「限免」 */
  quoteLoading?: boolean
}
const {
  submit,
  activeChatTab,
  btnLoading,
  showImageUpload = true,
  showVideoUpload,
  imageLimit = 5,
  videoLimit = 1,
  videoDuration = 10,
  promptDisabled = false,
  promptPlaceholder = '和我聊聊，你想要什么设计。',
  mode = 'default',
  pricePoints,
  quoteFailed,
} = defineProps<IProps>()
const formData = defineModel<any>('formData')
const slots = defineModel<PromptSlot[]>('slots')
const sideImages = defineModel<FileItem[]>('sideImages')

// contenteditable 双向绑定（default 模式）
const textareaRef = ref<HTMLDivElement | null>(null)

onMounted(() => {
  const el = textareaRef.value
  if (el && el.innerText !== formData.value.prompt) {
    el.innerText = formData.value.prompt ?? ''
  }
})
watch(
  () => activeChatTab,
  () => {
    const el = textareaRef.value
    if (el && el.innerText !== formData.value.prompt) {
      el.innerText = formData.value.prompt ?? ''
    }
  },
)
watch(
  () => formData.value?.prompt,
  (val) => {
    const el = textareaRef.value
    if (el && el.innerText !== val) {
      el.innerText = val ?? ''
    }
  },
)

const onInput = (e: Event) => {
  const el = e.target as HTMLDivElement
  const text = el.innerText.replace(/\n$/, '')
  if (!text) {
    el.innerHTML = ''
  }
  formData.value.prompt = text
}
// 拦截粘贴，强制纯文本
const handlePaste = (e: ClipboardEvent) => {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!text || !textareaRef.value) return

  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  range.deleteContents()
  range.insertNode(document.createTextNode(text))
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)

  formData.value.prompt = textareaRef.value.innerText
}
</script>

<template>
  <div class="chat-content">
    <!-- ====== Slot 模式 ====== -->
    <template v-if="mode === 'slot'">
      <div class="main-content main-content--slot">
        <!-- 电商商品 tab 隐藏左侧图片选择控件（showImageUpload 为 false） -->
        <div v-show="showImageUpload" class="upload-cont">
          <Upload
            style="width: 72px"
            v-model:fileList="sideImages!"
            :limitNumber="5"
            multiple
          />
        </div>
        <PromptEditor v-model:slots="slots!" />
      </div>
    </template>

    <!-- ====== Default 模式 ====== -->
    <template v-else>
      <div class="main-content">
        <div v-show="showImageUpload || showVideoUpload" class="upload-cont">
          <Upload
            v-show="showImageUpload"
            style="width: 72px"
            v-model:fileList="formData.images"
            :limitNumber="imageLimit"
            multiple
          />
          <Upload
            v-if="showVideoUpload"
            style="width: 72px"
            v-model:fileList="formData.video"
            type="video"
            :limitNumber="videoLimit"
            :limitDuration="videoDuration"
            label="视频"
          />
        </div>

        <div
          ref="textareaRef"
          class="textarea-box"
          :contenteditable="!promptDisabled"
          :data-placeholder="promptPlaceholder"
          @input="onInput"
          @paste="handlePaste"
        ></div>
      </div>
    </template>

    <div class="bottom-content">
      <slot name="bottomSelect"></slot>

      <div class="send-cont">
        <!-- 询价未返回时转圈，避免把「未知」显示成「限免」 -->
        <n-spin v-if="quoteLoading" class="quote-spin" size="small" />
        <template v-else>
          <i v-if="!quoteFailed" class="icon-ic_hone_bean"></i>
          <span>{{ quoteFailed ? '获取失败' : pricePoints ? pricePoints : '限免' }}</span>
        </template>
        <div class="btn" @click="submit" v-loading="btnLoading">
          <i class="icon-ic_home_send"></i>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

.chat-content {
  width: 100%;
  max-width: 960px;
  height: 200px;
  display: flex;
  flex-direction: column;
  padding: 15px;
  border-radius: 24px;
  opacity: 1;
  background: #ffffff;
  box-sizing: border-box;
  border: 1px solid #f0f0f0;
  margin: 0 auto;
  > .main-content {
    height: 100px;
    display: flex;
    gap: 24px;
    > .upload-cont {
      height: 80px;
      flex-shrink: 0;
      display: flex;
    }
    > .textarea-box {
      height: 100%;
      overflow: auto;
      outline: none;
      flex: 1;
      white-space: wrap;
      word-break: break-all;
      font-size: 16px;
      .scrollbar(@width: 5px, @thumbColor: #dcdcdc);
      &:empty::before {
        content: attr(data-placeholder);
        color: #9e9e9e;
        pointer-events: none;
      }
    }
    &--slot {
      height: auto;
      min-height: 100px;
    }
  }
  > .bottom-content {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    > .send-cont {
      margin-left: auto;
      display: flex;
      align-items: center;
      > i {
        color: var(--main-color);
        margin-right: 3px;
      }
      > .btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        margin-left: 15px;
        background: linear-gradient(180deg, #d7c9ff 0%, #bba2ff 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: relative;
        > i {
          font-size: 24px;
          color: white;
        }
        .icon-ic_home_send {
          font-size: 38px;
        }
      }
    }
  }
}
</style>
