<script setup lang="ts">
/** 广场卡片网格外壳：加载 / 空态 / 失败重试 / 加载更多（样式同资产库列表） */
defineProps<{
  loading: boolean
  loadingMore: boolean
  failed: boolean
  empty: boolean
  hasMore: boolean
  emptyText: string
}>()

const emit = defineEmits<{ retry: []; 'load-more': [] }>()

const LINK =
  'p-0 border-none bg-transparent text-13px text-violet-ink cursor-pointer hover:text-violet-press focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <div
    v-loading="loading"
    class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-16px min-h-240px"
  >
    <slot />
    <div
      v-if="failed && !loading"
      class="col-span-full flex items-center justify-center gap-6px h-360px text-13px text-muted"
      role="alert"
    >
      加载失败
      <button type="button" :class="LINK" @click="emit('retry')">重试</button>
    </div>
    <div v-else-if="empty" class="col-span-full flex items-center justify-center h-360px text-13px text-muted">
      {{ emptyText }}
    </div>
  </div>

  <div v-if="hasMore || loadingMore" class="text-center pt-16px pb-4px">
    <button type="button" :class="LINK" :disabled="loadingMore" @click="emit('load-more')">
      {{ loadingMore ? '加载中…' : '加载更多' }}
    </button>
  </div>
</template>
