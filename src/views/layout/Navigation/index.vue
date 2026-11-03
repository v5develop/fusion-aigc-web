<script setup lang="ts">
/**
 * 左侧主导航 —— 对齐新版 UI 原型（http://bdd1724.r3.cpolar.cn/#/ 首页外壳）。
 *
 * <p>结构：品牌块（logo 40 + 小岐AI / 一体化数字员工平台）→ 首页 → 「AI 创作」二级组
 * （智能体 / 画布 / AI 图片 / AI 视频）→ 电商 › / 商拍 › / 本地生活 → 我的资产 / 创意广场 →
 * 提示词库 → 弹性留白 → 更新条 + 用户行。
 * 「AI 图片」「AI 视频」点击直接进入落地页（/picture、/video），不再并排展开目录栏；工具页自带同一份目录。
 * 「本地生活」同样直接进落地页（/local-life）。电商 / 商拍仍点开 160 宽的二级目录栏（原型 motion-col-in：透明 + 左移 24px 滑入）。
 *
 * <p>原型侧栏没有的老入口（电商 / 商拍 / 本地生活 / 提示词库）按产品决定保留为独立的一级入口；
 * 电商 / 商拍点开后同样并排出二级目录（取已注册路由里带 meta.title 的下级静态页）。
 * 侧栏可收起为 44 图标条，此时「AI 创作」点开整组目录。
 *
 * <p>选中态取原型计算样式：底色 linear-gradient(#f3f4f5,#fafbfc) +
 * inset 0 1px 3px rgba(31,35,41,.10), inset 0 -1px 0 #fff，细描边，无左侧色条。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useUserInfoStore } from '@/stores/userInfo.ts'
import { catalogFor, type CatalogGroup } from '@/views/tools/catalog'

const props = defineProps<{
  /** 更新条标题（原型「部分功能有新版本」）；不传则不显示更新条 */
  updateNotice?: string
}>()

const emit = defineEmits<{
  /** 点了更新条「立即更新」 */
  update: []
}>()

const router = useRouter()
const route = useRoute()
const { userInfo } = storeToRefs(useUserInfoStore())
/** 手机号脱敏：前 3 位 + **** + 后 4 位；位数不足 7 时不展示 */
const maskedPhone = computed(() => {
  const p = (userInfo.value?.phone ?? '').replace(/\s|-/g, '')
  return p.length >= 7 ? `${p.slice(0, 3)}****${p.slice(-4)}` : ''
})

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL
const DEFAULT_AVATAR =
  'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp'

type PanelKey = 'image' | 'video' | 'ai' | 'e-commerce' | 'studio'

interface NavSub {
  name: string
  path: string
  /** 带二级目录栏的入口：点开目录而不只是跳转 */
  panel?: Exclude<PanelKey, 'ai'>
  /** 归属的工具目录：落地页与该目录下的工具页都算选中，但不展开目录栏 */
  owns?: 'image' | 'video'
  /** 一级老入口的图标（24×24 描边片段） */
  icon?: string
}

interface PanelEntry {
  key: string
  name: string
  /** 原型目录的灰色短说明；老入口没有则不出 */
  tagline?: string
  /** undefined = 即将开放 */
  route?: string
  icon?: string
  /** AI 创作组目录里，点开下一级目录栏 */
  panel?: Exclude<PanelKey, 'ai'>
  owns?: 'image' | 'video'
}

interface PanelGroup {
  label?: string
  entries: PanelEntry[]
}

const aiSubs: NavSub[] = [
  { name: '智能体', path: '/agent' },
  { name: '画布', path: '/canvas' },
  { name: 'AI 图片', path: '/picture', owns: 'image' },
  { name: 'AI 视频', path: '/video', owns: 'video' },
]

const ICON = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5z',
  spark: [
    'M10 7.5l1.6 4.4 4.4 1.6-4.4 1.6L10 19.5l-1.6-4.4L4 13.5l4.4-1.6L10 7.5z',
    'M17.5 3.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z',
    'M5 4v3M3.5 5.5h3',
  ],
  chevL: ['M14.5 5.5 8 12l6.5 6.5'],
  chevR: ['m9.5 5.5 6.5 6.5-6.5 6.5'],
  chevU: ['m5.5 14.5 6.5-6.5 6.5 6.5'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
}

