<script setup lang="ts">
const { title, submit, loading, integral } = defineProps<{
  title: string
  submit: () => void
  loading?: boolean
  integral: number
}>()
</script>

<template>
  <div class="container">
    <div class="form-container">
      <h1 class="title">{{ title }}</h1>

      <div class="content">
        <slot></slot>
      </div>

      <div class="generate-btn" @click="submit">
        <span>立即生成</span>
        <span>{{ integral }}</span>
        <i class="icon-ic_hone_bean"></i>
        <n-spin v-show="loading" class="spin" size="small" />
      </div>
    </div>

    <div class="right-container">
      <slot name="rightContent"></slot>
    </div>
  </div>
</template>

<style scoped lang="less">
.container {
  height: 100%;
  display: flex;
  > .form-container {
    width: 400px;
    flex-shrink: 0;
    padding: 40px 0;
    background-color: white;
    display: flex;
    flex-direction: column;
    > .title {
      font-size: 20px;
      padding: 0 16px 10px 16px;
      border-bottom: 1px solid #f0f0f0;
      font-weight: bold;
      color: #1f1f1f;
      margin: 0;
    }
    > .content {
      flex: 1;
      padding: 0 16px;
      overflow: auto;
    }
    > .generate-btn {
      height: 44px;
      position: relative;
      margin: 15px 16px 0;
      border-radius: 274px;
      display: flex;
      flex-direction: row;
      justify-content: center;
      align-items: center;
      gap: 8px;
      color: white;
      background: linear-gradient(0deg, #bba2ff 0%, #ccbaff 99%);
      cursor: pointer;
      &:hover {
        opacity: 0.9;
      }
      .spin {
        position: absolute;
        top: 50%;
        left: 40%;
        transform: translateY(-50%);
      }
    }
  }

  > .right-container {
    flex: 1;
    height: 100%;
    position: relative;
  }
}
</style>
