<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui'
import DeviceNoticeHost from '@/components/DeviceNoticeHost'
import BillingGuideHost from '@/components/BillingGuideHost/index.vue'
import TaskNotifier from '@/components/TaskNotifier/index.vue'
// 主题覆盖对齐原型 v3：藤紫 #875F9A、基础字号 13、控件 r4 / 卡片 r8、输入 34 + 3px 焦点环；
// 浅色 / 深色随「外观」偏好（utils/themePrefs）响应式切换，色值与 uno 工具类同出 theme/tokens
import { naiveBaseTheme, naiveThemeOverrides } from '@/theme/naive'
import { activeTheme, overlayContainerClass, overlayTheme } from '@/utils/themePrefs.ts'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { reloadPage, routeLoadFailure } from '@/utils/render-failure'
import { useRoute } from 'vue-router'

// 首次导航就加载失败（布局 chunk 都没取到）时 layout 还没挂上，错误边界够不着，这里直接兜底
const route = useRoute()
const bootFailed = computed(() => !!routeLoadFailure.value && route.matched.length === 0)

const naiveTheme = computed(() => naiveBaseTheme(activeTheme.value))
const themeOverrides = computed(() => naiveThemeOverrides(activeTheme.value))
// 全站浮层（提示消息 / 通知 / 确认框）：全屏调色等深色层开着时一律深色，页面本身仍按站点外观（见 themePrefs.overlayTheme）
const overlayNaiveTheme = computed(() => naiveBaseTheme(overlayTheme.value))
const overlayOverrides = computed(() => naiveThemeOverrides(overlayTheme.value))
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <!-- 浮层 provider 夹在两层主题之间：消息 / 通知 / 对话框取外侧的浮层主题，页面取内侧的站点主题 -->
    <n-config-provider abstract :theme="overlayNaiveTheme" :theme-overrides="overlayOverrides">
    <n-message-provider :max="3" :duration="2500" placement="top" :container-class="overlayContainerClass">
      <!-- 必须在 message-provider 内部：它靠 useMessage() 拿注入 -->
      <DeviceNoticeHost />
      <n-notification-provider placement="bottom-right" :max="3" :container-class="overlayContainerClass">
        <!-- 全站完成提醒：共享轮询任务中心，离开提交页 / 后台标签时提示（见 utils/taskWatcher） -->
        <TaskNotifier />
        <n-dialog-provider>
          <n-config-provider abstract :theme="naiveTheme" :theme-overrides="themeOverrides">
          <!-- 计费引导弹框：n-modal 自带 Teleport，挂这里只是要它常驻在路由之外 -->
          <BillingGuideHost />
          <div v-if="bootFailed" class="h-100vh bg-page">
            <PageLoadError
              title="页面渲染失败"
              :subtitle="routeLoadFailure"
              retryable
              retry-text="重新加载"
              @retry="reloadPage"
            />
          </div>
          <RouterView v-else />
          </n-config-provider>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
    </n-config-provider>
  </n-config-provider>
</template>

<style scoped></style>
