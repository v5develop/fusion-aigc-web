<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import Navigation from '@/views/layout/Navigation/index.vue'
import ECommerceTabs from '@/views/e-commerce/Tabs/index.vue'
import { useEcTabsStore } from '@/stores/e-commerce/tabs'

const route = useRoute()
const tabsStore = useEcTabsStore()
const { cachedNames } = storeToRefs(tabsStore)

const isECommerce = computed(() => route.path.startsWith('/e-commerce'))

// 标签由路由驱动而非点击驱动：卡片点击、URL 直达（刷新/容器初始地址）、浏览器前进后退
// 全都自动开出标签，入口代码一行都不用改
watch(
  () => route.name,
  (name) => {
    if (!isECommerce.value || !name || name === 'e-commerce') return
    tabsStore.openTab({
      name: String(name),
      title: (route.meta?.title as string) ?? String(name),
      path: route.path,
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="layout">
    <div class="navigation-content">
      <Navigation />
    </div>

    <div class="container">
      <ECommerceTabs v-if="isECommerce" />

      <!-- keep-alive 刻意挂在 layout 这层而不是电商子布局：挂在子布局里的话，点左侧导航去
           「图片」会连子布局一起卸载，缓存的功能页全被销毁。include 只列已打开的电商功能页，
           其它模块页面不进缓存，行为与改造前一致 -->
      <RouterView v-slot="{ Component }">
        <keep-alive :include="cachedNames">
          <component :is="Component" />
        </keep-alive>
      </RouterView>
    </div>
  </div>
</template>

<style scoped lang="less">
.layout {
  display: flex;

  > .navigation-content {
    flex-shrink: 0;
  }

  > .container {
    flex: 1;
    background: #f5f6f8;
    position: relative;
    // flex 项默认 min-width:auto，会被内容的最小宽度顶住。标签开满时标签条会把容器
    // 撑到视口之外（实测 14 个标签 → 容器 1604px、整页横向溢出 484px），
    // 归零后多余的标签才会落到标签条自己的横向滚动里
    min-width: 0;
  }
}
</style>
