<script setup lang="ts">
/**
 * 资产（/assets，对齐原型 5185 AssetsView）：五个顶层域 图片 / 视频 / 音频 / 提示词 / 官方资产库，
 * 域放在地址 ?domain=…（默认 image），链接可分享、返回键可回到上一个域。
 *
 * 域 → 接口：
 *   图片     Go 资产库 /api/v1/asset-library/assets  media=image，域内保留 Java 聚合分类树（/api/v1/asset/categories）
 *   视频     同上 media=video（kind_group=video 的二级分类在后端还没有数据来源，不用它筛）
 *   音频     没有后端：只放空态，不造假数据
 *   提示词   提示词库 /api/v1/prompt-library（见 PromptDomain）
 *   官方资产库 同上 source=official，二级分类按 kind（模特 / 场景 / 妆容 / 发型 / 配饰）
 * 图片 / 视频的来源只用后端真实存在的 source（全部 / AI 生成 / 上传 / 官方）。
 *
 * 增强能力照旧：分类条、比例 / 收藏筛选、标签带与标签筛选、收藏、单卡打标签、多选批量打标签、
 * 标签管理、详情（版本 / 相关资产 / 生成结果 / 原图·校色后，← / → 翻上一个下一个）。
 * 删除与「未分类」筛选见 useAssetDelete.ts（多选「删除」只删上传 / AI 生成，官方素材跳过并在确认语里说明）。
 * 多选「应用校色」（BatchColorFixModal）：把校色面板里复制的参数套到已选图片上，每张存为新版本。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NSwitch, useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import {
  assetCategoryTree,
  assetLibCategories,
  assetLibList,
  assetLibTagCreate,
  assetLibTags,
  assetLibUpdate,
} from '@/api/asset-library.ts'
import type {
  AssetLibKindGroup,
  IAssetCategoryNode,
  IAssetLibAsset,
  IAssetLibCategory,
  IAssetLibListParams,
  IAssetLibTag,
} from '@/api/asset-library.ts'
import { useDebounce } from '@/utils/hooks'
import IconButton from '@/components/IconButton/index.vue'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import AssetCard from './components/AssetCard.vue'
import AssetPager from './components/AssetPager.vue'
import DetailModal from './components/DetailModal.vue'
import TagManagerModal from './components/TagManagerModal.vue'
import BatchTagModal from './components/BatchTagModal.vue'
import BatchColorFixModal from './components/BatchColorFixModal.vue'
import AssetTagPopover from './components/AssetTagPopover.vue'
import PromptDomain from './components/PromptDomain.vue'
import { useAssetsInCanvas } from './useInCanvas.ts'
import { UNTAGGED_TAG, canDeleteAsset, tagFilterLabel, tagListParams, useAssetDelete } from './useAssetDelete.ts'
import {
  PILL_CLS,
  PILL_COUNT_CLS,
  PILL_OFF,
  PILL_ON,
  ROW_CLS,
  ROW_LABEL_CLS,
  SEARCH_CLS,
  TOOL_CLS,
  TOOL_ON,
} from './ui.ts'

defineOptions({ name: 'asset-library' })

const message = useMessage()
const route = useRoute()
const router = useRouter()

// ---------------- 顶层域（地址 ?domain=…） ----------------

type Domain = 'image' | 'video' | 'audio' | 'prompt' | 'official'

const DOMAINS: { key: Domain; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'prompt', label: '提示词' },
  { key: 'official', label: '官方资产库' },
]

function parseDomain(v: unknown): Domain {
  const s = Array.isArray(v) ? v[0] : v
  return DOMAINS.some((d) => d.key === s) ? (s as Domain) : 'image'
}

const domain = ref<Domain>(parseDomain(route.query.domain))
// 地址里的 domain 非法：回退到图片的同时把地址也纠正过来（replace，不留历史）
{
  const raw = Array.isArray(route.query.domain) ? route.query.domain[0] : route.query.domain
  if (raw != null && raw !== domain.value) void router.replace({ query: { ...route.query, domain: domain.value } })
}
/** 走资产列表的域（图片 / 视频 / 官方） */
const isAssetDomain = computed(
  () => domain.value === 'image' || domain.value === 'video' || domain.value === 'official',
)

/** 点页签：写进地址（push，返回键回到上一个域），真正切换由下面的地址监听完成 */
function setDomain(next: Domain) {
  if (next === domain.value) return
  void router.push({ query: { ...route.query, domain: next } })
}

// 地址变化 → 切域（只认本页的路由，离开本页时 query 变空不算切回图片）
watch(
  () => route.query.domain,
  (v) => {
    if (route.name !== 'asset-library') return
    const next = parseDomain(v)
    if (next !== domain.value) applyDomain(next)
  },
)

/** 切域：来源 / 分类 / 收藏 / 多选清零，关键词与标签、比例保留 */
function applyDomain(next: Domain) {
  domain.value = next
  filters.source = ''
  filters.favoriteOnly = false
  officialKind.value = ''
  activeGroup.value = ''
  activeSub.value = ''
  exitSelect()
  tagPopover.value?.close()
  detailId.value = null
  void nextTick(syncBeam)
}