/** 老入口图标（24×24 描边片段，与目录图标同规格） */
const LEGACY_ICON = {
  ecommerce: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  studio: '<path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4v-10z"/><path d="M12 16a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>',
  localLife:
    '<path d="M4 9.5 5.5 5h13L20 9.5"/><path d="M4 9.5h16v1a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-6 0v-1z"/><path d="M5.5 12.5V19h13v-6.5"/>',
  asset:
    '<path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-10z"/>',
  plaza:
    '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.2 2.4 3.3 5 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5-3.3-8S9.8 6.4 12 4z"/>',
  prompt:
    '<path d="M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M9.5 3.5v7l2.5-1.5 2.5 1.5v-7"/>',
}

// catalog.ts 只导出 catalogFor(toolId)：拿两类工具各一个 id 取对应目录
const toGroups = (groups: CatalogGroup[]): PanelGroup[] =>
  groups.map((g) => ({
    label: g.label,
    entries: g.entries.map((e) => ({ key: e.id, name: e.name, tagline: e.tagline, route: e.route, icon: e.icon })),
  }))
const imageCatalog = catalogFor('image-generate')
const videoCatalog = catalogFor('ai-video-enhance')

/** 原型侧栏没有、但产品决定保留的一级入口，接在「AI 创作」组之后；我的资产、创意广场与提示词库无下级目录 */
const legacySubs: NavSub[] = [
  { name: 'AI 电商', path: '/e-commerce', panel: 'e-commerce', icon: LEGACY_ICON.ecommerce },
  { name: 'AI 商拍', path: '/studio', panel: 'studio', icon: LEGACY_ICON.studio },
  // 本地生活与 AI 图片 / AI 视频一样直接进落地页（/local-life），不再展开二级目录栏
  { name: '本地生活', path: '/local-life', icon: LEGACY_ICON.localLife },
  { name: '我的资产', path: '/asset-library', icon: LEGACY_ICON.asset },
  { name: '创意广场', path: '/plaza', icon: LEGACY_ICON.plaza },
  { name: '提示词库', path: '/prompt-library', icon: LEGACY_ICON.prompt },
]

/** 某一入口下的页面目录：取已注册路由里带 meta.title 的下级静态页，不新增路由 */
function routeGroups(path: string): PanelGroup[] {
  const entries = router
    .getRoutes()
    .filter((r) => r.path.startsWith(path + '/') && !r.path.includes(':') && typeof r.meta?.title === 'string')
    .map((r) => ({ key: r.path, name: r.meta.title as string, route: r.path }))
  return [{ entries }]
}

const panels: Record<'image' | 'video' | 'ai', { title: string; groups: PanelGroup[] }> = {
  image: { title: imageCatalog.title, groups: toGroups(imageCatalog.groups) },
  video: { title: videoCatalog.title, groups: toGroups(videoCatalog.groups) },
  ai: {
    title: 'AI 创作',
    groups: [
      { entries: aiSubs.map((s) => ({ key: s.path, name: s.name, route: s.path, panel: s.panel, owns: s.owns })) },
    ],
  },
}

/** 路由前缀是否命中（老入口按模块前缀，工具页按完整路径） */
function matches(path: string, prefix: string) {
  if (prefix === '/') return path === '/'
  return path === prefix || path.startsWith(prefix + '/')
}

const panelRoutes = (key: 'image' | 'video') =>
  panels[key].groups.flatMap((g) => g.entries.map((e) => e.route).filter((r): r is string => !!r))

const ownedRoutes: Partial<Record<PanelKey, string[]>> = {
  image: ['/picture', ...panelRoutes('image')],
  video: ['/video', ...panelRoutes('video')],
}

// ---------- 原型样式（UnoCSS） ----------
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2'
/** 原型导航行无过渡（计算样式 transition: all 0s），悬停直接换底 */
const ROW_BASE =
  'relative flex w-full items-center border border-solid border-transparent rounded-8px bg-transparent ' +
  'text-left text-14px cursor-pointer hover:bg-surface3 hover:text-ink ' +
  FOCUS
