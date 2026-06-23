<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Upload from '@/components/ChatImageUpload/index.vue'

interface IProps {
  showUpload?: boolean
  submit: () => void
  activeChatTab?: string
  btnLoading?: boolean
  showVideoUpload?: boolean
  imageLimit?: number
  videoLimit?: number
}
const {
  showUpload = true,
  submit,
  activeChatTab,
  btnLoading,
  showVideoUpload,
  imageLimit = 5,
  videoLimit = 1,
} = defineProps<IProps>()
const formData = defineModel<any>('formData')

// contenteditable 双向绑定
const textareaRef = ref<HTMLDivElement | null>(null)

const onInput = (e: Event) => {
  formData.value.prompt = (e.target as HTMLDivElement).innerText || ''
}

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
</script>

<template>
  <div class="chat-content">
    <div class="main-content">
      <div v-if="showUpload" class="upload-cont">
        <Upload style="width: 72px" v-model:fileList="formData.images" :limitNumber="imageLimit" multiple />
        <Upload
          v-if="showVideoUpload"
          style="width: 72px"
          v-model:fileList="formData.video"
          type="video"
          :limitNumber="videoLimit"
          label="视频"
        />
      </div>

      <div
        ref="textareaRef"
        class="textarea-box"
        contenteditable
        data-placeholder="和我聊聊，你想要什么设计。"
        @input="onInput"
      ></div>
    </div>

    <div class="bottom-content">
      <slot name="bottomSelect"></slot>

      <div class="send-cont">
        <i class="icon-ic_hone_bean"></i>
        <span>限免</span>
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
    gap: 20px;
    > .upload-cont {
      //min-width: 72px;
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
        pointer-events: none; /* 点击穿透，不影响编辑 */
      }
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
