<script setup lang="ts">
/**
 * 路由内容的错误边界：子树渲染 / 生命周期抛错，或路由懒加载失败时，不白屏，改显示「页面渲染失败」。
 * 挂在 layout 的 RouterView 外层，所以侧栏仍可用（点别的入口 = 换路由，错误态随之清掉）。
 * 只兜渲染期错误；接口失败等业务错误仍归各页面自己的 PageLoadError。
 */
import { getCurrentInstance, onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { reloadPage, routeLoadFailure, summarizeError } from '@/utils/render-failure'

const route = useRoute()
const renderError = ref('')

// Vue 的 ErrorTypeStrings：只有这些说明「这棵子树画不出来了」，才值得整页接管。
// 事件处理 / watcher / scheduler / 异步非挂载钩子等的错误页面本身还能用，不能因此把整页换成报错
const RENDER_PHASE_INFO = new Set([
  'render function',
  'setup function',
  'component update',
  'beforeCreate hook',
  'created hook',
  'beforeMount hook',
  'mounted hook',
])
const appErrorHandler = getCurrentInstance()?.appContext.config.errorHandler

onErrorCaptured((err, instance, info) => {
  console.error('[render-failure] 页面出错', info, err)
  if (!RENDER_PHASE_INFO.has(info)) return // 不接管：继续向上冒泡到全局 errorHandler
  renderError.value = summarizeError(err)
  // 返回 false 会吞掉冒泡，所以手动转给全局 errorHandler，保证监控仍能看到
  try {
    appErrorHandler?.(err, instance, info)
  } catch (e) {
    console.error('[render-failure] 全局 errorHandler 自身出错', e)
  }
  return false
})

// 换路由 = 给用户一次新机会
watch(
  () => route.fullPath,
  () => {
    renderError.value = ''
  },
)
</script>

<template>
  <div v-if="renderError || routeLoadFailure" class="h-100vh">
    <PageLoadError
      title="页面渲染失败"
      :subtitle="renderError || routeLoadFailure"
      retryable
      retry-text="重新加载"
      @retry="reloadPage"
    />
  </div>
  <slot v-else />
</template>