/** 选中态 = 内凹 + 细描边，无左侧色条（值取自原型计算样式） */
const ACTIVE =
  '!border-line !text-ink bg-[linear-gradient(#f3f4f5,#fafbfc)] ' +
  'shadow-[inset_0_1px_3px_rgba(31,35,41,0.10),inset_0_-1px_0_#fff] hover:bg-[linear-gradient(#f3f4f5,#fafbfc)]'

const collapsed = ref(false)
const aiExpanded = ref(true)
const updateDismissed = ref(false)
const panel = ref<PanelKey | null>(null)
const panelRef = ref<HTMLElement>()
let anchorEl: HTMLElement | null = null

const showUpdateBar = computed(() => !!props.updateNotice && !updateDismissed.value && !collapsed.value)
const homeActive = computed(() => route.path === '/')

function subActive(sub: NavSub) {
  if (sub.owns) return (ownedRoutes[sub.owns] ?? [sub.path]).some((p) => matches(route.path, p))
  if (sub.panel) return panel.value === sub.panel || matches(route.path, sub.path)
  return matches(route.path, sub.path)
}

const legacyActive = (sub: NavSub) => subActive(sub)
const aiSubActive = computed(() => aiSubs.some(subActive))

function rowClass(active: boolean) {
  return [
    ROW_BASE,
    'h-44px gap-10px',
    collapsed.value ? 'justify-center px-0' : 'px-10px',
    active ? `${ACTIVE} font-600` : 'text-ink-2 font-500',
  ]
}

function subClass(active: boolean) {
  return [ROW_BASE, 'h-40px gap-6px pl-38px pr-10px', active ? `${ACTIVE} font-500` : 'text-muted font-400']
}

function entryActive(e: PanelEntry) {
  if (e.panel) return panel.value === e.panel
  if (e.owns) return (ownedRoutes[e.owns] ?? []).some((p) => matches(route.path, p))
  return !!e.route && matches(route.path, e.route)
}

function focusPanel(which: 'first' | 'last') {
  void nextTick(() => {
    const nodes = panelRef.value?.querySelectorAll<HTMLElement>('[data-panel-node]')
    if (nodes?.length) nodes[which === 'last' ? nodes.length - 1 : 0]?.focus()
  })
}

function openPanel(key: PanelKey, anchor: HTMLElement | null, focus?: 'first' | 'last') {
  panel.value = key
  if (anchor) anchorEl = anchor
  if (focus) focusPanel(focus)
}

function closePanel(returnFocus = false) {
  if (!panel.value) return
  panel.value = null
  if (returnFocus) anchorEl?.focus()
  anchorEl = null
}

/** 键盘（Enter / 空格）触发的 click 的 detail 为 0：打开后把焦点送进目录 */
const viaKeyboard = (e: MouseEvent) => e.detail === 0

function onSubClick(sub: NavSub, e: MouseEvent) {
  if (!sub.panel) {
    go(sub.path)
    return
  }
  if (panel.value === sub.panel) {
    closePanel()
    return
  }
  void router.push(sub.path)
  openPanel(sub.panel, e.currentTarget as HTMLElement, viaKeyboard(e) ? 'first' : undefined)
}

function onAiRowClick(e: MouseEvent) {
  if (collapsed.value) {
    if (panel.value === 'ai') closePanel()
    else openPanel('ai', e.currentTarget as HTMLElement, viaKeyboard(e) ? 'first' : undefined)
    return
  }
  aiExpanded.value = !aiExpanded.value
}

function onEntryClick(e: PanelEntry, ev: MouseEvent) {
  if (e.panel) {
    if (e.route) void router.push(e.route)
    openPanel(e.panel, null, viaKeyboard(ev) ? 'first' : undefined)
    return
  }
  if (e.route) go(e.route)
}

function onPanelKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePanel(true)
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const nodes = Array.from(panelRef.value?.querySelectorAll<HTMLElement>('[data-panel-node]') ?? [])
  if (!nodes.length) return
  e.preventDefault()
  const idx = nodes.indexOf(document.activeElement as HTMLElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  nodes[(idx + step + nodes.length) % nodes.length]?.focus()
}

function go(path: string) {
  void router.push(path)
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  closePanel()
}

