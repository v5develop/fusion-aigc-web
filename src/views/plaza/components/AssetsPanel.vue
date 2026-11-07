<script setup lang="ts">
/**
 * 素材广场：GET /api/v1/asset/public/display/categories?platform=PC 出两级分类，
 * /api/v1/asset/public/display 分页（platform 必传；page/pageSize，信封 list/total/page/pageSize）。
 * 卡片不跳转；图片条目点封面用 n-image 预览大图，视频条目只展示封面帧。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { publicDisplayCategories, publicDisplayFeed } from '@/api/plaza.ts'
import type { IDisplayCategory, IFeedItem } from '@/api/types'
import { usePagedList } from '../usePagedList.ts'
import { CATS_ROW, chipClass, subChipClass } from '../styles.ts'
import PlazaCard from './PlazaCard.vue'
import PlazaGrid from './PlazaGrid.vue'

defineOptions({ name: 'PlazaAssetsPanel' })

const PLATFORM = 'PC'
const PAGE_SIZE = 20

const categories = ref<IDisplayCategory[]>([])
/** null = 全部 */
const activeL1 = ref<number | null>(null)
const activeL2 = ref<number | null>(null)
const subCategories = computed(() => categories.value.find((c) => c.id === activeL1.value)?.children ?? [])

async function loadCategories() {
  try {
    const res = await publicDisplayCategories(PLATFORM)
    categories.value = res.data ?? []
  } catch {
    // 分类拉失败不挡列表：只剩「全部」
    categories.value = []
  }
}

function pickL1(id: number | null) {
  activeL1.value = id
  activeL2.value = null
}

const list = usePagedList<IFeedItem>(async (page) => {
  const res = await publicDisplayFeed({
    platform: PLATFORM,
    categoryL1Id: activeL1.value ?? undefined,
    categoryL2Id: activeL2.value ?? undefined,
    page,
    pageSize: PAGE_SIZE,
  })
  const d = res.data
  // 源失效条目会被剔除，本页条数可能小于 pageSize，翻页按 total 判断
  return { items: d?.list ?? [], hasMore: page * PAGE_SIZE < (d?.total ?? 0) }
})
const { items, hasMore, loading, loadingMore, failed, empty, reload, loadMore, onScroll } = list

watch([activeL1, activeL2], () => void reload())

onMounted(() => {
  void loadCategories()
  void reload()
})

const categoryName = (id: number | null) => (id == null ? '' : categories.value.find((c) => c.id === id)?.categoryName)
const previewOf = (a: IFeedItem) => (a.mediaType === 'image' ? a.urls?.[0] || a.coverUrl || '' : '')
</script>

<template>
  <div class="h-full overflow-auto px-20px pb-20px" @scroll="onScroll">
    <div class="mx-auto max-w-1180px">
      <div class="flex flex-col gap-12px pt-4px pb-16px">
        <div :class="CATS_ROW" role="group" aria-label="素材分类">
          <button
            type="button"
            :aria-pressed="activeL1 == null"
            :class="chipClass(activeL1 == null)"
            @click="pickL1(null)"
          >
            全部
          </button>
          <button
            v-for="c in categories"
            :key="c.id"
            type="button"
            :aria-pressed="activeL1 === c.id"
            :class="chipClass(activeL1 === c.id)"
            @click="pickL1(c.id)"
          >
            {{ c.categoryName }}
          </button>
        </div>
        <div
          v-if="subCategories.length"
          class="-mt-4px flex flex-wrap items-center gap-6px"
          role="group"
          aria-label="子分类"
        >
          <button
            type="button"
            :aria-pressed="activeL2 == null"
            :class="subChipClass(activeL2 == null)"
            @click="activeL2 = null"
          >
            全部
          </button>
          <button
            v-for="c in subCategories"
            :key="c.id"
            type="button"
            :aria-pressed="activeL2 === c.id"
            :class="subChipClass(activeL2 === c.id)"
            @click="activeL2 = c.id"
          >
            {{ c.categoryName }}
          </button>
        </div>
      </div>

      <PlazaGrid
        :loading="loading"
        :loading-more="loadingMore"
        :failed="failed"
        :empty="empty"
        :has-more="hasMore"
        :empty-text="activeL1 == null ? '暂无素材' : '这个分类下还没有素材，换个分类试试'"
        @retry="reload"
        @load-more="loadMore"
      >
        <PlazaCard
          v-for="a in items"
          :key="a.id"
          :cover="a.coverUrl"
          :preview-src="previewOf(a)"
          :title="a.title"
          :badge="categoryName(a.categoryL1Id)"
          :is-video="a.mediaType === 'video'"
        />
      </PlazaGrid>
    </div>
  </div>
</template>
