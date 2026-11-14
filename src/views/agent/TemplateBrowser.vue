<script setup lang="ts">
/**
 * 智能体首页 · 行业版模板浏览（agent-template-industry DESIGN §7，原型 5185 .ref-tabs / .ref-grid）：
 * 先选行业（首次门 / 点「行业」chip 重开门），再看该行业的三个 Tab：本周头条（默认）/ 图片 / 视频；
 * 有二级的行业在 Tab 下出现细分 chip，选了二级三个 Tab 一起收窄。
 *
 * <p>门通过前不发任何头条 / 列表请求（只请求行业目录与偏好）；没有任何跨行业的「全部」视角。
 * 点卡片 / 头条条目先开预览（桌面对话框、手机底部抽屉），在预览里点「做同款」才 emit pick。
 * 编排只在这里：行业状态见 industry/useIndustry、列表见 TemplateList、头条见 TemplateHeadlines。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NModal } from 'naive-ui'
import { parsePlazaTime, plazaCounts } from '@/api/plaza.ts'
import type { IPlazaCounts, IPlazaMyTemplate, IPlazaTemplate } from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import IndustryBar from './industry/IndustryBar.vue'
import IndustryGate from './industry/IndustryGate.vue'
import { loadFavorites } from './industry/useFavorites.ts'
import { loginVersion, requireLogin } from './industry/useLoginGate.ts'
import { useIndustry } from './industry/useIndustry.ts'
import MyLibraryDrawer from './MyLibraryDrawer.vue'
import NodeStrip from './NodeStrip.vue'
import RecentStrip from './RecentStrip.vue'
import TemplateHeadlines from './TemplateHeadlines.vue'
import TemplateList from './TemplateList.vue'
import TemplatePreviewModal from './TemplatePreviewModal.vue'

defineProps<{ pickedId?: number | null; disabled?: boolean }>()
/** pick 的第二个参数是选中时所在的行业范围（报价 / 示例都要带 industry） */
const emit = defineEmits<{
  pick: [item: IPlazaTemplate, scope: { industry: string; subIndustry?: string }]
  /** 「我的模板」被点：把模板 + 入参 + 版数 + 文字恢复到输入区（不自动发送） */
  restore: [item: IPlazaMyTemplate, scope: { industry: string; subIndustry?: string }]
}>()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const ind = useIndustry()
onMounted(() => void ind.load())