// 跳出目录所属页面就收起目录栏：工具页自带同一份目录，避免并排出现两份
watch(
  () => route.path,
  (path) => {
    if (!panel.value) return
    // 收起态的整组目录：选完即收；切到 AI 图片 / AI 视频目录时 panel 已先一步换成对应 key
    if (panel.value === 'ai') {
      closePanel()
      return
    }
    const owner = [...aiSubs, ...legacySubs].find((s) => s.panel === panel.value)
    if (owner && path !== owner.path) closePanel()
  },
)

const currentPanel = computed(() => {
  const key = panel.value
  if (!key) return null
  if (key === 'image' || key === 'video' || key === 'ai') return panels[key]
  const owner = legacySubs.find((s) => s.panel === key)
  return owner ? { title: owner.name, groups: routeGroups(owner.path) } : null
})
</script>

<template>
  <aside class="sticky top-0 z-60 flex h-100vh overflow-hidden bg-white shadow-[10px_0_16px_-12px_rgba(31,35,41,0.22)]">
    <div
      class="group flex h-full min-h-0 flex-none flex-col border-r border-r-solid border-r-line bg-white pt-13px transition-[width] duration-150"
      :class="collapsed ? 'w-44px px-2px' : 'w-204px px-12px'"
    >
      <!-- 品牌块：logo 40 + 双行字；收起按钮悬停 / 聚焦时才出现（原型无常驻按钮） -->
      <div class="relative flex flex-none items-center gap-10px" :class="collapsed ? 'flex-col' : 'pl-2px'">
        <img
          class="block h-40px w-40px flex-none rounded-8px object-contain"
          :src="VITE_OSS_ASSET_URL + 'logo.png'"
          :alt="collapsed ? '小岐AI' : ''"
        />
        <span v-if="!collapsed" class="min-w-0">
          <b class="block text-20px font-600 leading-[1.2] tracking-[.01em] text-ink">小岐AI</b>
          <small class="mt-1px block whitespace-nowrap text-12px font-400 leading-[1.4] text-muted">
            一体化数字员工平台
          </small>
        </span>
        <button
          type="button"
          class="grid h-24px w-24px place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer hover:bg-surface3 hover:text-ink"
          :class="[
            FOCUS,
            collapsed
              ? 'h-32px w-32px'
              : 'absolute right-0 top-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          ]"
          :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
          :title="collapsed ? '展开侧栏' : '收起侧栏'"
          :aria-expanded="!collapsed"
          @click="toggleCollapsed"
        >
          <svg
            class="h-14px w-14px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path v-for="d in collapsed ? ICON.chevR : ICON.chevL" :key="d" :d="d" />
          </svg>
        </button>
      </div>

      <!-- 导航行；矮视口下允许滚动，兜底不把更新条/用户行挤出去 -->
      <nav
        class="mt-16px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex min-h-0 flex-col gap-2px overflow-y-auto"
        aria-label="主导航"
      >
        <button
          type="button"
          :class="rowClass(homeActive)"
          :aria-current="homeActive ? 'page' : undefined"
          :aria-label="collapsed ? '首页' : undefined"
          :title="collapsed ? '首页' : undefined"
          @click="go('/')"
        >
          <svg
            class="h-18px w-18px flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="ICON.home" />
          </svg>
          <span v-if="!collapsed" class="min-w-0 flex-1">首页</span>
        </button>

        <!-- AI 创作：展开态点击开合二级；收起态点开整组目录栏 -->
        <button
          type="button"
          :class="rowClass((collapsed || !aiExpanded) && aiSubActive)"
          :aria-expanded="collapsed ? panel === 'ai' : aiExpanded"
          :aria-haspopup="collapsed ? 'menu' : undefined"
          :aria-label="collapsed ? 'AI 创作' : undefined"
          :title="collapsed ? 'AI 创作' : undefined"
          @click="onAiRowClick"
        >
          <svg
            class="h-18px w-18px flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path v-for="d in ICON.spark" :key="d" :d="d" />
          </svg>
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1">AI 创作</span>
            <svg
              class="h-12px w-12px flex-none text-placeholder transition-transform duration-150"
              :class="aiExpanded ? '' : 'rotate-180'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-for="d in ICON.chevU" :key="d" :d="d" />
            </svg>
          </template>
        </button>

        <div
          v-if="!collapsed"
          class="flex flex-col gap-2px overflow-hidden transition-all duration-150"
          :class="aiExpanded ? 'max-h-[400px] opacity-100' : 'invisible max-h-0 opacity-0'"
        >
          <button
            v-for="sub in aiSubs"
            :key="sub.path"
            type="button"
            :class="subClass(subActive(sub))"
            :aria-current="!sub.panel && subActive(sub) ? 'page' : undefined"
            :aria-haspopup="sub.panel ? 'menu' : undefined"
            :aria-expanded="sub.panel ? panel === sub.panel : undefined"
            @click="onSubClick(sub, $event)"
          >
            <span class="min-w-0 flex-1">{{ sub.name }}</span>
            <svg
              v-if="sub.panel"
              class="h-12px w-12px flex-none text-placeholder"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-for="d in ICON.chevR" :key="d" :d="d" />
            </svg>
          </button>
        </div>

        <!-- 电商 / 商拍 / 本地生活 / 提示词库：独立一级入口；带下级目录的点开并排目录栏 -->
        <button
          v-for="sub in legacySubs"
          :key="sub.path"
          type="button"
          :class="rowClass(legacyActive(sub))"
          :aria-current="!sub.panel && legacyActive(sub) ? 'page' : undefined"
          :aria-haspopup="sub.panel ? 'menu' : undefined"
          :aria-expanded="sub.panel ? panel === sub.panel : undefined"
          :aria-label="collapsed ? sub.name : undefined"
          :title="collapsed ? sub.name : undefined"
          @click="onSubClick(sub, $event)"
        >
          <svg
            class="h-18px w-18px flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            :innerHTML="sub.icon"
          />
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1">{{ sub.name }}</span>
            <svg
              v-if="sub.panel"
              class="h-12px w-12px flex-none text-placeholder"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-for="d in ICON.chevR" :key="d" :d="d" />
            </svg>
          </template>
        </button>
      </nav>

      <div class="min-h-12px flex-1"></div>

      <!-- 更新条：藤紫渐变 + 内高光 + 双层短投影（原型计算样式） -->
      <div
        v-if="showUpdateBar"
        class="flex-none rounded-8px border border-solid border-violet-border bg-gradient-to-b from-violet-top to-violet-bottom pb-8px pl-11px pr-10px pt-10px text-12px leading-18px text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)]"
        role="status"
      >
        <div class="flex items-center gap-7px font-500">
          <svg
            class="h-12px w-12px flex-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path v-for="d in ICON.info" :key="d" :d="d" />
          </svg>
          <span class="min-w-0">{{ props.updateNotice }}</span>
        </div>
        <p class="m-0 pl-19px text-white/75">需要升级客户端后使用</p>
        <div class="mt-4px flex justify-end gap-6px">
          <button
            type="button"
            class="h-22px rounded-4px border border-solid border-white/40 bg-transparent px-8px text-12px leading-none text-white cursor-pointer transition-[background,border-color,box-shadow] duration-120 ease-[ease] hover:border-white/70 hover:bg-white/10"
            :class="FOCUS"
            @click="updateDismissed = true"
          >
            稍后
          </button>
          <button
            type="button"
            class="h-22px rounded-4px border border-solid border-white bg-white px-8px text-12px leading-none text-violet-ink cursor-pointer shadow-[0_1px_2px_rgba(40,24,48,0.18)] transition-[background,border-color,box-shadow] duration-120 ease-[ease] hover:bg-violet-soft"
            :class="FOCUS"
            @click="emit('update')"
          >
            立即更新
          </button>
        </div>
      </div>

      <!-- 用户行：头像 32 + 脱敏手机号 + 可用点数（原型：手机号为首行） -->
      <div
        class="mb-20px mt-10px flex flex-none items-center gap-10px py-9px"
        :class="collapsed ? 'justify-center px-0' : 'px-0'"
        :title="collapsed ? `可用点数 ${userInfo?.availablePoints ?? '-'}` : undefined"
      >
        <img
          class="block h-32px w-32px flex-none rounded-full object-cover"
          :src="userInfo?.avatar || DEFAULT_AVATAR"
          alt="头像"
        />
        <span v-if="!collapsed" class="flex min-w-0 flex-col gap-2px">
          <span v-if="maskedPhone" class="truncate text-14px font-400 text-ink" :title="maskedPhone">{{
            maskedPhone
          }}</span>
          <span class="flex min-w-0 items-center gap-6px text-12px font-400 text-muted">
            <i class="icon-ic_hone_bean flex-none text-violet" aria-hidden="true"></i>
            <span class="break-all" aria-label="可用点数">{{ userInfo?.availablePoints }}</span>
          </span>
        </span>
      </div>
    </div>

    <!-- 二级目录栏：160 宽、白底、右描边，并排在侧栏右侧（原型 motion-col-in 滑入） -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 -translate-x-24px">
      <div
        v-if="currentPanel"
        ref="panelRef"
        class="relative z-1 flex h-full w-160px flex-none flex-col border-r border-r-solid border-r-line bg-white"
        role="dialog"
        :aria-label="currentPanel.title + '目录'"
        @keydown="onPanelKeydown"
      >
        <div class="flex h-48px flex-none items-center pl-15px pr-15px">
          <b class="min-w-0 flex-1 text-16px font-600 leading-[1.25] text-ink">{{ currentPanel.title }}</b>
          <button
            type="button"
            class="grid h-24px w-24px flex-none place-items-center rounded-4px border-none bg-transparent p-0 text-placeholder cursor-pointer hover:bg-surface3 hover:text-ink"
            :class="FOCUS"
            aria-label="收起目录"
            title="收起目录"
            @click="closePanel(true)"
          >
            <svg
              class="h-14px w-14px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path v-for="d in ICON.menu" :key="d" :d="d" />
            </svg>
          </button>
        </div>

        <div
          class="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-h-0 flex-1 overflow-y-auto px-7px pb-12px"
          role="menu"
          :aria-label="currentPanel.title"
        >
          <section
            v-for="(g, gi) in currentPanel.groups"
            :key="g.label ?? gi"
            :class="gi ? 'mt-16px border-t border-t-solid border-t-line pt-14px' : 'pt-4px'"
          >
            <h3 v-if="g.label" class="m-0 mb-6px px-8px text-12px font-500 leading-18px text-muted">
              {{ g.label }}
            </h3>
            <component
              :is="e.route || e.panel ? 'button' : 'div'"
              v-for="e in g.entries"
              :key="e.key"
              :type="e.route || e.panel ? 'button' : undefined"
              role="menuitem"
              :data-panel-node="e.route || e.panel ? '' : undefined"
              :aria-current="!e.panel && entryActive(e) ? 'page' : undefined"
              :aria-disabled="e.route || e.panel ? undefined : 'true'"
              :aria-label="e.route || e.panel ? undefined : `${e.name}（即将开放）`"
              class="flex w-full items-center gap-10px rounded-8px border border-solid border-transparent bg-transparent text-left"
              :class="[
                e.icon ? 'h-48px pl-19px pr-8px' : 'h-40px px-8px',
                e.route || e.panel ? ['cursor-pointer hover:bg-surface3', FOCUS] : 'cursor-not-allowed',
                entryActive(e) ? ACTIVE : '',
              ]"
              @click="(e.route || e.panel) && onEntryClick(e, $event)"
            >
              <span
                v-if="e.icon"
                class="grid h-36px w-36px flex-none place-items-center rounded-6px border border-solid border-violet-soft-2 bg-violet-soft"
                :class="e.route ? 'text-violet-ink' : 'text-muted opacity-60'"
                aria-hidden="true"
              >
                <svg
                  class="h-16px w-16px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :innerHTML="e.icon"
                />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-13px leading-18px text-ink" :class="e.icon ? 'font-600' : 'font-400'">
                  {{ e.name }}
                </span>
                <span v-if="e.tagline" class="truncate text-11px leading-16px text-muted">{{ e.tagline }}</span>
              </span>
              <svg
                v-if="e.panel"
                class="h-12px w-12px flex-none text-placeholder"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path v-for="d in ICON.chevR" :key="d" :d="d" />
              </svg>
            </component>
          </section>
        </div>
      </div>
    </Transition>
  </aside>
</template>
