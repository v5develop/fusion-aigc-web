<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import DeviceNoticeHost from '@/components/DeviceNoticeHost'
import BillingGuideHost from '@/components/BillingGuideHost/index.vue'
import TaskNotifier from '@/components/TaskNotifier/index.vue'
// 主题覆盖对齐原型 v3：藤紫 #875F9A、基础字号 13、控件 r4 / 卡片 r8、输入 34 + 3px 焦点环；
// 浅色 / 深色随「外观」偏好（utils/themePrefs）响应式切换，色值与 uno 工具类同出 theme/tokens
import { naiveBaseTheme, naiveThemeOverrides } from '@/theme/naive'
import { activeTheme } from '@/utils/themePrefs.ts'

const naiveTheme = computed(() => naiveBaseTheme(activeTheme.value))
const themeOverrides = computed(() => naiveThemeOverrides(activeTheme.value))
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider :max="3" :duration="2500" placement="top">
      <!-- 必须在 message-provider 内部：它靠 useMessage() 拿注入 -->
      <DeviceNoticeHost />
      <n-notification-provider placement="bottom-right" :max="3">
        <!-- 全站完成提醒：共享轮询任务中心，离开提交页 / 后台标签时提示（见 utils/taskWatcher） -->
        <TaskNotifier />
        <n-dialog-provider>
          <!-- 计费引导弹框：n-modal 自带 Teleport，挂这里只是要它常驻在路由之外 -->
          <BillingGuideHost />
          <RouterView />
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped></style>