type Tab = 'headline' | 'image' | 'video'
const TAB_KEY = 'fusion_agent_tab'
function readTab(): Tab {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    return v === 'image' || v === 'video' ? v : 'headline'
  } catch {
    return 'headline'
  }
}
const tab = ref<Tab>(readTab())
watch(tab, (t) => {
  try {
    sessionStorage.setItem(TAB_KEY, t)
  } catch {
    // ignore
  }
  query.value = ''
})
const TABS: { key: Tab; label: string }[] = [
  { key: 'headline', label: '本周头条' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
]

const query = ref('')
const industryName = computed(() => ind.current.value?.name ?? '')
const subName = computed(() => ind.children.value.find((c) => c.code === ind.sub.value)?.name ?? '')

// 换行业：清二级与搜索词，保持当前 Tab（二级在 select 里已清）
watch(
  () => ind.current.value?.code,
  () => {
    query.value = ''
    void loadCounts()
  },
)
watch(
  () => ind.sub.value,
  () => void loadCounts(),
)
// 收藏状态（卡片 ♡）：按当前行业取，登录后重取；未登录清空
watch(
  () => [ind.current.value?.code ?? '', loginVersion.value] as const,
  ([code]) => void loadFavorites(code, true),
  { immediate: true },
)

const counts = ref<IPlazaCounts | null>(null)
let countSeq = 0
async function loadCounts() {
  const cur = ind.current.value
  if (!cur) {
    counts.value = null
    return
  }
  const s = ++countSeq
  try {
    const res = await plazaCounts({ industry: cur.code, subIndustry: ind.sub.value || undefined })
    if (s === countSeq) counts.value = res.data ?? null
  } catch {
    if (s === countSeq) counts.value = null
  }
}

function tabCount(t: Tab): number | null {
  if (!counts.value || t === 'headline') return null
  return t === 'image' ? counts.value.image : counts.value.video
}
const otherCount = computed(() =>
  tab.value === 'image' ? (counts.value?.video ?? 0) : tab.value === 'video' ? (counts.value?.image ?? 0) : 0,
)

function onTabKey(e: KeyboardEvent) {
  const i = TABS.findIndex((t) => t.key === tab.value)
  let n = i
  if (e.key === 'ArrowRight') n = (i + 1) % TABS.length
  else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length
  else return
  e.preventDefault()
  tab.value = TABS[n]!.key
  document.getElementById(`agent-home-tab-${tab.value}`)?.focus()
}

// ---- 头条周期说明（T-05） ----
const computedAt = ref<string | null>(null)
const headlineItems = ref<IPlazaTemplate[]>([])
const listItems = ref<IPlazaTemplate[]>([])
const listTotal = ref(0)
const headlineMounted = ref(false)
watch(
  () => tab.value,
  (t) => {
    if (t === 'headline') headlineMounted.value = true
  },
  { immediate: true },
)
const updatedText = computed(() => {
  if (!computedAt.value) return ''
  const mins = Math.round((Date.now() - parsePlazaTime(computedAt.value).getTime()) / 60000)
  return mins <= 0 || Number.isNaN(mins) ? '刚刚更新' : `更新于 ${mins} 分钟前`
})

// ---- 预览 ----
const previewItem = ref<IPlazaTemplate | null>(null)
/** 节点条里的模板（从节点条打开预览时，上一个 / 下一个只在它们之间切） */
const nodeItems = ref<IPlazaTemplate[]>([])
const previewFromNode = ref(false)
const previewSource = computed(() =>
  previewFromNode.value ? nodeItems.value : tab.value === 'headline' ? headlineItems.value : listItems.value,
)
function openPreview(t: IPlazaTemplate) {
  previewFromNode.value = false
  previewItem.value = t
}
function openFromNode(t: IPlazaTemplate) {
  previewFromNode.value = true
  previewItem.value = t
}
// ---- 我的（收藏 / 我的模板）抽屉 ----
const libOpen = ref(false)
function openLibrary() {
  if (!requireLogin('mine')) return
  libOpen.value = true
}
function openFromLibrary(t: IPlazaTemplate) {
  libOpen.value = false
  openPreview(t)
}
function restoreMine(m: IPlazaMyTemplate) {
  libOpen.value = false
  if (curScope.value) emit('restore', m, curScope.value)
}
const previewIndex = computed(() => {
  const id = previewItem.value?.plazaTemplateId
  return previewSource.value.findIndex((t) => t.plazaTemplateId === id)
})
function navPreview(delta: number) {
  const n = previewSource.value[previewIndex.value + delta]
  if (n) previewItem.value = n
}
const curScope = computed(() =>
  ind.current.value ? { industry: ind.current.value.code, subIndustry: ind.sub.value || undefined } : null,
)
function pickFromPreview(t: IPlazaTemplate) {
  previewItem.value = null
  if (curScope.value) emit('pick', t, curScope.value)
}
function pickFromRecent(t: IPlazaTemplate) {
  if (curScope.value) emit('pick', t, curScope.value)
}

function gone() {
  previewItem.value = null
  ind.handleGone()
}

function onSelectIndustry(code: string) {
  ind.select(code)
}

const searchPlaceholder = computed(() =>
  tab.value === 'headline'
    ? '搜索头条'
    : tab.value === 'image'
      ? `搜索${industryName.value}图片模板`
      : `搜索${industryName.value}视频模板`,
)
const resultLabel = computed(() => {
  if (!query.value.trim()) return ''
  if (tab.value === 'headline') return `共 ${headlineItems.value.length} 个模板`
  return `共 ${listTotal.value} 个模板`
})

function tabClass(on: boolean) {
  return [
    'm-0 border-0 bg-transparent px-0 py-5px text-15px leading-22px cursor-pointer select-none whitespace-nowrap',
    '[transition:color_0.12s] motion-reduce:transition-none',
    on ? 'font-600 text-ink' : 'font-500 text-placeholder hover:text-ink-2',
    FOCUS,
  ]
}
</script>

<template>
  <section aria-label="爆款模板" class="relative flex flex-col">
    <!-- 目录加载失败 / 行业整理中 / 首次门：都不发模板请求 -->
    <template v-if="ind.loading.value || ind.failed.value || ind.gateOff.value">
      <IndustryGate
        v-if="ind.loading.value || ind.failed.value"
        :industries="[]"
        :loading="ind.loading.value"
        :error="ind.failed.value"
        @retry="ind.load()"
      />
      <PageEmpty v-else compact text="模板正在准备中" description="你的行业模板很快会上线，也可以告诉我们你做什么生意" />
    </template>

    <template v-else>
      <div class="mb-12px flex flex-wrap items-center gap-x-20px gap-y-8px">
        <button
          type="button"
          class="inline-flex h-32px flex-none items-center gap-6px rounded-16px border border-solid border-soft-line bg-surface px-12px text-12px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:opacity-50"
          :class="FOCUS"
          :disabled="ind.needGate.value"
          :aria-label="`当前行业：${industryName}，点击更换`"
          @click="ind.gateOpen.value = true"
        >
          <span class="text-muted">行业</span>
          <b class="font-600 text-ink">{{ industryName || '请选择' }}</b>
          <svg class="h-10px w-10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div class="flex min-w-0 items-baseline gap-20px overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="内容来源" @keydown="onTabKey">
          <button
            v-for="t in TABS"
            :id="`agent-home-tab-${t.key}`"
            :key="t.key"
            type="button"
            role="tab"
            :aria-controls="`agent-home-panel-${t.key}`"
            :aria-selected="tab === t.key"
            :tabindex="tab === t.key ? 0 : -1"
            :aria-label="tabCount(t.key) != null ? `${t.label}，${tabCount(t.key)} 个` : undefined"
            :disabled="ind.needGate.value"
            :class="tabClass(tab === t.key)"
            @click="tab = t.key"
          >
            {{ t.label }}
            <span v-if="tabCount(t.key) != null" class="ml-2px text-11px font-500 text-placeholder">{{ tabCount(t.key) }}</span>
          </button>
        </div>
        <label class="relative ml-auto block w-240px flex-none max-sm:(ml-0 w-full)">
          <span class="sr-only">搜索模板</span>
          <input
            v-model="query"
            type="search"
            :placeholder="searchPlaceholder"
            :disabled="ind.needGate.value"
            class="box-border h-32px w-full rounded-16px border border-solid border-white/90 bg-[linear-gradient(rgb(var(--xq-surface-rgb)/0.82),rgb(var(--xq-page-rgb)/0.64))] pl-14px pr-32px text-12px text-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)] outline-none placeholder:text-placeholder focus:(border-violet shadow-focus)"
          />
          <svg class="pointer-events-none absolute right-10px top-9px h-14px w-14px text-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </label>
        <button
          type="button"
          class="inline-flex h-32px flex-none items-center gap-6px rounded-16px border border-solid border-soft-line bg-surface px-12px text-12px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:opacity-50"
          :class="FOCUS"
          :disabled="ind.needGate.value"
          aria-label="我的：收藏与我的模板"
          data-testid="plaza-my-entry"
          @click="openLibrary"
        >
          <svg class="h-12px w-12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>
          我的
        </button>
      </div>

      <IndustryBar v-if="ind.current.value && !ind.needGate.value" :industry="ind.current.value" :sub="ind.sub.value" @select="ind.selectSub" />

      <p v-if="query.trim()" class="m-0 -mt-4px mb-12px text-11px leading-16px text-placeholder">
        仅搜索「{{ industryName }}」· {{ resultLabel }}
      </p>
      <p v-else-if="tab === 'headline' && !ind.needGate.value" class="m-0 -mt-4px mb-12px text-12px leading-18px text-placeholder">
        同行近 7 天都在做什么<template v-if="updatedText"> · {{ updatedText }}</template>
      </p>
      <span class="sr-only" aria-live="polite">{{ resultLabel }}</span>

      <!-- 接着做：所有 Tab 顶部，登录后、有历史才出现（严格当前行业） -->
      <RecentStrip
        v-if="ind.current.value && !ind.needGate.value && !query.trim()"
        :industry="ind.current.value.code"
        :sub="ind.sub.value"
        :picked-id="pickedId"
        :disabled="disabled"
        @pick="pickFromRecent"
      />

      <!-- 首次门：磨砂层盖在静态骨架上（不是真数据，不发请求） -->
      <div v-if="ind.needGate.value" class="relative min-h-420px">
        <div class="pointer-events-none grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-14px" aria-hidden="true" inert>
          <div v-for="n in 6" :key="n" class="sx-soft h-148px rounded-18px opacity-70" />
        </div>
        <div class="gate-glass absolute inset-0 z-2 overflow-y-auto">
          <IndustryGate :industries="ind.industries.value" @select="onSelectIndustry" />
        </div>
      </div>

      <template v-else-if="ind.current.value">
        <div
          v-if="headlineMounted"
          v-show="tab === 'headline'"
          id="agent-home-panel-headline"
          role="tabpanel"
          aria-labelledby="agent-home-tab-headline"
        >
          <NodeStrip
            v-if="!query.trim()"
            :industry="ind.current.value.code"
            :industry-name="industryName"
            @loaded="nodeItems = $event"
            @open="openFromNode"
          />
          <TemplateHeadlines
            :industry="ind.current.value.code"
            :industry-name="industryName"
            :sub="ind.sub.value"
            :keyword="tab === 'headline' ? query : ''"
            :picked-id="pickedId"
            :disabled="disabled"
            @open="openPreview"
            @loaded="(v) => ((headlineItems = v?.items ?? []), (computedAt = v?.computedAt ?? null))"
            @gone="gone"
            @switch-tab="tab = $event"
          />
        </div>
        <div
          v-if="tab !== 'headline'"
          :id="`agent-home-panel-${tab}`"
          role="tabpanel"
          :aria-labelledby="`agent-home-tab-${tab}`"
        >
          <TemplateList
            :industry="ind.current.value.code"
            :industry-name="industryName"
            :sub="ind.sub.value"
            :sub-name="subName"
            :media-type="tab"
            :keyword="query"
            :other-count="otherCount"
            :picked-id="pickedId"
            :disabled="disabled"
            @open="openPreview"
            @loaded="(items, total) => ((listItems = items), (listTotal = total))"
            @gone="gone"
            @switch-tab="tab = $event"
            @clear-search="query = ''"
            @clear-sub="ind.selectSub('')"
          />
        </div>
      </template>
    </template>

    <!-- 重开门：对话框，Esc / × / 遮罩都能关 -->
    <NModal
      :show="ind.gateOpen.value"
      :auto-focus="false"
      trap-focus
      @update:show="(v: boolean) => (ind.gateOpen.value = v)"
    >
      <div class="sx-squircle relative w-[min(640px,94vw)] rounded-20px border border-solid border-soft-line bg-surface shadow-pop" role="dialog" aria-label="换个行业">
        <button
          type="button"
          class="absolute right-8px top-8px z-3 grid h-44px w-44px place-items-center rounded-full border-0 bg-transparent text-ink-2 cursor-pointer hover:text-ink"
          :class="FOCUS"
          aria-label="关闭"
          @click="ind.gateOpen.value = false"
        >
          <svg class="h-16px w-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <IndustryGate
          dismissible
          :industries="ind.industries.value"
          :current="ind.current.value?.code"
          @select="onSelectIndustry"
          @close="ind.gateOpen.value = false"
        />
      </div>
    </NModal>

    <MyLibraryDrawer
      :show="libOpen"
      :industry="ind.current.value?.code ?? ''"
      :industry-name="industryName"
      @close="libOpen = false"
      @open="openFromLibrary"
      @restore="restoreMine"
    />

    <TemplatePreviewModal
      :item="previewItem"
      :index="previewIndex >= 0 ? previewIndex : undefined"
      :total="previewSource.length"
      :scope="curScope"
      :disabled="disabled"
      @close="previewItem = null"
      @nav="navPreview"
      @pick="pickFromPreview"
    />
  </section>
</template>

<style scoped>
/* 磨砂层：只模糊、不加色；不支持 backdrop-filter 时用近不透明的页面底色顶上 */
.gate-glass {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
@supports not (backdrop-filter: blur(1px)) {
  .gate-glass {
    background: rgb(var(--xq-page-rgb) / 0.92);
  }
}
</style>
