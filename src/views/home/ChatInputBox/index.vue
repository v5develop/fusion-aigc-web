<script setup lang="ts">
import Upload from '@/components/ChatImageUpload/index.vue'

interface IProps {
  showUpload?: boolean
}
const { showUpload=true } = defineProps<IProps>()
const imgList = defineModel<any[]>('imgList')
</script>

<template>
  <div class="chat-content">
    <div class="main-content">
      <div v-if="showUpload" class="upload-cont">
        <Upload v-model:imgList="imgList!" :limitNumber="5" multiple />
      </div>

      <div class="textarea-box" contenteditable data-placeholder="和我聊聊，你想要什么设计。"></div>
    </div>

    <div class="bottom-content">
      <slot name="bottomSelect"></slot>

      <div class="send-cont">
        <i class="icon-ic_hone_bean"></i>
        <span>限免</span>
        <div class="btn">
          <i class="icon-ic_hone_bean"></i>
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
      width: 72px;
      height: 80px;
      flex-shrink: 0;
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
    > .select-cont {
      width: 250px;
      display: flex;
      gap: 12px;
    }
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
        > i {
          font-size: 24px;
          color: white;
        }
      }
    }
  }
}
</style>