// 页签之间平移的一束紫气（原型 relay-beam，340ms）：位置靠量，不写死
const domainNav = ref<HTMLElement | null>(null)
const beamX = ref(0)
const beamReady = ref(false)
const BEAM_W = 56
function syncBeam() {
  const el = domainNav.value?.querySelector<HTMLElement>('[aria-selected="true"]')
  if (el) beamX.value = el.offsetLeft + el.offsetWidth / 2 - BEAM_W / 2
}
let navObserver: ResizeObserver | null = null

/** 页签键盘：← / → 在五个域之间移动并切换（tablist 惯例） */
function onDomainKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const i = DOMAINS.findIndex((d) => d.key === domain.value)
  const next = DOMAINS[(i + (e.key === 'ArrowRight' ? 1 : DOMAINS.length - 1)) % DOMAINS.length]!
  setDomain(next.key)
  void nextTick(() => domainNav.value?.querySelector<HTMLElement>(`[data-domain="${next.key}"]`)?.focus())
}

// ---------------- 图片域：Java 聚合分类树 ----------------

/** 卡片上的 kind 中文名 */
const KIND_LABELS: Record<string, string> = {
  model: '模特',
  scene: '场景',
  makeup: '妆容',
  hair: '发型',
  accessory: '配饰',
}
const kindLabel = (key: string) => (key ? (KIND_LABELS[key] ?? key) : '')

/**
 * 分类条：GET /api/v1/asset/categories。首项「全部」不是分类、不传 entry_codes；
 * 其后一级 tab，选中有二级的一级时出二级 chip（首个为该组「全部」= 各二级入口码之并）。
 * 二级里 __other 结尾的「其他」是后端合成的虚拟分类，照常渲染（key 用 categoryCode，id 可能为 null）。
 */
const tree = ref<IAssetCategoryNode[]>([])
/** Go 分类计数：图片 / 视频域取 all 作「全部」计数；官方域取各 kind 计数 */
const categories = ref<IAssetLibCategory[]>([])
const activeGroup = ref('')
const activeSub = ref('')

const countOf = (key: string) => categories.value.find((c) => c.key === key)?.count ?? 0
const allCount = computed(() => countOf('all'))

const childrenOf = (n: IAssetCategoryNode) => n.children ?? []
const uniq = (codes: string[]) => [...new Set(codes.filter(Boolean))]
/** 节点的筛选入口码：有二级 = 各二级之并（并集为空时退回一级自身），否则取自身 */
function codesOf(n: IAssetCategoryNode): string[] {
  const kids = childrenOf(n)
  const union = uniq(kids.flatMap((c) => c.entryCodes ?? []))
  return kids.length && union.length ? union : uniq(n.entryCodes ?? [])
}

const activeNode = computed(() => tree.value.find((n) => n.categoryCode === activeGroup.value))

const groupItems = computed(() => [
  { key: '', label: '全部', count: allCount.value },
  ...tree.value.map((n) => ({ key: n.categoryCode, label: n.categoryName, count: n.count ?? 0 })),
])
const subItems = computed(() => {
  const node = activeNode.value
  const kids = node ? childrenOf(node) : []
  if (!node || !kids.length) return []
  return [
    { key: '', label: '全部', count: node.count ?? 0 },
    ...kids.map((c) => ({ key: c.categoryCode, label: c.categoryName, count: c.count ?? 0 })),
  ]
})

function selectGroup(key: string) {
  activeGroup.value = key
  activeSub.value = ''
}
/** 再点一次已选的二级则取消，回到该组全部 */
function selectSub(key: string) {
  activeSub.value = activeSub.value === key ? '' : key
}
/** 分类条末尾「我的收藏」与筛选面板的收藏开关同一个 favorite_only：选分类 = 关掉只看收藏 */
function pickGroup(key: string) {
  filters.favoriteOnly = false
  selectGroup(key)
}
function pickFavorite() {
  selectGroup('')
  filters.favoriteOnly = true
}

/**
 * 当前分类的列表筛选：null = 不限。按素材类型的节点走 kind_group / kind；入口码节点走 entry_codes。
 * entry_codes 为空串 = 选中的节点没有任何入口（直接视为空列表，不发请求）。
 */
function categoryFilter(): { kind?: string; kindGroup?: AssetLibKindGroup; entryCodes?: string } | null {
  const node = activeNode.value
  if (!node) return null
  const sub = activeSub.value ? childrenOf(node).find((c) => c.categoryCode === activeSub.value) : undefined
  if (sub?.kind) return { kind: sub.kind }
  if (!sub && node.kindGroup) return { kindGroup: node.kindGroup }
  const codes = sub ? uniq(sub.entryCodes ?? []) : codesOf(node)
  return { entryCodes: codes.join(',') }
}

async function loadTree() {
  try {
    const res = await assetCategoryTree()
    tree.value = Array.isArray(res.data) ? res.data : []
  } catch {
    tree.value = [] // 分类树拉失败不挡列表：分类条只剩「全部」
  }
  if (activeGroup.value && !activeNode.value) selectGroup('')
}

// ---------------- 官方资产库：kind 二级分类 ----------------

const OFFICIAL_KINDS = [
  { key: '', label: '全部' },
  { key: 'model', label: '模特' },
  { key: 'scene', label: '场景' },
  { key: 'makeup', label: '妆容' },
  { key: 'hair', label: '发型' },
  { key: 'accessory', label: '配饰' },
]
const officialKind = ref('')
function pickOfficialKind(key: string) {
  officialKind.value = key && officialKind.value !== key ? key : ''
}

