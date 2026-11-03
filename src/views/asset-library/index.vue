<script setup lang="ts">
/**
 * 资产库增强：Java 素材库（/api/v1/asset）之上的增强视图（Go 网关 /api/v1/asset-library）。
 * 分类条计数 / 筛选 / 收藏 / 标签（批量打标签 + 标签管理）/ 版本与相关资产详情。
 * 素材本身的新增删除仍走素材库，本页只做增强展示与编目。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NButton, NConfigProvider, NSelect, NSwitch, useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import { assetLibCategories, assetLibList, assetLibUpdate } from '@/api/assetLibrary.ts'
import type { AssetLibKindGroup, IAssetLibAsset, IAssetLibCategory, IAssetLibListParams } from '@/api/assetLibrary.ts'
import { useDebounce } from '@/utils/hooks'
import AssetCard from './components/AssetCard.vue'
import DetailModal from './components/DetailModal.vue'
import TagManagerModal from './components/TagManagerModal.vue'
import BatchTagModal from './components/BatchTagModal.vue'

defineOptions({ name: 'asset-library' })

const message = useMessage()

// ---------------- 分类条 ----------------

const KIND_LABELS: Record<string, string> = {
  all: '全部',
  model: '模特',
  scene: '场景',
  makeup: '妆造',
  hair: '发型',
  accessory: '配饰',
  uncategorized: '其他分类',
}
const kindLabel = (key: string) => KIND_LABELS[key] ?? key

/** 「创作素材」大类下的二级（现有 5 个 kind） */
const IMAGE_KINDS = [
  { key: 'model', label: '模特' },
  { key: 'scene', label: '场景' },
  { key: 'makeup', label: '妆造' },
  { key: 'hair', label: '发型' },
  { key: 'accessory', label: '配饰' },
]
/**
 * 「AI生视频」大类下的二级。唯一来源：后端 kind_group=video 的键表（model.VideoKinds）与此一一对应。
 * 视频资产怎么归到这些分类还没定数据来源：分类接口暂不返回这些键，计数按 0 显示。
 */
const VIDEO_KINDS = [
  { key: 'viral_video', label: '爆款视频' },
  { key: 'video_remake', label: '视频复刻' },
  { key: 'promo_video', label: '带货视频' },
  { key: 'digital_human', label: '数字人' },
  { key: 'digital_human_talk', label: '数字人口播' },
  { key: 'store_visit', label: '探店视频' },
  { key: 'promo_drama', label: '带货短剧' },
  { key: 'motion_transfer', label: '动作迁移' },
  { key: 'canvas_video', label: '画布视频' },
  { key: 'video_other', label: '其他' },
]
for (const k of [...IMAGE_KINDS, ...VIDEO_KINDS]) KIND_LABELS[k.key] ??= k.label

type GroupKey = 'all' | AssetLibKindGroup | 'uncategorized'
/** 一级大类；children 为二级，没有二级的大类直接按自身筛选 */
const GROUPS: { key: GroupKey; label: string; children: { key: string; label: string }[] }[] = [
  { key: 'all', label: '全部', children: [] },
  { key: 'image', label: '创作素材', children: IMAGE_KINDS },
  { key: 'video', label: 'AI生视频', children: VIDEO_KINDS },
  { key: 'uncategorized', label: '其他分类', children: [] },
]

const categories = ref<IAssetLibCategory[]>([])
const activeGroup = ref<GroupKey>('all')
/** 选中的二级 kind；空 = 只按大类 */
const activeKind = ref('')

const countOf = (key: string) => categories.value.find((c) => c.key === key)?.count ?? 0
/** 一级计数：全部 / 其他分类取接口原值，有二级的大类 = 二级计数之和（前端相加） */
const groupItems = computed(() =>
  GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    count: g.children.length ? g.children.reduce((n, c) => n + countOf(c.key), 0) : countOf(g.key),
  })),
)
const subItems = computed(() =>
  (GROUPS.find((g) => g.key === activeGroup.value)?.children ?? []).map((c) => ({ ...c, count: countOf(c.key) })),
)

