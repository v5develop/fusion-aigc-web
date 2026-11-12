<script setup lang="ts">
import { modelLabelOf, modelLabelsOf } from '@/utils/model-label'
/**
 * 提示词库浮层（原型 PromptLibraryFlyout：宽 400 的锚定面板，不是整屏弹窗）。
 *
 * <p>数据走 Go 网关 /api/v1/prompt-library（官方电商 / 官方通用 / 我的 三个域），
 * 布局同原型：头（标题 + 「公共 N 条 · 我的 M 条」+ 上传 + 关闭）→ 搜索 → 适用模型 chips → 域页签 → 分组 chips → 列表。
 * 分组（带中文名与条数）和各域总数都由接口随列表返回，首次打开即有；列表触底自动加载下一页（每页 50）。
 * 点卡片把整条提示词交给页面插入输入框。
 * Esc / 点外部关闭；出现 / 消失带 120ms 位移过渡。加载失败给一条可重试的空态。
 *
 * <p>定位：调用方用 `anchor` 传触发按钮元素，面板吸附其下方、右缘对齐（超出视口左移）；
 * 不传 anchor 时屏幕居中。
 *
 * <p>`dock` 模式（画布）：不再是锚定浮层，而是铺满父容器的右侧停靠面板（父级给宽度 / 高度 / 圆角 / 投影）；
 * 不做「点外部关闭」（停靠栏常驻，边选节点边插入），Esc 在焦点不在别处输入框时关闭，关闭后焦点还给触发按钮；
 * 打开时焦点落在搜索框。每条提示词右上角另有「复制提示词」图标，只复制不插入（两种模式都有）。
 *
 * <p>根节点带 data-canvas-popover + tabindex=-1：画布页的全局快捷键（Backspace / Delete / Esc / Ctrl+C …）
 * 遇到焦点在浮层里就让给浮层；点到面板里的非控件区域时焦点落在面板本身，不会掉回 body 被画布当成操作选中节点。
 */
import IconButton from '@/components/IconButton/index.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  promptLibList,
  promptLibRemove,
  type IPromptLibCounts,
  type IPromptLibGroup,
  type IPromptLibItem,
} from '@/api/prompt-library.ts'
import { promptGroupLabel, promptGroupRank, promptSummary } from '@/utils/prompt-library'
import PromptEditor from '@/views/prompt-library/PromptEditor.vue'
import { useMessage } from 'naive-ui'

const message = useMessage()

const show = defineModel<boolean>('show', { default: false })

const emit = defineEmits<{
  /** 点了某条提示词：页面决定怎么插入 */
  select: [item: IPromptLibItem]
}>()

const props = defineProps<{
  /** 触发按钮元素（打开它的那个节点），面板按它定位；点它不算「点外部」 */
  anchor?: HTMLElement | null
  /** 面板标题（画布里叫「提示词库」）；不传沿用「我的提示词」 */
  heading?: string
  /** 选中提示词后保持面板打开（画布：连续往多个节点里插）；默认选完即关 */
  keepOpen?: boolean
  /** 右侧停靠面板形态（画布）：铺满父容器，不定位、不因点外部关闭 */
  dock?: boolean
}>()

const panelRef = ref<HTMLElement>()
const searchRef = ref<HTMLInputElement>()
/** 无锚点时屏幕居中 */
const CENTERED = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
const panelStyle = ref<Record<string, string>>(CENTERED)

// ---------- 过滤 ----------
const VERTICALS = [
  { key: 'ecommerce', label: '电商' },
  { key: 'general', label: '通用' },
  { key: 'mine', label: '我的' },
] as const
const MODELS = ['全部', '通用', 'GPT', 'Banana', 'Seedream'] as const

const vertical = ref<string>('ecommerce')
const model = ref<string>('全部')
const group = ref<string>('')
/** 搜索框里的原文；真正参与查询的是防抖后的 qApplied */
const q = ref<string>('')
const qApplied = ref<string>('')
const SEARCH_DEBOUNCE_MS = 250
const PAGE_SIZE = 50
let qTimer: ReturnType<typeof setTimeout> | null = null

function applyQuery() {
  if (qTimer) clearTimeout(qTimer)
  qTimer = null
  qApplied.value = q.value.trim()
}
watch(q, () => {
  if (qTimer) clearTimeout(qTimer)
  qTimer = setTimeout(applyQuery, SEARCH_DEBOUNCE_MS)
})
function clearQuery() {
  q.value = ''
  applyQuery()
  void nextTick(() => searchRef.value?.focus({ preventScroll: true }))
}

