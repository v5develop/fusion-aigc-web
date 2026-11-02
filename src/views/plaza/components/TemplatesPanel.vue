<script setup lang="ts">
/**
 * 模板广场：GET /api/v1/plaza-templates/tags 出标签 chip，/list 分页（page/size，信封 current/pages）。
 * 接口无关键词参数，故不设搜索框。卡片不可点：记录里只有 agentSkillId，本项目没有能承接它的路由。
 */
import { onMounted, ref, watch } from 'vue'
import { plazaTemplateList, plazaTemplateTags } from '@/api/plaza.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import { usePagedList } from '../usePagedList.ts'
import { chipClass } from '../styles.ts'
import PlazaCard from './PlazaCard.vue'
import PlazaGrid from './PlazaGrid.vue'

defineOptions({ name: 'PlazaTemplatesPanel' })

const PAGE_SIZE = 20

const tags = ref<string[]>([])
/** 空串 = 全部 */
const activeTag = ref('')

async function loadTags() {
  try {
    const res = await plazaTemplateTags()
    tags.value = res.data ?? []
  } catch {
    // 标签拉失败不挡列表：只剩「全部」
    tags.value = []
  }
}

const list = usePagedList<IPlazaTemplate>(async (page) => {
  const res = await plazaTemplateList({ page, size: PAGE_SIZE, tags: activeTag.value || undefined })
  const d = res.data
  return { items: d?.data ?? [], hasMore: (d?.current ?? page) < (d?.pages ?? 0) }
})
const { items, hasMore, loading, loadingMore, failed, empty, reload, loadMore, onScroll } = list

watch(activeTag, () => void reload())

onMounted(() => {
  void loadTags()
  void reload()
})

const coverOf = (t: IPlazaTemplate) => t.payload?.result?.[0] ?? t.payload?.image_urls?.[0] ?? ''
</script>

<template>
  <div class="h-full overflow-auto px-24px pb-24px" @scroll="onScroll">
    <div class="flex flex-wrap items-center gap-8px pt-8px pb-16px" role="group" aria-label="模板标签">
      <button type="button" :aria-pressed="!activeTag" :class="chipClass(!activeTag)" @click="activeTag = ''">
        全部
      </button>
      <button
        v-for="t in tags"
        :key="t"
        type="button"
        :aria-pressed="activeTag === t"
        :class="chipClass(activeTag === t)"
        @click="activeTag = t"
      >
        {{ t }}
      </button>
    </div>

    <PlazaGrid
      :loading="loading"
      :loading-more="loadingMore"
      :failed="failed"
      :empty="empty"
      :has-more="hasMore"
      empty-text="暂无模板"
      @retry="reload"
      @load-more="loadMore"
    >
      <PlazaCard
        v-for="t in items"
        :key="t.plazaTemplateId"
        :cover="coverOf(t)"
        :title="t.title"
        :desc="t.payload?.description"
        :tags="t.tags"
      />
    </PlazaGrid>
  </div>
</template>