function selectGroup(key: GroupKey) {
  activeGroup.value = key
  activeKind.value = ''
}
/** 再点一次已选的二级则取消，回到大类 */
function selectSub(key: string) {
  activeKind.value = activeKind.value === key ? '' : key
}

/** 列表的分类参数：二级 → kind；有二级的大类 → kind_group；其他分类 → kind=uncategorized */
function categoryParams(): Pick<IAssetLibListParams, 'kind' | 'kind_group'> {
  if (activeKind.value) return { kind: activeKind.value }
  if (activeGroup.value === 'image' || activeGroup.value === 'video') return { kind_group: activeGroup.value }
  if (activeGroup.value === 'uncategorized') return { kind: 'uncategorized' }
  return {}
}

async function loadCategories() {
  try {
    const res = await assetLibCategories({
      source: filters.source || undefined,
      media: filters.media || undefined,
    })
    categories.value = res.data?.items ?? []
  } catch {
    // 分类条拉失败不挡列表：pill 置空，下次换筛选会重试
    categories.value = []
  }
}

// ---------------- 筛选 ----------------

const SOURCE_OPTIONS = [
  { label: '全部来源', value: '' },
  { label: '我的素材', value: 'input' }, // input = official + upload
  { label: 'AI 生成', value: 'generated' },
  { label: '官方', value: 'official' },
  { label: '上传', value: 'upload' },
]

const filters = reactive({
  source: '',
  media: '',
  favorite_only: false,
  q: '',
  tag: '',
  aspect_ratio: '',
})

/** 比例（素材的 aspect_ratio 精确匹配） */
const RATIO_OPTIONS = [
  { label: '全部', value: '' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
]

// 页头范围 / 类型切换（原型：输入资产 / 生成结果；图片 / 视频）：再点一次取消，回到「全部」
const SCOPE_TABS = [
  { label: '输入资产', value: 'input' },
  { label: '生成结果', value: 'generated' },
]
const MEDIA_TABS = [
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
]
function toggleSource(v: string) {
  filters.source = filters.source === v ? '' : v
}
function toggleMedia(v: string) {
  filters.media = filters.media === v ? '' : v
}

const filterOpen = ref(false)
const activeFilterCount = computed(
  () => (filters.source ? 1 : 0) + (filters.favorite_only ? 1 : 0) + (filters.aspect_ratio ? 1 : 0),
)
/** 当前来源 / 类型下的资产总数（分类条「全部」计数） */
const allCount = computed(() => countOf('all'))

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const TAB_CLS =
  'inline-flex items-center h-28px px-10px rounded-6px border-none bg-transparent text-12px cursor-pointer ' + FOCUS
const TOOL_CLS =
  'inline-flex items-center gap-6px h-34px px-10px rounded-8px border border-solid border-line bg-white text-13px font-500 text-ink-2 cursor-pointer whitespace-nowrap hover:border-line-strong ' +
  FOCUS

/** 空态文案（原型） */
const emptyCopy = computed(() => {
  if (filters.source === 'generated')
    return { title: '还没有生成结果', desc: '在画布里执行模型节点，成功后会自动出现在这里。' }
  if (filters.media === 'video')
    return { title: '没有匹配的视频资产', desc: '输入资产里还没有视频；画布生成的视频在「生成结果」范围。' }
  return { title: '没有匹配的素材', desc: '换个关键词，或从画布生成后再回来。' }
})

// ---------------- 列表 ----------------

const PAGE_SIZE = 20

const items = ref<IAssetLibAsset[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = computed(() => items.value.length < total.value)

async function loadPage(p: number): Promise<IAssetLibAsset[]> {
  const res = await assetLibList({
    ...categoryParams(),
    source: filters.source || undefined,
    media: filters.media || undefined,
    aspect_ratio: filters.aspect_ratio || undefined,
    tag: filters.tag || undefined,
    favorite_only: filters.favorite_only || undefined,
    q: filters.q || undefined,
    page: p,
    page_size: PAGE_SIZE,
  })
  total.value = res.data?.total ?? 0
  return res.data?.items ?? []
}

/** 首屏 / 筛选变化：回到第 1 页，多选状态一并清掉 */
async function reload() {
  loading.value = true
  try {
    items.value = await loadPage(1)
    page.value = 1
    selectedIds.value = []
  } finally {
    loading.value = false
  }
}

/** 触底 / 按钮加载下一页 */
async function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    items.value.push(...(await loadPage(next)))
    page.value = next
  } finally {
    loadingMore.value = false
  }
}

