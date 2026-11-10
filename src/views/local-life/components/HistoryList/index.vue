<script setup lang="ts">
/**
 * Workbench 三栏模式的历史列内容（原型 StudioHistoryColumn ml 版，规范 §10.3）。放进 Workbench 的 `#history` 插槽：
 *
 *   <template #history>
 *     <HistoryList :count="listCtl.total.value" :running="runningCount" :loading="listCtl.loading.value"
 *                  :has-more="listCtl.hasMore.value" :loading-more="listCtl.loadingMore.value" @load-more="listCtl.loadMore()">
 *       <HistoryCard v-for="item in listCtl.items.value" :key="item.id" ... />
 *     </HistoryList>
 *   </template>
 *
 * <p>只管列头（CreationHistoryHeader：标题 + 进行中 + 条数）、加载中 / 空态、列表滚动与「加载更多」；
 * 数据、轮询、删除等动作仍由页面自己的 useLLList 负责。
 * 列表布局：≥1440 是 224 宽的单列；<1440 历史铺满右栏，按最小 240 自动排成多列网格（卡片同一套 74 高规格）。
 *
 * <p>插槽：
 * - default：HistoryCard 列表；
 * - #extra（选填）：紧贴列头下方的一行，放提醒胶囊（如图文笔记「N 条待确认」）；224 宽列头放不下第二个胶囊，所以单独一行。不填不占位。
 */
import { useId } from 'vue'
import CreationHistoryHeader from '@/components/Creation/CreationHistoryHeader.vue'

const {
  count,
  running = 0,
  loading = false,
  hasMore = false,
  loadingMore = false,
  title = '历史记录',
  emptyHint = '左边填好内容、点底部按钮提交，每次生成都会在这一列留一条；点一条就能在右边看它的产物',
} = defineProps<{
  /** 总条数（列头显示；为 0 且不在加载时显示空态） */
  count: number
  /** 进行中的条数 */
  running?: number
  /** 首屏加载中 */
  loading?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  title?: string
  emptyHint?: string
}>()

const emit = defineEmits<{ loadMore: [] }>()
defineSlots<{ default?: () => unknown; extra?: () => unknown }>()

const titleId = `ll-history-title-${useId()}`
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col" role="group" :aria-labelledby="titleId">
    <CreationHistoryHeader :title="title" :title-id="titleId" :count="count" :running="running" />
    <div v-if="$slots.extra" class="flex-none flex flex-wrap items-center gap-6px -mt-2px px-12px pb-8px">
      <slot name="extra"></slot>
    </div>

    <p v-if="loading && !count" class="m-0 py-18px text-center text-11px leading-[1.55] text-muted" role="status">
      加载中…
    </p>

    <!-- 空态：至少一张历史卡大小（高 65）：虚线浅底卡 + 28 圆底时钟（16），标题 13/600/18、说明 11/15（同电商 HistoryColumn） -->
    <div
      v-else-if="!count"
      class="flex-none flex items-center gap-8px min-h-65px mx-12px p-10px box-border rounded-lg border border-dashed border-line-strong bg-gradient-to-b from-white to-surface2"
    >
      <span
        class="flex-none grid place-items-center w-28px h-28px box-border rounded-full border border-solid border-line bg-white text-violet-ink"
        aria-hidden="true"
      >
        <svg
          class="w-16px h-16px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      </span>
      <span class="min-w-0 flex-1 flex flex-col gap-1px">
        <b class="text-13px font-600 leading-18px text-ink-2">还没有生成记录</b>
        <span class="text-11px leading-15px text-muted">{{ emptyHint }}</span>
      </span>
    </div>

    <!-- 滚动区会裁掉越界的焦点环（sx-focus 外扩 4px）：左右靠 12 内边距兜住，顶部用 -mt-2px pt-4px 留出 4px 又不改变卡片位置 -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-12px -mt-2px pt-4px pb-10px [scrollbar-width:thin]">
      <ul
        class="m-0 p-0 list-none grid gap-8px grid-cols-[repeat(auto-fill,minmax(240px,1fr))] content-start wide:(flex flex-col)"
      >
        <slot></slot>
      </ul>
      <button
        v-if="hasMore"
        type="button"
        class="mt-8px w-full sx-btn-ghost !text-violet-ink"
        :disabled="loadingMore"
        :aria-busy="loadingMore || undefined"
        @click="emit('loadMore')"
      >
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>
