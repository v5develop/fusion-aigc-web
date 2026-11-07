<script setup lang="ts">
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'

/** 广场卡片网格外壳：加载 / 空态 / 失败重试 / 加载更多；列数由 gridClass 决定（模板横卡 3 列、素材竖卡多列） */
withDefaults(
  defineProps<{
    loading: boolean
    loadingMore: boolean
    failed: boolean
    empty: boolean
    hasMore: boolean
    emptyText: string
    emptyDescription?: string
    gridClass?: string
  }>(),
  {
    emptyDescription: '',
    gridClass: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-14px',
  },
)

const emit = defineEmits<{ retry: []; 'load-more': [] }>()
</script>

<template>
  <div v-loading="loading" :class="['grid min-h-240px', gridClass]">
    <slot />
    <div v-if="failed && !loading" class="col-span-full py-24px">
      <PageLoadError compact retryable @retry="emit('retry')" />
    </div>
    <div v-else-if="empty" class="col-span-full py-24px">
      <PageEmpty compact :text="emptyText" :description="emptyDescription" />
    </div>
  </div>

  <div v-if="hasMore || loadingMore" class="flex justify-center pt-16px pb-4px">
    <button type="button" class="sx-btn" :disabled="loadingMore" @click="emit('load-more')">
      {{ loadingMore ? '加载中…' : '加载更多' }}
    </button>
  </div>
</template>
