<script setup lang="ts">
/**
 * 本地生活功能页双栏布局：左参数配置 + 右结果展示。
 *
 * 版式与工具页（views/tools/index.vue）同一套：页面 bg-page + 16px 外边距与栏间距，
 * 左栏是白底面板卡（ll-card：圆角 10、细描边、面板短投影），标题 16/600，底部藤紫主按钮；
 * 右栏透明落在页面底色上，由各页自己放白底记录卡。
 * 局部 n-config-provider 把 naive-ui 主色收敛到藤紫（只影响本地生活页）。
 *
 * 本地生活网关暂无询价接口，按钮上只放生成动作本身。
 */
import { NConfigProvider, NSpin } from 'naive-ui'
import { llTheme } from '../../theme.ts'

const {
  title,
  submit,
  loading,
  submitText = '立即生成',
  showSubmit = true,
} = defineProps<{
  title: string
  submit?: () => void
  loading?: boolean
  submitText?: string
  showSubmit?: boolean
}>()
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="h-full min-h-0 flex gap-16px box-border p-16px bg-page text-ink">
      <section class="ll-card w-400px flex-none min-h-0 flex flex-col overflow-hidden" :aria-label="title">
        <h1
          class="m-0 flex-none px-16px pt-14px pb-12px border-b border-b-solid border-b-line text-16px font-600 leading-22px text-ink"
        >
          {{ title }}
        </h1>
        <div class="flex-1 min-h-0 overflow-y-auto px-16px pt-14px pb-4px [scrollbar-gutter:stable]">
          <slot></slot>
        </div>
        <div v-if="showSubmit" class="flex-none px-16px pt-12px pb-16px border-t border-t-solid border-t-line">
          <button
            type="button"
            class="ll-btn-primary w-full h-44px !rounded-10px outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
            :disabled="loading"
            :aria-busy="loading || undefined"
            @click="submit?.()"
          >
            <n-spin v-show="loading" size="small" />
            <span>{{ submitText }}</span>
          </button>
        </div>
      </section>
      <section class="relative flex-1 min-w-0 min-h-0 overflow-auto">
        <slot name="right"></slot>
      </section>
    </div>
  </n-config-provider>
</template>
