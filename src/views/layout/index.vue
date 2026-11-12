<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import Navigation from '@/views/layout/Navigation/index.vue'
import ECommerceTabs from '@/views/e-commerce/Tabs/index.vue'
import { sessionKeyOf, useEcTabsStore } from '@/stores/e-commerce/tabs'
import { useSessionIdStore } from '@/stores/e-commerce'
import RouteErrorBoundary from '@/components/RouteErrorBoundary/index.vue'
import { useRouteStagger } from '@/utils/composables/useRouteStagger'

const route = useRoute()
const router = useRouter()
const tabsStore = useEcTabsStore()
const { cachedNames, tabs } = storeToRefs(tabsStore)

const isECommerce = computed(() => route.path.startsWith('/e-commerce'))
// 电商首页不进标签、不进缓存
const isFunctionPage = computed(() => isECommerce.value && route.name !== 'e-commerce')

// 标签列表是持久化的，但 sessionIdMap 里可能还留着上次关标签/异常退出时没清掉的会话。
// 开机对一次账，只保留还有主的
useSessionIdStore().pruneSessionIds(new Set(tabs.value.map(sessionKeyOf)))

// keep-alive 的缓存键。KeepAlive 的缓存 map 以 vnode.key 为键（没有 key 才回退到组件类型），
// 所以同一个功能页组件靠不同的 key 就能缓存多个独立实例 —— 这是同类目多开的支点。
// 非电商页保持 undefined，行为与改造前一致
const cacheKey = computed(() =>
  isFunctionPage.value && route.query.tab ? `${String(route.name)}#${route.query.tab}` : undefined,
)

// 路由三拍转场：只在 AI 图片 / AI 视频 / 工具页之间互切时做；其它跳转保持直接替换（无任何过渡）。
// 记前一个路径要用同步 watcher：转场的开关在新路由渲染那一刻就要读到「从哪来」
const previousPath = ref('')
watch(
  () => route.path,
  (_to, from) => {
    previousPath.value = from
  },
  { flush: 'sync' },
)
const isStaggerPage = (path: string) => path === '/image' || path === '/video' || path.startsWith('/tools/')
const staggerActive = computed(() => isStaggerPage(route.path) && isStaggerPage(previousPath.value))
const routeMotion = useRouteStagger(staggerActive, { selector: '.tool-split > *' })
// 转场开着时按路径给 key：同一个工具页组件切不同工具（路由参数变）也要走一遍进出场；关着时保持原来的缓存键
const viewKey = computed(() => (routeMotion.css.value ? route.path : cacheKey.value))

// 标签由路由驱动而非点击驱动：卡片点击、URL 直达（刷新/容器初始地址）、浏览器前进后退
// 全都自动开出标签。
// 盯 fullPath 而不是 name —— 同类目切标签时 name 不变，只有 query.tab 变，盯 name 会漏掉
watch(
  () => route.fullPath,
  () => {
    if (!isFunctionPage.value) return

    const tabId = route.query.tab
    // URL 上没有实例 id（直达/刷新/历史记录）：补一个再走。
    // isFunctionPage 之外的路径不会进来，这里的 replace 补完 id 就不会再次命中，不会自循环
    if (!tabId) {
      router.replace({ name: route.name!, query: { ...route.query, tab: tabsStore.nextTabId() } })
      return
    }

    tabsStore.openTab({
      id: String(tabId),
      name: String(route.name),
      title: (route.meta?.title as string) ?? String(route.name),
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex">
    <div class="flex-shrink-0">
      <Navigation />
    </div>

    <!-- min-w-0：flex 项默认 min-width:auto，会被内容的最小宽度顶住。标签开满时标签条会把容器
         撑到视口之外（实测 14 个标签 → 容器 1604px、整页横向溢出 484px），
         归零后多余的标签才会落到标签条自己的横向滚动里。页面底 #f5f6f7（原型 --sx-page） -->
    <div class="relative min-w-0 flex-1 bg-page">
      <ECommerceTabs v-if="isECommerce" />

      <!-- keep-alive 刻意挂在 layout 这层而不是电商子布局：挂在子布局里的话，点左侧导航去
           「图片」会连子布局一起卸载，缓存的功能页全被销毁。include 只列已打开的电商功能页，
           其它模块页面不进缓存，行为与改造前一致 -->
      <RouteErrorBoundary>
        <RouterView v-slot="{ Component }">
          <Transition
            :name="routeMotion.name.value"
            :css="routeMotion.css.value"
            :duration="routeMotion.duration.value"
            @enter="routeMotion.onEnter"
            @after-enter="routeMotion.onAfter"
            @after-leave="routeMotion.onAfter"
          >
            <keep-alive :include="cachedNames">
              <component :is="Component" :key="viewKey" />
            </keep-alive>
          </Transition>
        </RouterView>
      </RouteErrorBoundary>
    </div>
  </div>
</template>
