<script setup lang="ts">
/**
 * 智能体首页 · 模板浏览（原型 5185 AgentView .ref-filters / .ref-grid）：
 * 分类 chip 来自 GET /api/v1/plaza-templates/tags（「全部」+ 标签，后端多标签取并集，这里只传单个），
 * 列表 GET /api/v1/plaza-templates/list 分页（v1 信封 current / pages），点「加载更多」续页。
 *
 * <p>搜索：接口没有关键词参数，只在<b>已加载</b>的模板里按标题 / 说明 / 标签过滤；还有下一页时给出提示。
 * 原型的二级细分 chip 依赖行业 → 细分的两级结构，广场标签是平铺的，故不做。
 *
 * <p>「模板 / 本周头条」两个 Tab 共用分类 chip 与搜索框；本周头条见 TemplateHeadlines（服务端过滤，搜的是全部头条），
 * 首次切过去才挂载，之后切回来保留状态。两边选中都走同一个 pick 事件。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { plazaTemplateList, plazaTemplateTags } from '@/api/plaza.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import TemplateCard from './TemplateCard.vue'
import TemplateHeadlines from './TemplateHeadlines.vue'

defineProps<{ pickedId?: number | null; disabled?: boolean }>()
const emit = defineEmits<{ pick: [item: IPlazaTemplate] }>()

const PAGE_SIZE = 24
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

type HomeTab = 'templates' | 'headlines'
const tab = ref<HomeTab>('templates')
const headlinesMounted = ref(false)
watch(tab, (t) => {
  if (t === 'headlines') headlinesMounted.value = true
})

/** 头条统计窗口 → 「第 N 周 · MM.DD – MM.DD」 */
const period = ref<{ statsFrom: string; statsTo: string } | null>(null)
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}
const periodHint = computed(() => {
  const p = period.value
  if (!p?.statsFrom || !p?.statsTo) return ''
  const [fy, fm, fd] = p.statsFrom.split('-').map(Number)
  const [ty, tm, td] = p.statsTo.split('-').map(Number)
  if (!fy || !fm || !fd || !ty || !tm || !td) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `第 ${isoWeek(new Date(ty, tm - 1, td))} 周 · ${pad(fm)}.${pad(fd)} – ${pad(tm)}.${pad(td)}`
})

function tabClass(on: boolean) {
  return [
    // 文字高 22，上下各 5 补到 32（可点区域 ≥32）
    'm-0 border-0 bg-transparent px-0 py-5px text-15px leading-22px cursor-pointer select-none',
    '[transition:color_0.12s] motion-reduce:transition-none',
    on ? 'font-600 text-ink' : 'font-500 text-placeholder hover:text-ink-2',
    FOCUS,
  ]
}

const tags = ref<string[]>([])
/** 空串 = 全部 */
const activeTag = ref('')
const query = ref('')

async function loadTags() {
  try {
    const res = await plazaTemplateTags()
    tags.value = res.data ?? []
  } catch {
    // 标签拉失败不挡列表：只剩「全部」
    tags.value = []
  }
}

const items = ref<IPlazaTemplate[]>([])
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const failed = ref(false)
const failMsg = ref('')
const moreFailed = ref(false)
let seq = 0

async function fetchPage(next: number) {
  const s = seq
  const res = await plazaTemplateList({ page: next, size: PAGE_SIZE, tags: activeTag.value || undefined })
  if (s !== seq) return
  const d = res.data
  const rows = d?.data ?? []
  if (next === 1) {
    items.value = rows
  } else {
    const seen = new Set(items.value.map((t) => t.plazaTemplateId))
    items.value.push(...rows.filter((t) => !seen.has(t.plazaTemplateId)))
  }
  page.value = next
  hasMore.value = (d?.current ?? next) < (d?.pages ?? 0)
}

