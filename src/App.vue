<script setup lang="ts">
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import DeviceNoticeHost from '@/components/DeviceNoticeHost'
import BillingGuideHost from '@/components/BillingGuideHost/index.vue'
// 主题覆盖对齐原型 v3：藤紫 #875F9A、基础字号 13、控件 r4 / 卡片 r8、输入 34 + 3px 焦点环
import { themeOverrides } from '@/theme/naive'
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <!-- 必须在 message-provider 内部：它靠 useMessage() 拿注入 -->
      <DeviceNoticeHost />
      <n-dialog-provider>
        <!-- 计费引导弹框：n-modal 自带 Teleport，挂这里只是要它常驻在路由之外 -->
        <BillingGuideHost />
        <RouterView />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped></style>
