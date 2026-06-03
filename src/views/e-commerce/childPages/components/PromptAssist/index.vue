<script setup lang="ts">
import { ref } from 'vue'

const prompt = defineModel<string>('prompt', { required: true })

const show = ref(false)

const getPrompt = () => {
  if (show.value) return;
  show.value = true;
  setTimeout(() => show.value = false, 1000)
}
</script>

<template>
  <div class="prompt-assist">
    <n-spin :show="show">
      <textarea class="textarea-box" v-model="prompt" maxlength="2000" placeholder="请输入商品信息包括:商品名称、商品描述、商品尺寸、目标受众、商品卖点。您也可以在上传多视角商品图后点击【A帮写】一键分析"></textarea>
    </n-spin>

    <div class="bottom-cont">
      <div class="ai-btn" @click="getPrompt">
        <span>AI帮写</span>
      </div>

      <div class="right-cont">
        <span class="text-number">{{ prompt.length }}/2000</span>
        <i class="icon-ic_ds_Delete1" @click="prompt=''"></i>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.prompt-assist {
  height: 192px;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  .textarea-box {
    width: 100%;
    height: 120px;
    outline: none;
    border: none;
    resize: none;
  }
  > .bottom-cont {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    > .ai-btn {
      width: 69px;
      height: 28px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--main-color);
      background: linear-gradient(116deg, #f0ebff -7%, #e8e4ff 84%);
      cursor: pointer;
    }
    > .right-cont {
      display: flex;
      align-items: center;
      gap: 6px;
      > .text-number {
        color: #9e9e9e;
      }
      > .icon-ic_ds_Delete1 {
        cursor: pointer;
        &:hover{
          opacity: .7;
        }
      }
    }
  }
}
</style>