/**
 * 静默刷新已加载的全部分页（变更后的同步）：各页并发拉取后原样拼接，
 * 不打乱用户已看到的顺序，也不动筛选与多选。
 */
async function silentRefresh() {
  if (!page.value) return
  const pages = await Promise.all(Array.from({ length: page.value }, (_, i) => loadPage(i + 1)))
  items.value = pages.flat()
}

// 筛选变化：分类条计数随 source / media 变，列表重查
watch(
  () => [filters.source, filters.media, filters.favorite_only, filters.tag],
  () => {
    void loadCategories()
    void reload()
  },
)
// 比例不影响分类计数，只重查列表
watch([activeGroup, activeKind, () => filters.aspect_ratio], () => {
  void reload()
})
useDebounce({ data: () => filters.q, callback: () => void reload() })

onMounted(() => {
  void loadCategories()
  void reload()
})

// 触底加载：滚动容器距底 240px 内预取下一页
const scroller = ref<HTMLElement | null>(null)
function onScroll() {
  const el = scroller.value
  if (!el || loading.value || loadingMore.value || !hasMore.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) void loadMore()
}

// ---------------- 收藏（即点即存，静默成功） ----------------

async function toggleFavorite(asset: IAssetLibAsset) {
  const next = !asset.favorite
  try {
    await assetLibUpdate(asset.id, { favorite: next })
  } catch {
    return // 失败 toast 已由请求层弹出
  }
  asset.favorite = next
  // 只看收藏时，取消收藏的卡就地移出，计数跟着走
  if (!next && filters.favorite_only) {
    items.value = items.value.filter((i) => i.id !== asset.id)
    total.value = Math.max(0, total.value - 1)
  }
}

// ---------------- 多选与批量打标签 ----------------

const selectedIds = ref<number[]>([])

function toggleSelect(id: number) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}

/** 选择本页：勾选当前已加载的全部资产（批量打标签上限仍在 openBatchTag 校验） */
function selectPage() {
  selectedIds.value = items.value.map((i) => i.id)
}

const showBatchTag = ref(false)

function openBatchTag() {
  if (!selectedIds.value.length) return
  if (selectedIds.value.length > 100) {
    message.warning('一次最多给 100 个资产打标签')
    return
  }
  showBatchTag.value = true
}

function onBatchTagged() {
  selectedIds.value = []
  void silentRefresh()
}

// ---------------- 标签管理 / 详情 ----------------

const showTagManager = ref(false)

/** 标签重命名/删除会影响卡片上的标签名；若删掉的正被用作筛选，清掉筛选 */
function onTagsChanged(deletedName?: string) {
  if (deletedName && filters.tag === deletedName) {
    filters.tag = '' // watch 会触发整页重查
    return
  }
  void silentRefresh()
}

const detailId = ref<number | null>(null)

