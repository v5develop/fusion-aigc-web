<script setup lang="ts">
/**
 * 路由内容的错误边界：子树渲染 / 生命周期抛错，或路由懒加载失败时，不白屏，改显示「页面渲染失败」。
 * 挂在 layout 的 RouterView 外层，所以侧栏仍可用（点别的入口 = 换路由，错误态随之清掉）。
 * 只兜渲染期错误；接口失败等业务错误仍归各页面自己的 PageLoadError。
 */
import { onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { reloadPage, routeLoadFailure, summarizeError } from '@/utils/render-failure'

const route = useRoute()
const renderError = ref('')

onErrorCaptured((err, _instance, info) => {
  console.error('[render-failure] 页面渲染出错', info, err)
  renderError.value = summarizeError(err)
  // 已处理，不再向上抛给全局 errorHandler（它只会重复打一遍日志）
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
