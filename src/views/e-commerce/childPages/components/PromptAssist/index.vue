<script setup lang="ts">
import { computed, ref } from 'vue'

const { placeholder } = defineProps<{ placeholder?: string }>()
const value = defineModel<string>('value', { required: true })

const show = ref(false)

// 将 \n 转为换行符，让 placeholder 支持多行
const placeholderText = computed(() => placeholder?.replace(/\\n/g, '\n'))

const getPrompt = () => {
  if (show.value) return
  show.value = true
  setTimeout(() => (show.value = false), 1000)
}
</script>

<template>
  <div class="prompt-assist">
    <n-spin :show="show">
      <textarea class="textarea-box" v-model="value" maxlength="2000" :placeholder="placeholderText"></textarea>
    </n-spin>

    <div class="bottom-cont">
      <div class="ai-btn" @click="getPrompt">
        <span>AI帮写</span>
      </div>

      <div class="right-cont">
        <span class="text-number">{{ value.length }}/2000</span>
        <i class="icon-ic_ds_Delete1" @click="value = ''"></i>
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
        &:hover {
          opacity: 0.7;
        }
      }
    }
  }
}
</style>
