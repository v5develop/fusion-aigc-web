<script setup lang="ts">
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import DeviceNoticeHost from '@/components/DeviceNoticeHost'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    baseColor: 'red',
    primaryColorHover: '#8E66F9',
    primaryColor: '#8E66F9',
  },
  // Button: {
  //   textColor: '#8E66F9',
  // },
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <!-- 必须在 message-provider 内部：它靠 useMessage() 拿注入 -->
      <DeviceNoticeHost />
      <n-dialog-provider>
        <RouterView />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped></style>