async function reload() {
  seq++
  loading.value = true
  loadingMore.value = false
  failed.value = false
  failMsg.value = ''
  moreFailed.value = false
  const s = seq
  try {
    await fetchPage(1)
  } catch (err) {
    if (s === seq) {
      failed.value = true
      failMsg.value = err instanceof Error ? err.message : ''
      items.value = []
      hasMore.value = false
    }
  } finally {
    if (s === seq) loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  moreFailed.value = false
  const s = seq
  try {
    await fetchPage(page.value + 1)
  } catch {
    if (s === seq) moreFailed.value = true
  } finally {
    if (s === seq) loadingMore.value = false
  }
}

watch(activeTag, () => void reload())

onMounted(() => {
  void loadTags()
  void reload()
})

function textOf(t: IPlazaTemplate): string {
  const d = t.payload?.description
  return [t.title, typeof d === 'string' ? d : '', ...(t.tags ?? [])].join(' ').toLowerCase()
}

const keyword = computed(() => query.value.trim().toLowerCase())
const shown = computed(() =>
  keyword.value ? items.value.filter((t) => textOf(t).includes(keyword.value)) : items.value,
)

function chipClass(on: boolean) {
  return [
    'flex-none h-32px px-15px rounded-6px border border-solid text-12px whitespace-nowrap cursor-pointer select-none',
    '[transition:border-color_0.12s,background_0.12s,color_0.12s] motion-reduce:transition-none',
    on
      ? 'border-#dcc9e9 bg-[linear-gradient(#fff,#faf4fd)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] font-600 text-violet-ink'
      : 'border-white/90 bg-[linear-gradient(rgba(255,255,255,0.82),rgba(246,246,247,0.64))] text-muted hover:(border-#aeb4b9 text-ink)',
    FOCUS,
  ]
}
</script>

<template>
  <section aria-label="爆款模板" class="flex flex-col">
    <div class="mb-12px flex items-baseline gap-20px" role="tablist" aria-label="内容来源">
      <button
        id="agent-home-tab-templates"
        type="button"
        role="tab"
        aria-controls="agent-home-panel-templates"
        :aria-selected="tab === 'templates'"
        :class="tabClass(tab === 'templates')"
        @click="tab = 'templates'"
      >
        模板
      </button>
      <button
        id="agent-home-tab-headlines"
        type="button"
        role="tab"
        aria-controls="agent-home-panel-headlines"
        :aria-selected="tab === 'headlines'"
        :class="tabClass(tab === 'headlines')"
        @click="tab = 'headlines'"
      >
        本周头条
      </button>
      <span v-if="tab === 'headlines' && periodHint" class="text-12px leading-18px text-placeholder">{{
        periodHint
      }}</span>
    </div>
    <div class="mb-16px flex items-center gap-12px">
      <div
        class="flex min-w-0 flex-1 gap-8px overflow-x-auto py-2px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="模板分类"
      >
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
      <label class="relative block w-240px flex-none">
        <span class="sr-only">搜索模板</span>
        <input
          v-model="query"
          type="search"
          :placeholder="tab === 'headlines' ? '搜索模板' : '搜索已加载的模板'"
          class="box-border h-32px w-full rounded-16px border border-solid border-white/90 bg-[linear-gradient(rgba(255,255,255,0.82),rgba(246,246,247,0.64))] pl-14px pr-32px text-12px text-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)] outline-none placeholder:text-placeholder focus:(border-violet shadow-focus)"
        />
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
      v-if="headlinesMounted"
      v-show="tab === 'headlines'"
      id="agent-home-panel-headlines"
      role="tabpanel"
      aria-labelledby="agent-home-tab-headlines"
    >
      <TemplateHeadlines
        :tag="activeTag"
        :keyword="query"
        :picked-id="pickedId"
        :disabled="disabled"
        @pick="emit('pick', $event)"
        @period="period = $event"
      />
    </div>

    <div
      v-show="tab === 'templates'"
      id="agent-home-panel-templates"
      role="tabpanel"
      aria-labelledby="agent-home-tab-templates"
    >
      <p v-if="keyword && hasMore" class="m-0 -mt-8px mb-12px text-11px leading-16px text-placeholder">
        只在已加载的 {{ items.length }} 个模板中搜索，加载更多可扩大范围
      </p>

      <div v-if="loading" class="flex justify-center py-40px"><n-spin size="small" /></div>
      <PageLoadError
        v-else-if="failed"
        compact
        :subtitle="failMsg || '模板加载失败，请稍后重试'"
        retryable
        @retry="reload"
      />
      <PageEmpty
        v-else-if="!items.length"
        compact
        text="暂无模板"
        :description="activeTag ? '这个分类下还没有模板，换个分类看看' : '运营上架模板后会出现在这里'"
      />
      <template v-else>
        <PageEmpty v-if="!shown.length" compact text="没有匹配的模板" description="换个分类或关键词试试" />
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-14px">
          <TemplateCard
            v-for="t in shown"
            :key="t.plazaTemplateId"
            :item="t"
            :picked="pickedId === t.plazaTemplateId"
            :disabled="disabled"
            @pick="emit('pick', $event)"
          />
        </div>
        <div v-if="hasMore || moreFailed" class="mt-16px flex flex-col items-center gap-6px">
          <p v-if="moreFailed" class="m-0 text-12px text-danger" role="alert">加载失败，请重试</p>
          <button type="button" class="sx-btn" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? '加载中…' : moreFailed ? '重试' : '加载更多' }}
          </button>
        </div>
      </template>
    </div>
  </section>
</template>
