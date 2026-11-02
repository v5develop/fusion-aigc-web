<script setup lang="ts">
/**
 * 本地生活功能页双栏布局：左参数配置 + 右结果展示。
 *
 * 与电商 childPages 的 Container 同构，但按小岐AI「新锤子风 · 藤紫」材质重做：
 * 主按钮藤紫渐变 + 按下内凹；局部 n-config-provider 把 naive-ui 主色收敛到藤紫
 * （只影响本地生活页，不污染电商/图片等老页面的亮紫 #8e66f9）。
 *
 * 本地生活网关暂无询价接口，按钮上只放生成动作本身。
 */
import { NConfigProvider } from 'naive-ui'
import { llTheme } from '../../theme.ts'

const { title, submit, loading, submitText = '立即生成', showSubmit = true } = defineProps<{
  title: string
  submit?: () => void
  loading?: boolean
  submitText?: string
  showSubmit?: boolean
}>()
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="ll-workbench">
      <div class="form-container">
        <h1 class="title">{{ title }}</h1>
        <div class="content">
          <div class="content-scroll">
            <slot></slot>
          </div>
        </div>
        <button v-if="showSubmit" class="ll-btn-primary generate-btn" :disabled="loading" @click="submit?.()">
          <span>{{ submitText }}</span>
          <n-spin v-show="loading" class="spin" size="small" />
        </button>
      </div>
      <div class="right-container">
        <slot name="right"></slot>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

.ll-workbench {
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
      line-height: 28px;
      font-weight: 700;
      padding: 0 16px 10px 16px;
      border-bottom: 1px solid #e5e7eb;
      color: #1f2329;
      margin: 0;
    }

    > .content {
      flex: 1;
      min-height: 0;
      padding: 0 16px;

      > .content-scroll {
        height: 100%;
        overflow: auto;
        scrollbar-gutter: stable;
        .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
      }
    }

    > .generate-btn {
      height: 44px;
      position: relative;
      margin: 15px 16px 0;
      width: calc(100% - 32px);

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
    background: #f5f6f7;
    .scrollbar(@width: 8px, @trackColor: #f5f6f7, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
  }
}
</style>