function openDetail(asset: IAssetLibAsset) {
  detailId.value = asset.id
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="h-full flex flex-col bg-page text-ink">
      <header class="flex items-center gap-8px shrink-0 px-20px py-14px bg-white border-b border-b-solid border-line">
        <h1 class="sr-only">资产</h1>
        <span class="grid text-muted" aria-hidden="true">
          <svg
            class="w-20px h-20px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          >
            <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
          </svg>
        </span>
        <label
          class="flex items-center gap-6px w-230px h-30px ml-14px px-10px rounded-6px border border-solid border-line bg-surface2 text-placeholder focus-within:(border-violet-line bg-white)"
        >
          <svg
            class="w-14px h-14px shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            v-model="filters.q"
            type="search"
            aria-label="搜索资产"
            placeholder="搜索资产"
            class="min-w-0 flex-1 border-none outline-none bg-transparent text-12px text-ink placeholder:text-placeholder"
          />
        </label>
        <div
          class="flex gap-2px p-2px ml-6px rounded-8px border border-solid border-line bg-surface2"
          role="group"
          aria-label="资产范围"
        >
          <button
            v-for="s in SCOPE_TABS"
            :key="s.value"
            type="button"
            :aria-pressed="filters.source === s.value"
            :class="[
              TAB_CLS,
              filters.source === s.value ? 'bg-violet-soft text-violet-ink' : 'text-muted hover:text-ink',
            ]"
            @click="toggleSource(s.value)"
          >
            {{ s.label }}
            <span v-if="filters.source === s.value" class="ml-6px text-11px">{{ allCount }}</span>
          </button>
        </div>
        <div class="flex gap-8px ml-auto" role="group" aria-label="资产类型">
          <button
            v-for="m in MEDIA_TABS"
            :key="m.value"
            type="button"
            :aria-pressed="filters.media === m.value"
            :class="[
              'inline-flex items-center gap-6px min-w-82px h-34px px-14px rounded-8px border border-solid text-14px font-500 cursor-pointer',
              filters.media === m.value
                ? 'bg-violet-soft border-violet-line text-violet-ink'
                : 'bg-transparent border-transparent text-muted hover:text-ink',
              FOCUS,
            ]"
            @click="toggleMedia(m.value)"
          >
            {{ m.label }}
          </button>
        </div>
      </header>

      <div ref="scroller" class="flex-1 min-h-0 overflow-auto px-20px pb-32px" @scroll="onScroll">
        <div class="flex items-start gap-12px pt-20px pb-16px">
          <div class="flex flex-col gap-8px min-w-0">
            <div class="flex flex-wrap items-center gap-8px">
              <button
                v-for="g in groupItems"
                :key="g.key"
                type="button"
                :aria-pressed="activeGroup === g.key"
                :class="[
                  'inline-flex items-center gap-6px h-34px px-10px rounded-8px border border-solid text-13px font-500 cursor-pointer',
                  activeGroup === g.key
                    ? 'bg-violet-soft border-violet-line text-violet-ink'
                    : 'bg-white border-line text-ink-2 hover:border-line-strong',
                  FOCUS,
                ]"
                @click="selectGroup(g.key)"
              >
                {{ g.label }}
                <span
                  class="px-5px py-1px rounded-4px text-10px"
                  :class="activeGroup === g.key ? 'bg-white/70 text-violet-ink' : 'bg-surface3 text-muted'"
                  >{{ g.count }}</span
                >
              </button>
              <button
                v-if="filters.tag"
                type="button"
                :class="[
                  'inline-flex items-center gap-4px h-34px px-10px rounded-8px border border-solid border-violet-line bg-info-soft text-13px text-violet-ink cursor-pointer',
                  FOCUS,
                ]"
                title="点击清除"
                @click="filters.tag = ''"
              >
                标签：{{ filters.tag }} ×
              </button>
            </div>
            <div
              v-if="subItems.length"
              class="flex flex-wrap items-center gap-8px pl-12px"
              role="group"
              :aria-label="`${groupItems.find((g) => g.key === activeGroup)?.label ?? ''}二级分类`"
            >
              <button
                v-for="c in subItems"
                :key="c.key"
                type="button"
                :aria-pressed="activeKind === c.key"
                :class="[
                  'inline-flex items-center gap-6px h-30px px-10px rounded-8px border border-solid text-12px font-500 cursor-pointer',
                  activeKind === c.key
                    ? 'bg-violet-soft border-violet-line text-violet-ink'
                    : 'bg-white border-line text-muted hover:border-line-strong hover:text-ink-2',
                  FOCUS,
                ]"
                @click="selectSub(c.key)"
              >
                {{ c.label }}
                <span
                  class="px-5px py-1px rounded-4px text-10px"
                  :class="activeKind === c.key ? 'bg-white/70 text-violet-ink' : 'bg-surface3 text-muted'"
                  >{{ c.count }}</span
                >
              </button>
            </div>
          </div>
          <div class="flex items-center gap-6px ml-auto shrink-0">
            <span class="mr-6px text-12px text-muted whitespace-nowrap">共 {{ total }} 项</span>
            <button
              type="button"
              :aria-expanded="filterOpen"
              :class="[TOOL_CLS, filterOpen || activeFilterCount ? 'border-violet-line text-violet-ink' : '']"
              @click="filterOpen = !filterOpen"
            >
              筛选<span v-if="activeFilterCount" class="px-5px rounded-4px bg-violet-soft text-10px">{{
                activeFilterCount
              }}</span>
            </button>
            <button type="button" :class="TOOL_CLS" @click="selectPage">
              <span aria-hidden="true">✓</span> 选择本页
            </button>
            <button type="button" :class="TOOL_CLS" title="新建标签 / 标签管理" @click="showTagManager = true">
              <span aria-hidden="true">+</span> 新建标签
            </button>
          </div>
        </div>

        <div
          v-if="filterOpen"
          class="flex flex-wrap items-center gap-12px px-14px py-10px mb-12px rounded-8px border border-solid border-line bg-white"
        >
          <label class="flex items-center gap-8px text-12px text-ink-2">
            来源
            <n-select v-model:value="filters.source" :options="SOURCE_OPTIONS" size="small" class="w-130px" />
          </label>
          <div class="flex items-center gap-6px text-12px text-ink-2" role="group" aria-label="比例">
            <span class="mr-2px">比例</span>
            <button
              v-for="r in RATIO_OPTIONS"
              :key="r.value"
              type="button"
              :aria-pressed="filters.aspect_ratio === r.value"
              :class="[
                'inline-flex items-center h-26px px-8px rounded-6px border border-solid text-12px cursor-pointer',
                filters.aspect_ratio === r.value
                  ? 'bg-violet-soft border-violet-line text-violet-ink'
                  : 'bg-white border-line text-ink-2 hover:border-line-strong',
                FOCUS,
              ]"
              @click="filters.aspect_ratio = r.value"
            >
              {{ r.label }}
            </button>
          </div>
          <label class="flex items-center gap-6px text-12px text-ink-2 whitespace-nowrap">
            <n-switch v-model:value="filters.favorite_only" size="small" />
            仅看收藏
          </label>
        </div>

        <div
          v-if="selectedIds.length"
          class="flex items-center gap-12px px-14px py-8px mb-12px border border-solid border-violet-line rounded-8px bg-violet-soft text-13px text-violet-ink"
        >
          <span>已选 {{ selectedIds.length }} 项</span>
          <n-button size="small" type="primary" @click="openBatchTag">批量打标签</n-button>
          <n-button size="small" quaternary @click="selectedIds = []">取消选择</n-button>
        </div>

        <div
          v-loading="loading"
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-16px min-h-240px"
        >
          <AssetCard
            v-for="item in items"
            :key="item.id"
            :asset="item"
            :kind-label="kindLabel(item.kind || 'uncategorized')"
            :checked="selectedIds.includes(item.id)"
            @toggle-select="toggleSelect"
            @toggle-favorite="toggleFavorite"
            @open="openDetail"
            @filter-tag="(name: string) => (filters.tag = name)"
          />
          <div
            v-if="!loading && !items.length"
            class="col-span-full flex flex-col items-center justify-center gap-6px h-360px text-muted"
          >
            <strong class="text-13px">{{ emptyCopy.title }}</strong>
            <p class="m-0 text-12px">{{ emptyCopy.desc }}</p>
          </div>
        </div>

        <div v-if="hasMore || loadingMore" class="text-center pt-16px pb-4px">
          <button
            type="button"
            class="p-0 border-none bg-transparent text-13px text-violet-ink cursor-pointer hover:text-violet-press focus-visible:(outline outline-2 outline-violet outline-offset-2)"
            @click="loadMore"
          >
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
        </div>
        <div v-else-if="!loading && items.length" class="text-center pt-16px pb-4px text-13px text-placeholder">
          已加载全部 {{ total }} 项
        </div>
      </div>
    </div>

    <DetailModal v-model="detailId" @changed="silentRefresh" />
    <TagManagerModal v-model:show="showTagManager" @changed="onTagsChanged" />
    <BatchTagModal v-model:show="showBatchTag" :asset-ids="selectedIds" @success="onBatchTagged" />
  </n-config-provider>
</template>
