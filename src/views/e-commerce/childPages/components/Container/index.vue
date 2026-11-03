<script setup lang="ts">
/**
 * 电商功能页外壳（对齐原型工具页 ToolWorkspaceColumns ml 版，规范 §6 / §7.3）：
 * 三栏 `460 / 224 / 1fr`、gap 16、页面内边距 16。
 * - 左栏一张白板（r8、line 描边、面板投影），分三段：功能卡 64（外缘 12，#e9dff2 描边，白→#fbf7fe）/
 *   操作区（板内唯一滚动区，`pt12 px12 pb14`，不再套卡）/ 页脚（设置行 + 提交按钮，`0 12 12`，上沿细线）。
 * - 中栏历史（HistoryColumn）：本标签会话里的每一批生成一张历史卡，点一张在右栏看它的产物。
 * - 右栏结果：有记录时放 RecordList（只展示选中的那一批），否则放功能介绍（Sample）。
 *
 * <p>高度扣掉电商标签条（48px），否则会把 body 顶出滚动条。
 * 提交按钮用共用的 CreationActionBar（整宽藤紫渐变，第二行写本次消耗）；询价中 / 询价失败写在第二行。
 */
import { computed, onDeactivated, provide, ref, useId, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import CreationActionBar from '@/components/creation/CreationActionBar.vue'
import HistoryColumn from '../HistoryColumn/index.vue'
import { ecEntryByName } from '@/views/e-commerce/entries'
import { EC_SELECTED_TASK_KEY } from '../HistoryColumn/selection'

const { title, submit, loading, integral, quoteStatus } = defineProps<{
  title: string
  submit: () => void
  loading?: boolean
  /** 本次生成所需点数；询价未返回时为 null */
  integral: number | null
  /** 询价状态：loading 显示「正在计算消耗」、error 显示「消耗获取失败」 */
  quoteStatus?: 'loading' | 'success' | 'error'
}>()

const rootRef = useTemplateRef<HTMLElement>('root')
const titleId = `ec-title-${useId()}`

// 功能卡缩略图：与电商首页入口卡片同源（按路由 name 取）。keep-alive 缓存期间全局 route 会变，只在 setup 读一次
const thumb = ecEntryByName[String(useRoute().name)]?.url ?? ''

// 中栏历史卡与右栏结果共用的「当前选中批次」
provide(EC_SELECTED_TASK_KEY, ref<string | null>(null))

// 询价未返回时不能把「未知」显示成 0 点数
const costText = computed(() => {
  if (quoteStatus === 'loading') return '正在计算消耗…'
  if (quoteStatus === 'error') return '消耗获取失败'
  return `消耗 ${integral ?? '--'} 点数`
})

// 被 keep-alive 缓存的标签切走后组件不卸载，正在播的视频会继续出声。
// deactivated 会向整棵子树传播，Container 包住了全部 14 个功能页的内容，在这一处收口即可
onDeactivated(() => {
  rootRef.value?.querySelectorAll('video').forEach((video) => video.pause())
})
</script>

<template>
  <div
    ref="root"
    class="grid grid-cols-[460px_224px_minmax(0,1fr)] gap-16px h-[calc(100vh-48px)] p-16px box-border bg-page"
  >
    <section
      class="flex flex-col min-h-0 bg-white rounded-lg border border-solid border-line shadow-panel overflow-hidden"
      :aria-labelledby="titleId"
    >
      <!-- 段一：功能卡（原型 FunctionSwitcher）：高 64、外缘 12、内边距 12 14、gap 12；缩略图 56×40；名称 15/20 -->
      <header
        class="flex-none flex items-center gap-12px h-64px mx-12px mt-12px px-14px box-border rounded-lg border border-solid border-#e9dff2 bg-gradient-to-b from-white to-#fbf7fe"
      >
        <img
          v-if="thumb"
          class="flex-none block w-56px h-40px rounded-md object-cover bg-surface3"
          :src="thumb"
          alt=""
        />
        <h1 :id="titleId" class="m-0 min-w-0 truncate sx-title-tool">{{ title }}</h1>
        <slot name="titleExtra"></slot>
      </header>

      <!-- 段二：操作区，板内唯一滚动区；始终预留滚动条宽度，内容由不溢出变为溢出时不会挤窄 -->
      <div
        class="flex-1 min-h-0 overflow-auto pt-12px px-12px pb-14px [scrollbar-gutter:stable] [scrollbar-width:thin]"
      >
        <slot></slot>
      </div>

      <!-- 段三：页脚（设置行 44 + 提交按钮 56，间距 8） -->
      <footer class="flex-none flex flex-col gap-8px px-12px pt-12px pb-12px border-t border-solid border-line-soft">
        <slot name="settings"></slot>
        <CreationActionBar label="立即生成" :cost-text="costText" :loading="loading" @submit="submit" />
      </footer>
    </section>

    <HistoryColumn :title="title" />

    <section
      class="relative min-w-0 h-full overflow-auto bg-white rounded-lg border border-solid border-line shadow-panel [scrollbar-width:thin]"
      aria-label="生成结果"
    >
      <slot name="rightContent"></slot>
    </section>
  </div>
</template>