/** 各域总数（接口随列表返回，不受筛选影响）；旧后端没有时回退到「无筛选首页的 total」 */
const counts = ref<IPromptLibCounts | null>(null)
const fallbackTotals = ref<Record<string, number>>({})
const tabCount = (key: string): number | null => {
  const c = counts.value
  if (c) return key === 'ecommerce' ? c.ecommerce : key === 'general' ? c.general : c.mine
  return fallbackTotals.value[key] ?? null
}
const countsText = computed(() => {
  const c = counts.value
  if (c) return `公共 ${c.officialTotal} 条 · 我的 ${c.mineTotal} 条`
  const t = fallbackTotals.value
  const parts: string[] = []
  if (t.ecommerce != null && t.general != null) parts.push(`公共 ${t.ecommerce + t.general} 条`)
  if (t.mine != null) parts.push(`我的 ${t.mine} 条`)
  return parts.join(' · ')
})

const items = ref<IPromptLibItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref(false)
const loadMoreError = ref(false)
const hasMore = computed(() => items.value.length < total.value)
let seq = 0

/**
 * 分组选项：接口随列表返回各域的分组（有序、带中文名，不受筛选影响），首次打开就有。
 * 旧后端没有 groups 时，退回按域缓存「没按分组筛时」见过的分组（只增不减）。
 */
const apiGroups = ref<IPromptLibGroup[]>([])
const groupCache = ref<Record<string, string[]>>({})
const groups = computed<{ key: string; label: string }[]>(() => {
  const v = vertical.value
  const list = apiGroups.value.length
    ? apiGroups.value.filter((g) => g.vertical === v).map((g) => ({ key: g.key, label: promptGroupLabel(g.key, g.label) }))
    : [...(groupCache.value[v] ?? [])]
        .sort((a, b) => promptGroupRank(a) - promptGroupRank(b))
        .map((key) => ({ key, label: promptGroupLabel(key) }))
  if (group.value && !list.some((g) => g.key === group.value)) list.push({ key: group.value, label: promptGroupLabel(group.value) })
  return list
})
function rememberGroups(v: string, list: IPromptLibItem[]) {
  const known = groupCache.value[v] ?? []
  const fresh = list.map((it) => it.group).filter((g, i, arr) => !!g && !known.includes(g) && arr.indexOf(g) === i)
  if (fresh.length) groupCache.value = { ...groupCache.value, [v]: [...known, ...fresh] }
}

function currentParams(p = 1) {
  return {
    vertical: vertical.value,
    model: model.value === '全部' ? undefined : model.value,
    group: group.value || undefined,
    q: qApplied.value || undefined,
    page: p,
    pageSize: PAGE_SIZE,
  }
}
/** 最近一次发出的查询条件（不含页码）：筛选监听只在条件真的变了时才重拉 */
let lastKey = ''
const keyOf = (params: ReturnType<typeof currentParams>) => JSON.stringify({ ...params, page: 1 })

/** 重置并拉第一页（筛选变化 / 打开 / 增删改后）；序号守卫丢弃过期响应 */
async function load() {
  const ticket = ++seq
  const params = currentParams(1)
  lastKey = keyOf(params)
  loading.value = true
  loadingMore.value = false
  loadError.value = false
  loadMoreError.value = false
  items.value = []
  total.value = 0
  page.value = 1
  try {
    const res = await promptLibList(params)
    if (ticket !== seq) return
    items.value = dedupe(res.data?.items ?? [])
    total.value = res.data?.total ?? 0
    absorbMeta(params, res.data)
  } catch {
    if (ticket !== seq) return
    // 业务失败原因由拦截器统一提示；这里只把列表置为可重试的空态
    loadError.value = true
  } finally {
    if (ticket === seq) loading.value = false
  }
  if (ticket === seq) void nextTick(checkSentinel)
}