// ---------------- 筛选 ----------------

/** 图片 / 视频的来源：只用后端 source 真实取值，不造「智能体 / 画布」这类后端分不出来的来源 */
const SOURCE_TABS = [
  { value: '', label: '全部' },
  { value: 'generated', label: 'AI 生成' },
  { value: 'upload', label: '上传' },
  { value: 'official', label: '官方' },
]

const filters = reactive({
  source: '',
  favoriteOnly: false,
  q: '',
  tag: '',
  aspectRatio: '',
})
/** 来源再点一次回到「全部」 */
function pickSource(v: string) {
  filters.source = v && filters.source !== v ? v : ''
}

const RATIO_OPTIONS = [
  { label: '全部', value: '' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
]

const filterOpen = ref(false)
const activeFilterCount = computed(() => (filters.favoriteOnly ? 1 : 0) + (filters.aspectRatio ? 1 : 0))

/** 关键词防抖后才进查询 */
const debouncedQ = ref('')
useDebounce({ data: () => filters.q, callback: () => (debouncedQ.value = filters.q.trim()) })

/** 有没有任何筛选在生效（空态据此给「清除筛选」） */
const hasFilter = computed(
  () =>
    !!filters.source ||
    !!filters.tag ||
    filters.favoriteOnly ||
    !!filters.aspectRatio ||
    !!activeGroup.value ||
    !!officialKind.value,
)
function clearFilters() {
  filters.source = ''
  filters.tag = ''
  filters.favoriteOnly = false
  filters.aspectRatio = ''
  officialKind.value = ''
  selectGroup('')
}

// ---------------- 标签带（我的标签字典） ----------------

const tags = ref<IAssetLibTag[]>([])
/** 「未分类」（没挂任何标签）的服务端计数；取不到为 null（不显示计数） */
const untaggedCount = ref<number | null>(null)
async function loadTags() {
  try {
    const res = await assetLibTags()
    untaggedCount.value = res.data?.untaggedCount ?? null
    tags.value = (res.data?.items ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } catch {
    // 拉失败沿用上次的字典
  }
}
function toggleTag(name: string) {
  filters.tag = filters.tag === name ? '' : name
}

// ---------------- 列表（分页） ----------------

const PAGE_SIZE = 32

/** 当前域的列表参数；null = 非资产域；'empty' = 选中的分类没有任何入口（不发请求） */
const listParams = computed<IAssetLibListParams | 'empty' | null>(() => {
  const base: IAssetLibListParams = {
    aspectRatio: filters.aspectRatio || undefined,
    ...tagListParams(filters.tag),
    favoriteOnly: filters.favoriteOnly || undefined,
    q: debouncedQ.value || undefined,
  }
  switch (domain.value) {
    case 'official':
      return { ...base, source: 'official', kind: officialKind.value || undefined }
    case 'video':
      return { ...base, source: filters.source || undefined, media: 'video' }
    case 'image': {
      const cat = categoryFilter()
      if (cat?.entryCodes === '') return 'empty'
      return {
        ...base,
        ...(cat ?? {}),
        entryCodes: cat?.entryCodes || undefined,
        source: filters.source || undefined,
        media: 'image',
      }
    }
    default:
      return null
  }
})
const listKey = computed(() => JSON.stringify(listParams.value))

const items = ref<IAssetLibAsset[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadError = ref(false)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

/** 详情跨页翻到下一页 / 上一页后要打开的位置 */
let pendingEdge: 'first' | 'last' | null = null
let seq = 0

/** 拉当前页。silent = 变更后的静默同步：不出加载态、失败不清空 */
async function load(silent = false) {
  const params = listParams.value
  if (!params) return
  const cur = ++seq
  if (!silent) {
    loading.value = true
    loadError.value = false
  }
  try {
    if (params === 'empty') {
      items.value = []
      total.value = 0
      return
    }
    const res = await assetLibList({ ...params, page: page.value, pageSize: PAGE_SIZE })
    if (cur !== seq) return
    items.value = res.data?.items ?? []
    total.value = res.data?.total ?? 0
    // 取消收藏等让本页空了：退到最后一页
    if (!items.value.length && total.value > 0 && page.value > 1) {
      page.value = Math.ceil(total.value / PAGE_SIZE)
      return
    }
    if (pendingEdge && items.value.length) {
      const target = pendingEdge === 'first' ? items.value[0] : items.value[items.value.length - 1]
      if (target) detailId.value = target.id
    }
    pendingEdge = null
  } catch {
    if (cur !== seq) return
    pendingEdge = null
    if (!silent) {
      items.value = []
      total.value = 0
      loadError.value = true
    }
  } finally {
    if (cur === seq) loading.value = false
  }
}
const silentRefresh = () => load(true)

let catSeq = 0
async function loadCategories() {
  if (!isAssetDomain.value) return
  const d = domain.value
  const cur = ++catSeq
  try {
    const res = await assetLibCategories(
      d === 'official' ? { source: 'official' } : { source: filters.source || undefined, media: d },
    )
    if (cur === catSeq && d === domain.value) categories.value = res.data?.items ?? []
  } catch {
    if (cur !== catSeq) return
    categories.value = [] // 计数拉失败不挡列表
  }
}

const scroller = ref<HTMLElement | null>(null)

// 查询条件变化：回到第 1 页（已在第 1 页就直接拉），多选清空
watch(listKey, () => {
  selectedIds.value = []
  selectedAssets.clear()
  pendingEdge = null
  if (page.value !== 1) page.value = 1
  else void load()
})
watch(page, () => {
  void load()
  scroller.value?.scrollTo({ top: 0 })
})
// 计数只随域与来源变
watch([domain, () => filters.source], () => {
  categories.value = []
  void loadCategories()
})

onMounted(() => {
  void loadTree()
  void loadCategories()
  void loadTags()
  void load()
  void nextTick(() => {
    syncBeam()
    requestAnimationFrame(() => (beamReady.value = true))
  })
  if (domainNav.value && 'ResizeObserver' in window) {
    navObserver = new ResizeObserver(syncBeam)
    navObserver.observe(domainNav.value)
  }
})
onBeforeUnmount(() => navObserver?.disconnect())

// ---------------- 收藏（即点即存） ----------------

async function toggleFavorite(asset: IAssetLibAsset) {
  const next = !asset.favorite
  try {
    await assetLibUpdate(asset.id, { favorite: next })
  } catch {
    return // 失败 toast 已由请求层弹出
  }
  asset.favorite = next
  // 只看收藏时，取消收藏的卡就地移出，计数跟着走
  if (!next && filters.favoriteOnly) {
    items.value = items.value.filter((i) => i.id !== asset.id)
    total.value = Math.max(0, total.value - 1)
    // 本页被取空且不在第 1 页：退到最后一个有效页（page 变化会触发重查）
    if (!items.value.length && page.value > 1) page.value = Math.min(page.value - 1, pageCount.value)
  }
}

// ---------------- 多选与批量打标签 ----------------

const selectMode = ref(false)
const selectedIds = ref<number[]>([])
/** 多选态：点了「选择」，或已经勾了任意一张（悬停多选框直接勾也算） */
const selecting = computed(() => selectMode.value || selectedIds.value.length > 0)

/** 已选资产的快照：已选跨页保留，翻页后 items 里没有它们，「用于画布」要靠这里取地址 */
const selectedAssets = new Map<number, IAssetLibAsset>()
function rememberSelected(asset: IAssetLibAsset | undefined) {
  if (asset) selectedAssets.set(asset.id, asset)
}

function toggleSelect(id: number) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else {
    selectedIds.value.push(id)
    rememberSelected(items.value.find((it) => it.id === id))
  }
}
/** 本页：把当前页全部并进已选（跨页已选的保留） */
function selectPage() {
  items.value.forEach(rememberSelected)
  selectedIds.value = [...new Set([...selectedIds.value, ...items.value.map((i) => i.id)])]
}
function exitSelect() {
  selectMode.value = false
  selectedIds.value = []
  selectedAssets.clear()
}

// 多选「用于画布」：已选的图片 / 视频一起带进一张新画布
const { opening: openingCanvas, openAssetsInCanvas } = useAssetsInCanvas()
function useSelectedInCanvas() {
  const picked = selectedIds.value
    .map((id) => selectedAssets.get(id) ?? items.value.find((it) => it.id === id))
    .filter((a): a is IAssetLibAsset => !!a)
  void openAssetsInCanvas(picked)
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
// 多选「应用校色」：已选里的图片（视频在弹窗里标跳过）
const showBatchColorFix = ref(false)
const batchColorFixAssets = ref<IAssetLibAsset[]>([])
const selectedImageCount = computed(
  () =>
    selectedIds.value.filter((id) => (selectedAssets.get(id) ?? items.value.find((it) => it.id === id))?.media === 'image')
      .length,
)
function openBatchColorFix() {
  const picked = selectedIds.value
    .map((id) => selectedAssets.get(id) ?? items.value.find((it) => it.id === id))
    .filter((a): a is IAssetLibAsset => !!a)
  if (!picked.some((a) => a.media === 'image')) return
  if (picked.length > 50) {
    message.warning('一次最多给 50 张图片应用校色')
    return
  }
  batchColorFixAssets.value = picked
  showBatchColorFix.value = true
}
function onBatchColorFixed() {
  void silentRefresh()
}

function onBatchTagged() {
  exitSelect()
  void silentRefresh()
  void loadTags()
}

// ---------------- 删除（useAssetDelete.ts） ----------------

const assetDelete = useAssetDelete({
  resolve: (id) => selectedAssets.get(id) ?? items.value.find((it) => it.id === id),
  onDeleted: (ids) => {
    if (detailId.value != null && ids.includes(detailId.value)) detailId.value = null
    exitSelect()
    void silentRefresh()
    void loadTags()
    void loadCategories()
  },
})
/** 选中里能删的个数（官方素材不算）：0 时「删除」置灰并提示「官方素材不可删除」 */
const deletableSelectedCount = computed(() => assetDelete.deletableOf(selectedIds.value).length)

/** 详情底部「删除」：当前打开的资产（列表里找不到时不给删，避免拿不到来源信息误判官方素材） */
const detailAsset = computed(() =>
  detailId.value == null ? undefined : items.value.find((it) => it.id === detailId.value),
)
const detailCanDelete = computed(() => canDeleteAsset(detailAsset.value))
const detailDeleteReason = computed(() => (detailAsset.value?.source === 'official' ? '官方素材不可删除' : ''))
function onDetailDelete() {
  if (detailAsset.value) void assetDelete.confirmDeleteOne(detailAsset.value)
}

// ---------------- 标签管理 / 单卡打标签 / 详情 ----------------

const showTagManager = ref(false)

// 标签带行内新建（原型 relay-strip-add）：点「＋」出输入框，回车建、Esc / 失焦空值收起
const tagAdding = ref(false)
const tagDraft = ref('')
const tagCreating = ref(false)
const tagDraftInput = ref<HTMLInputElement | null>(null)
function startTagAdd() {
  tagAdding.value = true
  void nextTick(() => tagDraftInput.value?.focus())
}
function cancelTagAdd() {
  tagAdding.value = false
  tagDraft.value = ''
}
async function submitTagAdd() {
  const name = tagDraft.value.trim()
  if (!name) return cancelTagAdd()
  if (tagCreating.value) return
  if (tags.value.some((t) => t.name === name)) {
    message.warning('已有同名标签')
    return
  }
  tagCreating.value = true
  try {
    await assetLibTagCreate(name)
    message.success('标签已新建')
    cancelTagAdd()
    await loadTags()
  } catch {
    // 失败 toast（重名 / 超限）已由请求层弹出，保留输入便于改名
  } finally {
    tagCreating.value = false
  }
}
function onTagDraftBlur() {
  if (!tagDraft.value.trim()) cancelTagAdd()
}

// 卡片入场：首屏 420ms 自下 8px 淡入，之后翻页 / 追加只位移 4px；reduced-motion 关掉
const firstEntering = ref(true)
let firstEnterTimer: ReturnType<typeof setTimeout> | undefined
watch(items, (v) => {
  if (v.length && firstEntering.value && !firstEnterTimer) {
    firstEnterTimer = setTimeout(() => (firstEntering.value = false), 700)
  }
})
onBeforeUnmount(() => clearTimeout(firstEnterTimer))

/** 标签重命名 / 删除会影响卡片上的标签名；若删掉的正被用作筛选，清掉筛选 */
function onTagsChanged(deletedName?: string) {
  void loadTags()
  if (deletedName && filters.tag === deletedName) {
    filters.tag = '' // 查询条件变了，watch 会整页重查
    return
  }
  void silentRefresh()
}

function onPopoverChanged() {
  void loadTags()
  void silentRefresh()
}
function onDetailChanged() {
  void loadTags()
  void silentRefresh()
}

const tagPopover = ref<InstanceType<typeof AssetTagPopover> | null>(null)
function editTags(asset: IAssetLibAsset, el: HTMLElement) {
  tagPopover.value?.open(asset, el)
}

const detailId = ref<number | null>(null)
function openDetail(asset: IAssetLibAsset) {
  detailId.value = asset.id
}

/** 详情里的上一个 / 下一个：按当前筛选的顺序走，越过本页边界就翻页（翻完打开新页首 / 尾） */
const detailIndex = computed(() =>
  detailId.value == null ? -1 : items.value.findIndex((i) => i.id === detailId.value),
)
// 跨页加载中 items 暂时换了一批，detailIndex 会变 -1：沿用上次的值，避免翻页钮被摘掉、焦点丢失
const navPrev = ref(false)
const navNext = ref(false)
watchEffect(() => {
  if (loading.value && detailIndex.value < 0) return
  navPrev.value = detailIndex.value > 0 || (detailIndex.value === 0 && page.value > 1)
  navNext.value = detailIndex.value >= 0 && (detailIndex.value < items.value.length - 1 || page.value < pageCount.value)
})
const detailHasPrev = navPrev
const detailHasNext = navNext
function openSibling(delta: 1 | -1) {
  const i = detailIndex.value
  if (i < 0 || loading.value) return
  const target = items.value[i + delta]
  if (target) {
    detailId.value = target.id
    return
  }
  const nextPage = page.value + delta
  if (nextPage < 1 || nextPage > pageCount.value) return
  pendingEdge = delta > 0 ? 'first' : 'last'
  page.value = nextPage
}

// ---------------- 空态 ----------------

const emptyCopy = computed(() => {
  if (debouncedQ.value) return { text: '没有匹配的资产', desc: '换个关键词试试。' }
  if (filters.tag === UNTAGGED_TAG) return { text: '没有未分类的素材', desc: '所有素材都已经归到标签里了。' }
  if (filters.tag) return { text: `「${filters.tag}」下没有资产`, desc: '换个标签，或清除筛选。' }
  if (filters.favoriteOnly) return { text: '还没有收藏', desc: '点卡片右上角的星标，常用的资产会集中到这里。' }
  if (hasFilter.value) return { text: '没有符合筛选的资产', desc: '换个来源或分类，或清除筛选。' }
  switch (domain.value) {
    case 'video':
      return { text: '还没有视频资产', desc: '用 AI 视频工具生成的视频会自动出现在这里。' }
    case 'official':
      return { text: '还没有官方资产', desc: '官方资产库暂时没有记录。' }
    default:
      return { text: '还没有图片资产', desc: '生成的图片和上传的素材会自动出现在这里。' }
  }
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="h-full min-h-0 flex flex-col overflow-hidden bg-page text-ink">
      <h1 class="sr-only">资产</h1>
      <!-- 第一层：五个域（56 高）+ 右侧操作 -->
      <header
        class="flex items-center gap-10px shrink-0 h-56px px-20px bg-white border-b border-b-solid border-line-soft"
      >
        <nav
          ref="domainNav"
          class="relative flex items-stretch shrink-0 h-56px gap-1px"
          role="tablist"
          aria-label="资产类型"
          @keydown="onDomainKey"
        >
          <span
            class="asset-beam"
            :class="beamReady && 'is-ready'"
            :style="{ transform: `translateX(${beamX}px)` }"
            aria-hidden="true"
          >
            <i class="absolute left-1/2 bottom-2px w-16px h-2px -ml-8px rounded-full bg-violet" />
          </span>
          <button
            v-for="d in DOMAINS"
            :key="d.key"
            type="button"
            role="tab"
            :data-domain="d.key"
            :aria-selected="domain === d.key"
            :tabindex="domain === d.key ? 0 : -1"
            class="relative z-1 inline-flex items-center justify-center h-56px px-13px max-lg:px-8px border-none bg-transparent text-13px font-500 whitespace-nowrap cursor-pointer transition-colors duration-mid sx-focus focus-visible:-outline-offset-4"
            :class="domain === d.key ? 'text-ink' : 'text-muted hover:text-ink'"
            @click="setDomain(d.key)"
          >
            {{ d.label }}
          </button>
        </nav>

        <div v-if="isAssetDomain" class="flex items-center gap-8px ml-auto min-w-0">
          <template v-if="!selecting">
            <button type="button" :class="TOOL_CLS" @click="selectMode = true">选择</button>
            <button
              type="button"
              :aria-expanded="filterOpen"
              :class="[TOOL_CLS, (filterOpen || activeFilterCount) && TOOL_ON]"
              @click="filterOpen = !filterOpen"
            >
              筛选<span v-if="activeFilterCount" class="text-11px tabular-nums">{{ activeFilterCount }}</span>
            </button>
            <button type="button" :class="TOOL_CLS" @click="showTagManager = true">标签管理</button>
          </template>
          <template v-else>
            <span class="text-12px font-600 text-violet-ink whitespace-nowrap" aria-live="polite"
              >已选 {{ selectedIds.length }}</span
            >
            <button
              type="button"
              :class="TOOL_CLS"
              :disabled="!selectedIds.length"
              :title="selectedIds.length ? undefined : '先勾选要打标签的资产'"
              @click="openBatchTag"
            >
              批量打标签
            </button>
            <button
              type="button"
              :class="TOOL_CLS"
              :disabled="!selectedImageCount"
              :title="selectedImageCount ? '把校色面板里复制的参数应用到已选图片，每张存为新版本' : '先勾选要校色的图片'"
              @click="openBatchColorFix"
            >
              应用校色
            </button>
            <button
              type="button"
              :class="TOOL_CLS"
              :disabled="!selectedIds.length || openingCanvas"
              :aria-busy="openingCanvas || undefined"
              :title="selectedIds.length ? '新建一张画布，把已选素材放进去' : '先勾选要用于画布的资产'"
              @click="useSelectedInCanvas"
            >
              {{ openingCanvas ? '正在创建画布…' : '用于画布' }}
            </button>
            <!-- 删除（useAssetDelete.ts）：选中里全是官方素材时置灰 -->
            <button
              type="button"
              :class="TOOL_CLS"
              class="!text-danger"
              :disabled="!deletableSelectedCount || assetDelete.deleting.value"
              :aria-busy="assetDelete.deleting.value || undefined"
              :title="
                deletableSelectedCount ? undefined : selectedIds.length ? '官方素材不可删除' : '先勾选要删除的素材'
              "
              @click="assetDelete.confirmDeleteSelected(selectedIds)"
            >
              删除
            </button>
            <button type="button" :class="TOOL_CLS" @click="selectPage">选择本页</button>
            <button type="button" :class="TOOL_CLS" @click="exitSelect">取消</button>
          </template>
        </div>
        <router-link v-else-if="domain === 'prompt'" to="/prompt-library" class="sx-btn ml-auto no-underline">
          管理提示词
        </router-link>
      </header>

      <!-- 第二层：来源 / 官方分类 + 标签带 + 搜索（44 高） -->
      <div v-if="isAssetDomain" :class="ROW_CLS">
        <template v-if="domain === 'official'">
          <span :class="ROW_LABEL_CLS">分类</span>
          <div class="flex items-center gap-6px shrink-0" role="group" aria-label="官方资产分类">
            <button
              v-for="k in OFFICIAL_KINDS"
              :key="k.key || '__all'"
              type="button"
              :aria-pressed="officialKind === k.key"
              :class="[PILL_CLS, officialKind === k.key ? PILL_ON : PILL_OFF]"
              @click="pickOfficialKind(k.key)"
            >
              {{ k.label }}
              <em v-if="categories.length" :class="PILL_COUNT_CLS" class="not-italic">{{ countOf(k.key || 'all') }}</em>
            </button>
          </div>
        </template>
        <template v-else>
          <span :class="ROW_LABEL_CLS">来源</span>
          <div class="flex items-center gap-6px shrink-0" role="group" aria-label="来源">
            <button
              v-for="s in SOURCE_TABS"
              :key="s.value || '__all'"
              type="button"
              :aria-pressed="filters.source === s.value"
              :class="[PILL_CLS, filters.source === s.value ? PILL_ON : PILL_OFF]"
              @click="pickSource(s.value)"
            >
              {{ s.label }}
            </button>
          </div>
        </template>

        <span class="shrink-0 w-1px h-20px mx-2px bg-line" aria-hidden="true" />
        <IconButton label="全部标签" size="md" variant="plate" @click="showTagManager = true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.3 7.3a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.3-7.3a1 1 0 0 1-.3-.7Z"
            />
            <circle cx="8.2" cy="8.2" r="1.2" />
          </svg>
        </IconButton>
        <div
          class="flex items-center gap-6px min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="按标签筛选"
        >
          <!-- 「未分类」= 没挂任何标签（useAssetDelete.ts 的 UNTAGGED_TAG → 列表 untagged=true） -->
          <button
            type="button"
            :aria-pressed="filters.tag === UNTAGGED_TAG"
            :class="[PILL_CLS, filters.tag === UNTAGGED_TAG ? PILL_ON : PILL_OFF]"
            @click="toggleTag(UNTAGGED_TAG)"
          >
            未分类<em v-if="untaggedCount != null" :class="PILL_COUNT_CLS" class="not-italic">{{ untaggedCount }}</em>
          </button>
          <button
            v-for="t in tags"
            :key="t.id"
            type="button"
            :aria-pressed="filters.tag === t.name"
            :class="[PILL_CLS, filters.tag === t.name ? PILL_ON : PILL_OFF]"
            @click="toggleTag(t.name)"
          >
            {{ t.name }}<em :class="PILL_COUNT_CLS" class="not-italic">{{ t.assetCount }}</em>
          </button>
          <input
            v-if="tagAdding"
            ref="tagDraftInput"
            v-model="tagDraft"
            maxlength="12"
            placeholder="标签名"
            aria-label="新标签名"
            :disabled="tagCreating"
            class="shrink-0 w-96px h-30px box-border px-10px rounded-15px border border-solid border-violet-line bg-white outline-none text-12px text-ink placeholder:text-placeholder"
            @keydown.enter.prevent="submitTagAdd"
            @keydown.esc="cancelTagAdd"
            @blur="onTagDraftBlur"
          />
          <button
            v-else
            type="button"
            aria-label="新建标签"
            title="新建标签"
            :class="[PILL_CLS, PILL_OFF]"
            @click="startTagAdd"
          >
            ＋
          </button>
        </div>

        <label :class="SEARCH_CLS">
          <svg
            class="w-13px h-13px shrink-0"
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
            placeholder="搜索标题 / 提示词"
            class="min-w-0 flex-1 border-none outline-none bg-transparent text-12px text-ink placeholder:text-placeholder"
          />
        </label>
      </div>

      <!-- 提示词域：自带筛选条与列表 -->
      <PromptDomain v-if="domain === 'prompt'" v-model:q="filters.q" />

      <!-- 音频：没有后端，只放空态 -->
      <div v-else-if="domain === 'audio'" class="flex-1 min-h-0 overflow-auto px-20px">
        <PageEmpty text="还没有音频资产" description="音频资产还没有开放，开放后生成的配音、音乐会自动出现在这里。" />
      </div>

      <div v-else ref="scroller" class="flex-1 min-h-0 overflow-auto px-20px pt-14px pb-20px">
        <!-- 图片域：聚合分类条 -->
        <div v-if="domain === 'image'" class="flex flex-col gap-8px mb-12px">
          <div
            class="flex flex-wrap items-center gap-8px"
            role="group"
            aria-label="资产分类"
            title="分类数量统计全部来源，不随来源、媒体筛选变化"
          >
            <button
              v-for="g in groupItems"
              :key="g.key || '__all'"
              type="button"
              :aria-pressed="!filters.favoriteOnly && activeGroup === g.key"
              :class="[PILL_CLS, !filters.favoriteOnly && activeGroup === g.key ? PILL_ON : PILL_OFF]"
              @click="pickGroup(g.key)"
            >
              {{ g.label }}<em :class="PILL_COUNT_CLS" class="not-italic">{{ g.count }}</em>
            </button>
            <button
              type="button"
              :aria-pressed="filters.favoriteOnly"
              :class="[PILL_CLS, filters.favoriteOnly ? PILL_ON : PILL_OFF]"
              @click="pickFavorite"
            >
              我的收藏
            </button>
          </div>
          <div
            v-if="subItems.length"
            class="flex flex-wrap items-center gap-6px pl-12px"
            role="group"
            :aria-label="`${activeNode?.categoryName ?? ''}二级分类`"
          >
            <button
              v-for="c in subItems"
              :key="c.key || '__all'"
              type="button"
              :aria-pressed="activeSub === c.key"
              :class="[PILL_CLS, activeSub === c.key ? PILL_ON : PILL_OFF]"
              @click="selectSub(c.key)"
            >
              {{ c.label }}<em :class="PILL_COUNT_CLS" class="not-italic">{{ c.count }}</em>
            </button>
          </div>
        </div>

        <!-- 筛选面板：比例 / 只看收藏 -->
        <div
          v-if="filterOpen"
          class="flex flex-wrap items-center gap-12px px-14px py-8px mb-12px sx-squircle rounded-14px border border-solid border-line bg-white"
        >
          <div class="flex flex-wrap items-center gap-6px" role="group" aria-label="比例">
            <span :class="ROW_LABEL_CLS" class="mr-2px">比例</span>
            <button
              v-for="r in RATIO_OPTIONS"
              :key="r.value || '__all'"
              type="button"
              :aria-pressed="filters.aspectRatio === r.value"
              :class="[PILL_CLS, filters.aspectRatio === r.value ? PILL_ON : PILL_OFF]"
              @click="filters.aspectRatio = r.value"
            >
              {{ r.label }}
            </button>
          </div>
          <label class="flex items-center gap-6px min-h-32px text-12px text-ink-2 whitespace-nowrap cursor-pointer">
            <n-switch v-model:value="filters.favoriteOnly" size="small" />
            只看收藏
          </label>
        </div>

        <!-- 生效中的标签筛选（标签带可能滚出视野，这里给个明确的清除口） -->
        <div v-if="filters.tag" class="flex items-center gap-8px mb-12px">
          <button
            type="button"
            class="inline-flex items-center gap-4px h-30px px-10px rounded-15px border border-solid border-violet-line bg-info-soft text-12px text-violet-ink cursor-pointer sx-focus"
            :aria-label="`清除标签筛选 ${tagFilterLabel(filters.tag)}`"
            @click="filters.tag = ''"
          >
            标签：{{ tagFilterLabel(filters.tag) }} <span aria-hidden="true">×</span>
          </button>
        </div>

        <PageLoadError
          v-if="loadError && !loading"
          subtitle="资产列表没有取到，请检查网络后重试"
          retryable
          @retry="load()"
        />
        <template v-else>
          <TransitionGroup
            v-loading="loading"
            name="card"
            tag="div"
            appear
            class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 wide:grid-cols-8 items-start gap-8px min-h-240px"
            :class="firstEntering && 'is-first'"
          >
            <AssetCard
              v-for="item in items"
              :key="item.id"
              :asset="item"
              :kind-label="kindLabel(item.kind)"
              :checked="selectedIds.includes(item.id)"
              :selecting="selecting"
              @toggle-select="toggleSelect"
              @toggle-favorite="toggleFavorite"
              @open="openDetail"
              @filter-tag="toggleTag"
              @edit-tags="editTags"
            />
            <div v-if="!loading && !items.length" key="__empty" class="col-span-full h-360px">
              <PageEmpty :text="emptyCopy.text" :description="emptyCopy.desc">
                <button v-if="debouncedQ" type="button" class="sx-btn" @click="filters.q = ''">清除搜索</button>
                <button v-else-if="hasFilter" type="button" class="sx-btn" @click="clearFilters">清除筛选</button>
                <!-- 空库（没有任何筛选在生效）：图片 / 视频域给去生成的出口 -->
                <button
                  v-else-if="domain === 'image' || domain === 'video'"
                  type="button"
                  class="sx-btn-primary"
                  @click="router.push(domain === 'video' ? '/video' : '/image')"
                >
                  去生成
                </button>
              </PageEmpty>
            </div>
          </TransitionGroup>

          <AssetPager v-model:page="page" :total="total" :page-size="PAGE_SIZE" :disabled="loading" />
        </template>
      </div>
    </div>

    <DetailModal
      v-model="detailId"
      :has-prev="detailHasPrev"
      :has-next="detailHasNext"
      :can-delete="detailCanDelete"
      :delete-disabled-reason="detailDeleteReason"
      @delete="onDetailDelete"
      @changed="onDetailChanged"
      @prev="openSibling(-1)"
      @next="openSibling(1)"
    />
    <TagManagerModal v-model:show="showTagManager" @changed="onTagsChanged" />
    <BatchTagModal v-model:show="showBatchTag" :asset-ids="selectedIds" @success="onBatchTagged" />
    <BatchColorFixModal v-model:show="showBatchColorFix" :assets="batchColorFixAssets" @changed="onBatchColorFixed" />
    <AssetTagPopover ref="tagPopover" @changed="onPopoverChanged" />
  </n-config-provider>
</template>

<style scoped lang="less">
// 页签之间平移的一束紫气（原型 relay-beam）：宽束白底紫气，模糊 + 左右渐隐；渐变与遮罩原子类写不下
.asset-beam {
  position: absolute;
  left: 0;
  bottom: -2px;
  z-index: 0;
  width: 56px;
  height: 56px;
  pointer-events: none;
  opacity: 0;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 30px 26px at 50% 88%, rgba(174, 135, 196, 0.12), rgba(174, 135, 196, 0) 76%),
      linear-gradient(
        to top,
        rgba(174, 135, 196, 0.14) 0%,
        rgba(174, 135, 196, 0.2) 38%,
        rgba(174, 135, 196, 0.09) 70%,
        rgba(174, 135, 196, 0) 100%
      );
    mask-image: linear-gradient(to right, transparent 0%, #000 16%, #000 84%, transparent 100%);
    filter: blur(12px);
  }

  &.is-ready {
    opacity: 1;
    transition:
      transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1),
      opacity 0.28s ease;
  }
}

// 卡片入场（TransitionGroup name=card）：后续追加位移 4px，首屏（.is-first）8px 且慢一点
.card-enter-active {
  transition:
    opacity 0.32s ease,
    transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.card-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.is-first {
  .card-enter-active {
    transition-duration: 0.42s;
  }
  .card-enter-from {
    transform: translateY(8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .asset-beam.is-ready {
    transition: none;
  }
  .card-enter-active {
    transition: none !important;
  }
  .card-enter-from {
    opacity: 1;
    transform: none;
  }
}
</style>
