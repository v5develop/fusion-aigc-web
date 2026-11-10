<script setup lang="ts">
/**
 * 模板广场：GET /api/v1/plaza-templates/tags 出分类胶囊，/list 分页（page/size，信封 current/pages）。
 * 卡片复用智能体首页的 TemplateCard 横卡；有 agentSkillId 的悬停出「一键复刻」，点击跳
 * /agent?plazaTemplateId=<id>，由智能体页走与首页模板浏览同一条选中路径（切技能 + 预填）。
 *
 * <p>搜索 / 细分只在<b>已加载</b>的模板里过滤：/plaza-templates/list 是 creaft v1 兼容口，
 * 线上入参以 v1 为准不加参数，故没有后端关键词。还有下一页时给出提示。
 * 细分 chip = 选中分类下已加载模板携带的其它标签（广场标签是平铺的，没有行业 → 细分两级结构）。
 * 使用次数 / 排名：接口不下发，不展示。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { plazaTemplateList, plazaTemplateTags, stashPlazaTemplate } from '@/api/plaza.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import TemplateCard from '@/views/agent/TemplateCard.vue'
import { usePagedList } from '../usePagedList.ts'
import { CATS_ROW, SEARCH_INPUT, chipClass, subChipClass } from '../styles.ts'
import PlazaGrid from './PlazaGrid.vue'

defineOptions({ name: 'PlazaTemplatesPanel' })

const PAGE_SIZE = 24
const SUB_LIMIT = 12

const router = useRouter()

const tags = ref<string[]>([])
/** 空串 = 全部 */
const activeTag = ref('')
const activeSub = ref('')

async function loadTags() {
  try {
    const res = await plazaTemplateTags()
    tags.value = res.data ?? []
  } catch {
    // 标签拉失败不挡列表：只剩「全部」
    tags.value = []
  }
}

const list = usePagedList<IPlazaTemplate>(
  async (page) => {
    const res = await plazaTemplateList({ page, size: PAGE_SIZE, tags: activeTag.value || undefined })
    const d = res.data
    return { items: d?.data ?? [], hasMore: (d?.current ?? page) < (d?.pages ?? 0) }
  },
  { silenced: true },
)
const { items, hasMore, loading, loadingMore, failed, errorMsg, reload, loadMore, onScroll } = list

function pickTag(t: string) {
  activeTag.value = t
  activeSub.value = ''
}

// 换分类 / 重试都从头加载：列表滚回顶部，否则停在旧位置像是没刷新、还可能立刻触发加载更多
const scrollEl = ref<HTMLElement | null>(null)
function reloadFromTop() {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  void reload()
}
watch(activeTag, reloadFromTop)

// 搜索输入 300ms 防抖后才参与过滤
const query = ref('')
const keyword = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => (keyword.value = v.trim().toLowerCase()), 300)
})
onBeforeUnmount(() => clearTimeout(timer))

onMounted(() => {
  void loadTags()
  void reload()
})

/**
 * 细分：选中分类后，已加载模板里出现的其它标签，按出现次数降序、同次数按名称排（顺序稳定，加载更多时不乱跳）。
 * 当前选中的细分始终留在列表里——加载更多后它可能掉出前 SUB_LIMIT，不能让选中项凭空消失。
 */
const subTags = computed(() => {
  if (!activeTag.value) return []
  const count = new Map<string, number>()
  for (const t of items.value) {
    for (const tag of t.tags ?? []) {
      if (tag !== activeTag.value) count.set(tag, (count.get(tag) ?? 0) + 1)
    }
  }
  const top = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, SUB_LIMIT)
    .map(([tag]) => tag)
  if (activeSub.value && !top.includes(activeSub.value)) top.push(activeSub.value)
  return top
})

function textOf(t: IPlazaTemplate): string {
  const d = t.payload?.description
  return [t.title, typeof d === 'string' ? d : '', ...(t.tags ?? [])].join(' ').toLowerCase()
}

const shown = computed(() =>
  items.value.filter(
    (t) =>
      (!activeSub.value || (t.tags ?? []).includes(activeSub.value)) &&
      (!keyword.value || textOf(t).includes(keyword.value)),
  ),
)
const localFiltering = computed(() => !!(keyword.value || activeSub.value))
const filtering = computed(() => localFiltering.value || !!activeTag.value)
const empty = computed(() => !loading.value && !failed.value && !shown.value.length)

function replicate(t: IPlazaTemplate) {
  if (!t.agentSkillId) return
  stashPlazaTemplate(t)
  void router.push({ name: 'agent', query: { plazaTemplateId: String(t.plazaTemplateId) } })
}
</script>

<template>
  <div ref="scrollEl" class="h-full overflow-auto px-20px pb-20px" @scroll="onScroll">
    <div class="mx-auto max-w-1180px">
      <div class="flex items-center gap-12px pt-4px pb-16px">
        <div :class="CATS_ROW" role="group" aria-label="模板分类">
          <button type="button" :aria-pressed="!activeTag" :class="chipClass(!activeTag)" @click="pickTag('')">
            全部
          </button>
          <button
            v-for="t in tags"
            :key="t"
            type="button"
            :aria-pressed="activeTag === t"
            :class="chipClass(activeTag === t)"
            @click="pickTag(t)"
          >
            {{ t }}
          </button>
        </div>
        <label class="relative block w-240px flex-none">
          <span class="sr-only">搜索模板</span>
          <input v-model="query" type="search" placeholder="搜索模板" :class="SEARCH_INPUT" />
          <svg
            class="pointer-events-none absolute right-10px top-9px h-14px w-14px text-placeholder"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </label>
      </div>

      <div
        v-if="subTags.length"
        class="-mt-4px mb-16px flex flex-wrap gap-6px"
        role="group"
        :aria-label="`${activeTag} 细分`"
      >
        <button type="button" :aria-pressed="!activeSub" :class="subChipClass(!activeSub)" @click="activeSub = ''">
          全部
        </button>
        <button
          v-for="s in subTags"
          :key="s"
          type="button"
          :aria-pressed="activeSub === s"
          :class="subChipClass(activeSub === s)"
          @click="activeSub = s"
        >
          {{ s }}
        </button>
      </div>

      <p v-if="localFiltering && hasMore" class="m-0 -mt-8px mb-12px text-11px leading-16px text-placeholder">
        只在已加载的 {{ items.length }} 个模板中筛选，加载更多可扩大范围
      </p>

      <PlazaGrid
        :loading="loading"
        :loading-more="loadingMore"
        :failed="failed"
        :error-text="errorMsg"
        :empty="empty"
        :has-more="hasMore"
        :empty-text="filtering ? '没有匹配的模板，换个分类或词试试' : '暂无模板'"
        grid-class="grid-cols-3 gap-14px [@media(max-width:1280px)]:grid-cols-2 [@media(max-width:640px)]:grid-cols-1"
        @retry="reloadFromTop"
        @load-more="loadMore"
      >
        <TemplateCard
          v-for="t in shown"
          :key="t.plazaTemplateId"
          :item="t"
          :cta="t.agentSkillId ? '一键复刻' : false"
          @pick="replicate"
        />
      </PlazaGrid>
    </div>
  </div>
</template>