/** 触底加载下一页：追加到列表，条件在途中变了（序号变了）就丢弃 */
async function loadMore() {
  if (loading.value || loadingMore.value || loadError.value || !hasMore.value) return
  const ticket = ++seq
  const params = currentParams(page.value + 1)
  loadingMore.value = true
  loadMoreError.value = false
  try {
    const res = await promptLibList(params)
    if (ticket !== seq) return
    const more = res.data?.items ?? []
    items.value = dedupe([...items.value, ...more])
    total.value = res.data?.total ?? total.value
    page.value = params.page
    absorbMeta(params, res.data)
    // 服务端没再给数据却仍有「更多」：当作到底，别在哨兵上空转
    if (!more.length) total.value = items.value.length
  } catch {
    if (ticket !== seq) return
    loadMoreError.value = true
  } finally {
    if (ticket === seq) loadingMore.value = false
  }
  if (ticket === seq) void nextTick(checkSentinel)
}

function dedupe(list: IPromptLibItem[]) {
  const seen = new Set<number>()
  return list.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
}

function absorbMeta(params: ReturnType<typeof currentParams>, data?: { items: IPromptLibItem[]; total: number; groups?: IPromptLibGroup[]; counts?: IPromptLibCounts }) {
  if (!data) return
  if (data.groups) apiGroups.value = data.groups
  if (data.counts) counts.value = data.counts
  if (!data.groups && !params.group) rememberGroups(params.vertical, data.items ?? [])
  if (!data.counts && !params.group && !params.model && !params.q && params.page === 1) {
    fallbackTotals.value = { ...fallbackTotals.value, [params.vertical]: data.total }
  }
}

// ---------- 无限滚动：哨兵进入视口就加载下一页 ----------
const listRef = ref<HTMLElement>()
const sentinelRef = ref<HTMLElement>()
let observer: IntersectionObserver | null = null

function checkSentinel() {
  const el = sentinelRef.value
  const root = listRef.value
  if (!el || !root || !hasMore.value || loading.value || loadingMore.value || loadMoreError.value) return
  const a = el.getBoundingClientRect()
  const b = root.getBoundingClientRect()
  // 内容不满一屏时哨兵一直可见、不会再触发相交变化：这里主动补页
  if (a.top < b.bottom + 80 && a.bottom > b.top) void loadMore()
}
watch(sentinelRef, (el) => {
  observer?.disconnect()
  observer = null
  if (!el || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      if (loadMoreError.value) return
      if (entries.some((e) => e.isIntersecting)) void loadMore()
    },
    { root: listRef.value ?? null, rootMargin: '0px 0px 80px 0px' },
  )
  observer.observe(el)
})

// 换域：分组复位；筛选 / 防抖后的搜索词变化：按新条件从第一页重拉（lastKey 去重）
watch(vertical, () => {
  group.value = ''
})
watch([vertical, model, group, qApplied], () => {
  if (!show.value) return
  if (keyOf(currentParams()) === lastKey) return
  void load()
})
function onOpened() {
  group.value = ''
  q.value = ''
  applyQuery()
  void load()
  if (props.dock) {
    void nextTick(() => searchRef.value?.focus({ preventScroll: true }))
    return
  }
  place()
  requestAnimationFrame(place)
}
watch(show, (open) => {
  if (open) onOpened()
})

// ---------- 定位 / 关闭 ----------
function place() {
  const el = props.anchor
  if (!el) {
    panelStyle.value = CENTERED
    return
  }
  const r = el.getBoundingClientRect()
  const width = 400
  // 面板高度按 62vh 估（与 max-h 同口径）：top 夹住下沿，保证整块都在视口内
  const estH = Math.min(480, window.innerHeight * 0.62)
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - estH - 8))
  panelStyle.value = { left: `${left}px`, top: `${top}px` }
}

function onDocPointerDown(e: PointerEvent) {
  if (!show.value || props.dock) return
  const target = e.target as Node
  if (panelRef.value?.contains(target)) return
  if (props.anchor?.contains(target)) return
  // 上传 / 编辑弹窗是传送到 body 的：点它不算「点外部」
  if (editorShow.value) return
  show.value = false
}

/**
 * 捕获阶段监听：要赶在编辑弹窗自己的 Esc 处理（它会同步把 editorShow 置 false）之前判断，
 * 否则同一次 Esc 会既关弹窗又关浮层。弹窗开着时整个按键交给弹窗。
 */
