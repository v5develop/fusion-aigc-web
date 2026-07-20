<script setup lang="ts">
const { title, submit, loading, integral, quoteStatus } = defineProps<{
  title: string
  submit: () => void
  loading?: boolean
  /** 本次生成所需金豆；询价未返回时为 null */
  integral: number | null
  /** 询价状态：loading 转圈、error 显示「获取失败」 */
  quoteStatus?: 'loading' | 'success' | 'error'
}>()
</script>

<template>
  <div class="container">
    <div class="form-container">
      <h1 class="title">
        <span>{{ title }}</span>
        <slot name="titleExtra"></slot>
      </h1>

      <div class="content">
        <div class="content-scroll">
          <slot></slot>
        </div>
      </div>

      <div class="generate-btn" @click="submit">
        <span>立即生成</span>
        <!-- 询价未返回时转圈，避免把「未知」显示成 0 金豆 -->
        <n-spin v-if="quoteStatus === 'loading'" class="quote-spin" size="small" />
        <span v-else-if="quoteStatus === 'error'">获取失败</span>
        <template v-else>
          <span>{{ integral }}</span>
          <i class="icon-ic_hone_bean"></i>
        </template>
        <n-spin v-show="loading" class="spin" size="small" />
      </div>
    </div>

    <div class="right-container">
      <slot name="rightContent"></slot>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';
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
      display: flex;
      align-items: center;
      gap: 8px;
    }
    > .content {
      flex: 1;
      min-height: 0;
      padding: 0 16px;
      > .content-scroll {
        height: 100%;
        overflow: auto;
        /* 始终预留滚动条宽度。自定义 ::-webkit-scrollbar 后 Chrome 会用「占位」而非「浮层」滚动条，
           内容加载后由不溢出变为溢出时会挤窄内容、造成宽度突变；stable 让这段宽度恒定保留 */
        scrollbar-gutter: stable;
        .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
      }
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
    overflow: auto;
    .scrollbar(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
  }
}
</style>
