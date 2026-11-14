<script setup lang="ts">
/**
 * 模板广场（行业版）：GET /api/v1/plaza/templates?industry=…（Go 原生，严格按行业，服务端关键词搜索与分页）。
 * 行业复用智能体页的偏好（useIndustry，同一份本地缓存 / 服务端偏好）：已选直接用，未选就地出行业选择（不跳转）；
 * 匿名可浏览。分类胶囊 = 当前行业的二级细分；图片 / 视频与已加载模板携带的标签作为第二行细分。
 * 卡片复用智能体首页的 TemplateCard 横卡；「做同款」见 ../replicate.ts（图片去智能体页，视频去生成视频页）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { isIndustryGate, plazaErrorText, plazaTemplates } from '@/views/agent/industry/plazaScope.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import TemplateCard from '@/views/agent/TemplateCard.vue'
import IndustryGate from '@/views/agent/industry/IndustryGate.vue'
import { useIndustry } from '@/views/agent/industry/useIndustry.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import { usePagedList } from '../usePagedList.ts'
import { CATS_ROW, SEARCH_INPUT, chipClass, subChipClass } from '../styles.ts'
import { replicateTemplate } from '../replicate.ts'
import PlazaGrid from './PlazaGrid.vue'
import IndustryGateModal from './IndustryGateModal.vue'

defineOptions({ name: 'PlazaTemplatesPanel' })

const PAGE_SIZE = 24
const SUB_LIMIT = 12

const router = useRouter()

const ind = useIndustry()
onMounted(() => void ind.load())

type Media = '' | 'image' | 'video'
const MEDIA: { key: Media; label: string }[] = [
  { key: '', label: '全部类型' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
]
const media = ref<Media>('')
const activeTag = ref('')

// 搜索输入 300ms 防抖后走服务端关键词
const query = ref('')
const keyword = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => (keyword.value = v.trim()), 300)
})
onBeforeUnmount(() => clearTimeout(timer))

const list = usePagedList<IPlazaTemplate>(
  async (page) => {
    const cur = ind.current.value
    if (!cur) return { items: [], hasMore: false }
    try {
      const res = await plazaTemplates({
        industry: cur.code,
        subIndustry: ind.sub.value || undefined,
        mediaType: media.value || undefined,
        keyword: keyword.value || undefined,
        page,
        size: PAGE_SIZE,
      })
      const d = res.data
      return { items: d?.data ?? [], hasMore: (d?.current ?? page) < (d?.pages ?? 0) }
    } catch (err) {
      // 行业失效 / 缺行业：清缓存回行业门；其余按行业版文案提示
      if (isIndustryGate(err)) ind.handleGone()
      throw new Error(plazaErrorText(err))
    }
  },
  { silenced: true },
)
const { items, hasMore, loading, loadingMore, failed, errorMsg, reload, loadMore, onScroll } = list

// 换行业 / 二级 / 类型 / 关键词都从头加载：列表滚回顶部
const scrollEl = ref<HTMLElement | null>(null)
function reloadFromTop() {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  void reload()
}
watch(
  () => [ind.current.value?.code ?? '', ind.sub.value, media.value, keyword.value] as const,
  ([code]) => {
    activeTag.value = ''
    if (code) reloadFromTop()
  },
)

function pickSub(code: string) {
  ind.selectSub(code)
}

function onSelectIndustry(code: string) {
  query.value = ''
  keyword.value = ''
  ind.select(code)
}

/** 已加载模板里出现的标签（排除当前行业二级名），按出现次数降序、同次数按名称排；选中项始终保留 */
const subTags = computed(() => {
  const count = new Map<string, number>()
  for (const t of items.value) for (const tag of t.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1)
  const top = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, SUB_LIMIT)
    .map(([tag]) => tag)
  if (activeTag.value && !top.includes(activeTag.value)) top.push(activeTag.value)
  return top
})

const shown = computed(() =>
  activeTag.value ? items.value.filter((t) => (t.tags ?? []).includes(activeTag.value)) : items.value,
)
const filtering = computed(() => !!(keyword.value || activeTag.value || media.value || ind.sub.value))
const empty = computed(() => !loading.value && !failed.value && !shown.value.length)

function replicate(t: IPlazaTemplate) {
  replicateTemplate(router, t)
}
</script>

<template>
  <div ref="scrollEl" class="h-full overflow-auto px-20px pb-20px" @scroll="onScroll">
    <div class="mx-auto max-w-1180px">
      <template v-if="ind.loading.value || ind.failed.value">
        <IndustryGate :industries="[]" :loading="ind.loading.value" :error="ind.failed.value" @retry="ind.load()" />
      </template>
      <PageEmpty v-else-if="ind.gateOff.value" compact text="模板正在准备中" description="你的行业模板很快会上线，也可以告诉我们你做什么生意" />
      <IndustryGate v-else-if="ind.needGate.value" :industries="ind.industries.value" @select="onSelectIndustry" />
      <template v-else>
      <div class="flex items-center gap-12px pt-4px pb-16px">
        <div :class="CATS_ROW" role="group" aria-label="行业细分">
          <button type="button" :aria-pressed="!ind.sub.value" :class="chipClass(!ind.sub.value)" @click="pickSub('')">
            {{ ind.current.value?.name }}
          </button>
          <button
            v-for="c in ind.children.value"
            :key="c.code"
            type="button"
            :title="c.hint"
            :aria-pressed="ind.sub.value === c.code"
            :class="chipClass(ind.sub.value === c.code)"
            @click="pickSub(c.code)"
          >
            {{ c.name }}
          </button>
        </div>
        <button type="button" class="sx-btn flex-none" @click="ind.gateOpen.value = true">换行业</button>
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

      <div class="-mt-4px mb-16px flex flex-wrap gap-6px" role="group" aria-label="类型与标签细分">
        <button
          v-for="m in MEDIA"
          :key="m.key"
          type="button"
          :aria-pressed="media === m.key"
          :class="subChipClass(media === m.key)"
          @click="media = m.key"
        >
          {{ m.label }}
        </button>
        <template v-if="subTags.length">
          <button type="button" :aria-pressed="!activeTag" :class="subChipClass(!activeTag)" @click="activeTag = ''">
            全部标签
          </button>
          <button
            v-for="s in subTags"
            :key="s"
            type="button"
            :aria-pressed="activeTag === s"
            :class="subChipClass(activeTag === s)"
            @click="activeTag = s"
          >
            {{ s }}
          </button>
        </template>
      </div>

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
          :cta="'一键复刻'"
          @pick="replicate"
        />
      </PlazaGrid>
      </template>
    </div>
    <IndustryGateModal
      v-model:show="ind.gateOpen.value"
      :industries="ind.industries.value"
      :current="ind.current.value?.code"
      @select="onSelectIndustry"
    />
  </div>
</template>