function onKeydown(e: KeyboardEvent) {
  if (editorShow.value || e.defaultPrevented) return
  if (e.key === 'Escape' && show.value) {
    if (props.dock) {
      // 停靠栏常驻：焦点在面板外的输入框 / 文本编辑里时，Esc 留给那边（退出编辑）
      const t = e.target as HTMLElement | null
      const outside = !!t && !panelRef.value?.contains(t)
      if (outside && t.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return
    }
    e.preventDefault()
    e.stopPropagation()
    closePanel()
  }
}

/** 关闭并把焦点还给触发按钮（anchor 可能是包着按钮的 span） */
function closePanel() {
  show.value = false
  const a = props.anchor
  const target = a?.matches('button,[tabindex]') ? a : a?.querySelector<HTMLElement>('button,[tabindex]')
  void nextTick(() => target?.focus())
}

// ---------- 复制（只复制不插入） ----------
async function copyPrompt(item: IPromptLibItem) {
  const text = item.prompt ?? ''
  if (!text.trim()) return message.warning('这条提示词没有内容')
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    // 非安全上下文 / 权限被拒：退回隐藏 textarea + execCommand（长文本同样可用）
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
    document.body.appendChild(ta)
    ta.select()
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
  }
  if (ok) message.success('已复制')
  else message.warning('浏览器不允许复制，请手动选中文本复制')
}

function pick(item: IPromptLibItem) {
  emit('select', item)
  if (!props.keepOpen) show.value = false
}

// ---------- 我的提示词：上传 / 编辑 / 删除 ----------
const editorShow = ref(false)
const editing = ref<IPromptLibItem | null>(null)
const confirmingId = ref<number | null>(null)

function openUpload() {
  editing.value = null
  editorShow.value = true
}
function openEdit(item: IPromptLibItem) {
  editing.value = item
  editorShow.value = true
}
function onSaved() {
  // 新建的落在「我的」：切过去看（切域会自己重拉），已经在「我的」就原地刷新
  if (!editing.value && vertical.value !== 'mine') vertical.value = 'mine'
  else void load()
}
async function removeMine(item: IPromptLibItem) {
  try {
    await promptLibRemove(item.id)
    message.success('已删除')
    confirmingId.value = null
    void load()
  } catch {
    // 失败原因由拦截器统一提示
  }
}

const summary = promptSummary
/** 选中态：浮层沿用原渐变，停靠栏改用令牌（深色主题下不出现死色） */
const chipOn = (shadow = false) =>
  props.dock
    ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
    : `border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-600 text-violet-ink${shadow ? ' shadow-[0_1px_2px_rgba(31,35,41,0.05)]' : ''}`
const isFiltered = computed(() => !!(group.value || qApplied.value || model.value !== '全部'))

onMounted(() => {
  if (show.value) onOpened()
  document.addEventListener('pointerdown', onDocPointerDown, true)
  window.addEventListener('resize', place)
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (qTimer) clearTimeout(qTimer)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div
    v-if="show"
    ref="panelRef"
    class="flex flex-col box-border outline-none overflow-hidden"
    :class="
      dock
        ? 'h-full w-full min-h-0 border-0 bg-overlay'
        : 'fixed z-[6000] w-400px max-w-[calc(100vw-16px)] max-h-[min(480px,62vh)] rounded-18px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]'
    "
    :style="dock ? undefined : panelStyle"
    role="dialog"
    :aria-label="heading || '我的提示词'"
    tabindex="-1"
    data-canvas-popover
  >
    <!-- 头：标题 + 计数副标题 + 上传 + 关闭 -->
    <div class="flex-none flex items-center gap-8px min-h-52px py-6px pl-14px pr-8px shadow-[inset_0_-0.8px_0_var(--xq-line)]">
      <div class="min-w-0 flex-1 flex flex-col">
        <b class="truncate text-13px leading-18px font-600 text-ink">{{ heading || '我的提示词' }}</b>
        <span v-if="countsText" class="truncate text-11px leading-16px text-muted tabular-nums">{{ countsText }}</span>
      </div>
      <button
        type="button"
        class="flex-none inline-flex items-center gap-4px h-32px px-10px rounded-8px border border-solid border-line bg-white text-12px text-ink-2 cursor-pointer hover:(border-control text-ink) sx-focus"
        @click="openUpload"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-13px w-13px"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        上传
      </button>
      <IconButton label="关闭提示词库" variant="quiet" class="flex-none" @click="closePanel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </IconButton>
    </div>

    <!-- 搜索 + 适用模型 chips -->
    <div class="flex-none flex flex-col gap-6px p-6px pb-0">
      <div class="relative">
        <svg
          class="absolute left-10px top-9.5px h-13px w-13px text-placeholder pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        <input
          ref="searchRef"
          v-model="q"
          type="text"
          autocomplete="off"
          placeholder="搜场景、卖点、风格…"
          aria-label="搜索提示词"
          class="w-full h-32px box-border rounded-16px border border-solid border-control bg-white pl-27px pr-34px text-12px text-ink outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] [transition:border-color_110ms,box-shadow_110ms] hover:border-control-hover focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14)]) placeholder:text-placeholder"
        />
        <IconButton
          v-if="q"
          label="清空搜索"
          size="sm"
          variant="quiet"
          class="!absolute right-4px top-4px"
          @click="clearQuery"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </IconButton>
      </div>
      <div class="flex flex-wrap gap-4px" role="group" aria-label="适用模型">
        <button
          v-for="m in MODELS"
          :key="m"
          type="button"
          :aria-pressed="model === m"
          class="h-28px box-border px-12px rounded-full border border-solid text-12px leading-26px cursor-pointer [transition:background_140ms,border-color_140ms,color_140ms] motion-reduce:transition-none"
          :class="
            model === m
              ? chipOn()
              : 'border-line bg-white text-muted hover:(border-control text-ink)'
          "
          @click="model = m"
        >
          {{ m === '全部' ? m : modelLabelOf(m) }}
        </button>
      </div>
    </div>

    <!-- 域页签（官方电商 / 官方通用 / 我的） -->
    <div class="flex-none flex gap-2px p-6px pb-0" role="tablist" aria-label="提示词库域">
      <button
        v-for="v in VERTICALS"
        :key="v.key"
        type="button"
        role="tab"
        :aria-selected="vertical === v.key"
        class="h-32px flex-1 rounded-6px border border-solid text-12px cursor-pointer [transition:background_180ms,border-color_180ms,color_180ms] motion-reduce:transition-none"
        :class="
          vertical === v.key
            ? chipOn(true)
            : 'border-transparent bg-transparent text-muted hover:(bg-surface3 text-ink)'
        "
        @click="vertical = v.key"
      >
        {{ v.label
        }}<span v-if="tabCount(v.key) != null" class="ml-4px text-11px text-placeholder tabular-nums">{{
          tabCount(v.key)
        }}</span>
      </button>
    </div>

    <!-- 分组 chips：固定「全部」打头（不筛分组），其余来自接口 -->
    <div class="flex-none flex flex-wrap gap-4px p-6px pb-0" role="group" aria-label="分组">
      <button
        type="button"
        :aria-pressed="group === ''"
        class="h-28px box-border px-12px rounded-full border border-solid text-12px leading-26px cursor-pointer [transition:background_140ms,border-color_140ms,color_140ms] motion-reduce:transition-none"
        :class="group === '' ? chipOn() : 'border-line bg-white text-muted hover:(border-control text-ink)'"
        @click="group = ''"
      >
        全部
      </button>
      <button
        v-for="g in groups"
        :key="g.key"
        type="button"
        :aria-pressed="group === g.key"
        class="h-28px box-border px-12px rounded-full border border-solid text-12px leading-26px cursor-pointer [transition:background_140ms,border-color_140ms,color_140ms] motion-reduce:transition-none"
        :class="group === g.key ? chipOn() : 'border-line bg-white text-muted hover:(border-control text-ink)'"
        @click="group = g.key"
      >
        {{ g.label }}
      </button>
    </div>

    <!-- 列表 -->
    <div ref="listRef" class="flex-1 min-h-0 overflow-y-auto p-6px pt-6px [scrollbar-width:thin]">
      <p v-if="loading" class="m-0 py-18px text-center text-11px text-muted" role="status">加载中…</p>
      <div v-else-if="loadError" class="flex flex-col items-center gap-6px py-18px">
        <span class="text-11px text-muted">提示词库暂时读不到</span>
        <button
          type="button"
          class="h-32px px-14px rounded-14px border border-solid border-line bg-white text-13px text-ink-2 cursor-pointer hover:border-control"
          @click="load()"
        >
          重试
        </button>
      </div>
      <div v-else-if="!items.length" class="flex flex-col items-center gap-6px py-22px text-center">
        <svg
          viewBox="0 0 24 24"
          class="h-28px w-28px text-placeholder"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        <template v-if="vertical === 'mine' && !isFiltered">
          <span class="text-12px text-ink-2">还没有我的提示词</span>
          <button
            type="button"
            class="h-32px px-14px rounded-16px border border-solid border-violet-line bg-white text-12px font-600 text-violet-ink cursor-pointer hover:bg-surface2 sx-focus"
            @click="openUpload"
          >
            上传一条
          </button>
        </template>
        <template v-else>
          <span class="text-12px text-ink-2">没有匹配的提示词</span>
          <span class="text-11px text-muted">换个分类或清空搜索词再试</span>
        </template>
      </div>
      <ul v-else class="m-0 p-0 list-none flex flex-col gap-4px">
        <li
          v-for="item in items"
          :key="item.id"
          class="relative rounded-10px border border-solid border-transparent hover:(border-line bg-surface2)"
        >
          <button
            type="button"
            class="w-full box-border flex flex-col gap-4px items-stretch p-8px rounded-10px border-0 bg-transparent text-left cursor-pointer sx-focus"
            :title="item.prompt"
            @click="pick(item)"
          >
            <span class="flex items-center gap-6px min-w-0 pr-28px">
              <b class="min-w-0 flex-1 truncate text-13px font-600 text-ink">{{ item.title }}</b>
              <span
                v-for="m in modelLabelsOf(item.models).slice(0, 2)"
                :key="m"
                class="flex-none h-16px px-5px rounded-full bg-surface3 text-11px leading-16px text-muted"
                >{{ m }}</span
              >
            </span>
            <span class="text-11px leading-[1.45] text-muted break-all line-clamp-3">{{ summary(item.prompt) }}</span>
            <span v-if="item.group || item.tags?.length" class="flex flex-wrap items-center gap-4px">
              <span
                v-if="item.group"
                class="h-16px px-5px rounded-4px bg-violet-soft text-11px leading-16px text-violet-ink"
                >{{ promptGroupLabel(item.group, item.groupLabel) }}</span
              >
              <span
                v-for="t in (item.tags ?? []).slice(0, 3)"
                :key="t"
                class="h-16px px-5px rounded-4px border border-solid border-line text-11px leading-14px text-placeholder"
                >{{ t }}</span
              >
            </span>
          </button>
          <IconButton
            label="复制提示词"
            size="sm"
            variant="quiet"
            class="!absolute right-6px top-6px"
            @click.stop="copyPrompt(item)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2.5" />
              <path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" />
            </svg>
          </IconButton>
          <div v-if="item.owner === 'mine'" class="flex items-center justify-end gap-4px px-8px pb-6px">
            <template v-if="confirmingId === item.id">
              <span class="mr-auto text-12px text-danger">删除这条提示词？</span>
              <button
                type="button"
                class="h-32px px-10px rounded-8px border border-solid border-line bg-white text-12px text-ink-2 cursor-pointer sx-focus"
                @click="confirmingId = null"
              >
                取消
              </button>
              <button
                type="button"
                class="h-32px px-10px rounded-8px border border-solid border-danger bg-white text-12px text-danger cursor-pointer sx-focus"
                @click="removeMine(item)"
              >
                删除
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="h-32px px-10px rounded-8px border-0 bg-transparent text-12px text-muted cursor-pointer hover:(bg-surface3 text-ink) sx-focus"
                @click="openEdit(item)"
              >
                编辑
              </button>
              <button
                type="button"
                class="h-32px px-10px rounded-8px border-0 bg-transparent text-12px text-muted cursor-pointer hover:(bg-surface3 text-danger) sx-focus"
                @click="confirmingId = item.id"
              >
                删除
              </button>
            </template>
          </div>
        </li>
      </ul>
      <template v-if="!loading && !loadError && items.length">
        <p v-if="loadingMore" class="m-0 py-10px text-center text-11px text-muted" role="status">加载中…</p>
        <div v-else-if="loadMoreError" class="flex items-center justify-center gap-8px py-8px text-11px text-muted">
          加载更多失败
          <button
            type="button"
            class="h-28px px-10px rounded-14px border border-solid border-line bg-white text-12px text-ink-2 cursor-pointer hover:border-control"
            @click="loadMore()"
          >
            重试
          </button>
        </div>
        <p v-else-if="!hasMore" class="m-0 py-10px text-center text-11px text-placeholder">已显示全部 {{ total }} 条</p>
        <div v-if="hasMore" ref="sentinelRef" class="h-1px" aria-hidden="true" />
      </template>
    </div>

    <PromptEditor
      v-model:show="editorShow"
      :editing="editing"
      create-title="上传提示词"
      edit-title="编辑我的提示词"
      :z-index="6100"
      @saved="onSaved"
    />
  </div>
</template>
