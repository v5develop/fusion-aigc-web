<script setup lang="ts">
/**
 * 左侧主导航 —— 对齐新版 UI 原型（http://bdd1724.r3.cpolar.cn/#/ 首页外壳）。
 *
 * <p>结构：品牌块（logo 40 + 小岐AI / 一体化数字员工平台）→ 首页 → 「AI 创作」二级组
 * （智能体 / 工作流 / 画布 / AI 图片 / AI 视频）→ 电商 › / 商拍 › / 本地生活 → 我的资产 / 创意广场 →
 * 提示词库 → 弹性留白 → 更新条 + 用户行。
 * 「AI 图片」「AI 视频」点击直接进入落地页（/image、/video），不再并排展开目录栏；工具页自带同一份目录。
 * 「本地生活」同样直接进落地页（/local-life）。电商 / 商拍仍点开 160 宽的二级目录栏（原型 motion-col-in：透明 + 左移 24px 滑入）。
 *
 * <p>原型侧栏没有的老入口（电商 / 商拍 / 本地生活 / 提示词库）按产品决定保留为独立的一级入口；
 * 电商 / 商拍点开后同样并排出二级目录（取已注册路由里带 meta.title 的下级静态页）。
 * 侧栏可收起为 44 图标条，此时「AI 创作」点开整组目录。
 *
 * <p>选中态取原型计算样式：底色 linear-gradient(#f3f4f5,#fafbfc) +
 * inset 0 1px 3px rgba(31,35,41,.10), inset 0 -1px 0 #fff，细描边，无左侧色条。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { NDropdown, useDialog, type DropdownOption } from 'naive-ui'
import { signOut } from '@/api/auth.ts'
import { useUserInfoStore } from '@/stores/userInfo.ts'
import { catalogFor, type CatalogGroup } from '@/views/tools/catalog'
import { tools } from '@/views/home/tools'
import { chuandaitu_data, shangpingshiping_data, shangpingtu_data, type EcEntry } from '@/views/e-commerce/entries'
import NotificationBell from '@/components/notifications/NotificationBell.vue'
import CheckInButton from '@/components/check-in/CheckInButton.vue'

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

// ---------- 账号菜单：用户中心 / 退出登录 ----------
const dialog = useDialog()
const accountRef = ref<HTMLElement>()
const accountOpen = ref(false)
const signingOut = ref(false)
const accountOptions = computed<DropdownOption[]>(() => [
  { label: '用户中心', key: 'user-center' },
  { label: '退出登录', key: 'sign-out', disabled: signingOut.value },
])

/** 菜单关闭（选中 / Esc / 点外部）后把焦点还给账号行 */
function onAccountShow(show: boolean) {
  accountOpen.value = show
  if (!show) void nextTick(() => accountRef.value?.focus())
}

function confirmSignOut() {
  dialog.warning({
    title: '退出登录',
    content: '确定退出当前账号吗？',
    positiveText: '退出',
    negativeText: '取消',
    onPositiveClick: async () => {
      signingOut.value = true
      try {
        await signOut()
      } finally {
        signingOut.value = false
      }
    },
  })
}

function onAccountSelect(key: string) {
  if (key === 'user-center') void router.push({ name: 'user-center' })
  else if (key === 'sign-out' && !signingOut.value) confirmSignOut()
}

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
  // 原型 AppSidebar 的 AI 创作组：智能体之后即工作流；进导航首页 /workflow/home，模板页 /workflow?flow=&category=&template= 由首页卡片进
  { name: '工作流', path: '/workflow/home' },
  { name: '画布', path: '/canvas' },
  { name: 'AI 图片', path: '/image', owns: 'image' },
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
  tasks:
    '<path d="M6 4.5h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z"/><path d="m8.5 9 1.5 1.5L12.5 8M8.5 15l1.5 1.5 2.5-2.5M14.5 9.5h1.5M14.5 15.5h1.5"/>',
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
  { name: '我的资产', path: '/assets', icon: LEGACY_ICON.asset },
  { name: '任务中心', path: '/tasks', icon: LEGACY_ICON.tasks },
  { name: '创意广场', path: '/plaza', icon: LEGACY_ICON.plaza },
  { name: '提示词库', path: '/prompt-library', icon: LEGACY_ICON.prompt },
]

/**
 * 电商 / 商拍目录的条目图标（24×24 描边片段），按路由取。
 * 原型目录有同名功能的用原型图标（qi-tool-icons.mjs，与首页工具箱注册表里抄来的是同一份）：
 * 视频复刻 / 商品替换 / 模特替换 / 服装去皱 / 商拍换装 / 姿态复刻 / 图片生成；
 * 原型没有的功能借本项目已用的最近似图标（注册表工具图标，或商拍首页 studio/index.vue 的线性图标）。
 */
const toolIcon = (id: string) => tools.find((t) => t.id === id)?.icon
const paths = (ds: string[]) => ds.map((d) => `<path d="${d}"/>`).join('')
const ENTRY_ICON: Record<string, string | undefined> = {
  // 原型没有：借「首屏主图」（手机首屏 + 主图）
  '/e-commerce/product-detail': toolIcon('ai-first-screen-main-image'),
  // 原型没有：借「商品精修」（商品瓶 + 星芒）
  '/e-commerce/product-kit': toolIcon('ai-product-retouch'),
  // 原型没有：借商拍首页「循环箭头」（studio/index.vue ICONS.repeat）
  '/e-commerce/product-clone': paths([
    'M17 2l3 3-3 3',
    'M4 11V9a4 4 0 0 1 4-4h12',
    'M7 22l-3-3 3-3',
    'M20 13v2a4 4 0 0 1-4 4H4',
  ]),
  // 原型没有：借商拍首页「人像」（studio/index.vue ICONS.person）
  '/e-commerce/product-in-hand': paths(['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-6 8-6s8 2 8 6']),
  '/e-commerce/video-clone': toolIcon('ai-video-clone'),
  // 原型没有：借「视频生成」（播放键 + 大星芒）
  '/e-commerce/video-hot': toolIcon('ai-video-generator'),
  // 原型 qi-tool-icons.mjs「model-replace」（两个人 + 交换）；注册表里没有，原样抄过来
  '/e-commerce/model-replace': `
    <circle cx="5.8" cy="7.2" r="2.2"/>
    <path d="M1.9 15.4c.3-2.6 1.7-4.1 3.9-4.1s3.6 1.5 3.9 4.1"/>
    <circle cx="18.2" cy="7.2" r="2.2"/>
    <path d="M14.3 15.4c.3-2.6 1.7-4.1 3.9-4.1s3.6 1.5 3.9 4.1"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  '/e-commerce/product-replace': toolIcon('product-replace'),
  // 原型没有：借「场景生成」（风景相框 + 小星芒）
  '/e-commerce/change-background': toolIcon('ai-background-generator'),
  // 原型没有：借商拍首页「上衣」（studio/index.vue ICONS.shirt）
  '/e-commerce/clothing-kit': paths(['M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z']),
  // 原型没有：借「商拍换装」（T 恤 + 交换箭头）
  '/e-commerce/clothing-try': toolIcon('ai-digital-model'),
  '/e-commerce/clothing-remove-wrinkle': toolIcon('cloth-wrinkle-removal'),
  // 原型没有：借商拍首页「图片」（studio/index.vue ICONS.images）
  '/e-commerce/merge-image': paths([
    'M3 5h18v14H3z',
    'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'M21 15l-5-5-9 9',
  ]),
  // 原型没有：借商拍首页「姿态」全身剪影（studio/index.vue ICONS.pose）
  '/e-commerce/try-shoe': paths(['M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M5 9l7 1 7-3', 'M12 10v5l-4 6', 'M12 15l4 6']),
  '/studio/ai-digital-model': toolIcon('ai-digital-model'),
  '/studio/ai-posture-fission': toolIcon('ai-posture-fission'),
  '/studio/image-generate': toolIcon('image-generate'),
}
/** 以后新加的下级页还没配图标时，与工具目录同一做法借「图片生成」占位，保持图标框一致 */
const PLACEHOLDER_ICON = toolIcon('image-generate')

/**
 * AI 电商目录的分组：与电商首页（views/e-commerce/index.vue）同源，组名与组内顺序都取 entries.ts。
 * 搭配融图只在首页摘了卡片、路由仍在：侧栏照旧保留，放回它在穿戴图里原来的位置（服装去皱之后）。
 */
const withMergeImage = (list: EcEntry[]) =>
  list.flatMap((e) => (e.pathName === 'clothing-remove-wrinkle' ? [e.pathName, 'merge-image'] : [e.pathName]))
const EC_GROUPS: { label: string; names: string[] }[] = [
  { label: '商品图', names: shangpingtu_data.map((e) => e.pathName) },
  { label: '商品视频', names: shangpingshiping_data.map((e) => e.pathName) },
  { label: '穿戴图', names: withMergeImage(chuandaitu_data) },
]

/** 某一入口下的页面目录：取已注册路由里带 meta.title 的下级静态页，不新增路由 */
function routeGroups(path: string): PanelGroup[] {
  const routes = router
    .getRoutes()
    .filter((r) => r.path.startsWith(path + '/') && !r.path.includes(':') && typeof r.meta?.title === 'string')
  const toEntry = (r: (typeof routes)[number]): PanelEntry => ({
    key: r.path,
    name: r.meta.title as string,
    route: r.path,
    icon: ENTRY_ICON[r.path] ?? PLACEHOLDER_ICON,
  })
  if (path !== '/e-commerce') return [{ entries: routes.map(toEntry) }]
  const byName = new Map(routes.map((r) => [String(r.name), r]))
  const groups = EC_GROUPS.map((g) => ({
    label: g.label,
    entries: g.names.flatMap((n) => {
      const r = byName.get(n)
      if (!r) return []
      byName.delete(n)
      return [toEntry(r)]
    }),
  }))
  // 以后新加、还没归组的电商页：接在最后一组末尾，不丢入口
  groups[groups.length - 1]?.entries.push(...[...byName.values()].map(toEntry))
  return groups.filter((g) => g.entries.length)
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
  image: ['/image', ...panelRoutes('image')],
  video: ['/video', ...panelRoutes('video')],
}

// ---------- 原型样式（UnoCSS） ----------
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2'
/** 原型导航行无过渡（计算样式 transition: all 0s），悬停直接换底；r6（NextSidebar.vue:379-391） */
const ROW_BASE =
  'relative flex w-full items-center border border-solid border-transparent rounded-md bg-transparent ' +
  'text-left text-14px text-ink-2 cursor-pointer hover:bg-surface3 hover:text-ink ' +
  FOCUS
/** 选中态 = 内凹 + 细描边，无左侧色条，不加粗（NextSidebar.vue:413-417） */
const ACTIVE = '!border-line !text-ink sx-grad-sunk shadow-sunk hover:sx-grad-sunk'

const collapsed = ref(false)
const aiExpanded = ref(true)
const updateDismissed = ref(false)
const panel = ref<PanelKey | null>(null)
const panelRef = ref<HTMLElement>()
let anchorEl: HTMLElement | null = null

const showUpdateBar = computed(() => !!props.updateNotice && !updateDismissed.value && !collapsed.value)
const homeActive = computed(() => route.path === '/tools')

function subActive(sub: NavSub) {
  if (sub.owns) return (ownedRoutes[sub.owns] ?? [sub.path]).some((p) => matches(route.path, p))
  if (sub.panel) return panel.value === sub.panel || matches(route.path, sub.path)
  // 工作流：导航首页 /workflow/home 与模板页 /workflow 同属一个入口，进模板页也保持高亮
  if (sub.path === '/workflow/home') return route.path === '/workflow/home' || route.path === '/workflow'
  return matches(route.path, sub.path)
}

const legacyActive = (sub: NavSub) => subActive(sub)
const aiSubActive = computed(() => aiSubs.some(subActive))

/** 一级 `.v3-row`：高 44、14/500、gap 10、内边距 0 10 */
function rowClass(active: boolean) {
  return [
    ROW_BASE,
    'h-44px flex-none gap-10px font-500',
    collapsed.value ? 'justify-center px-0' : 'px-10px',
    active ? ACTIVE : '',
  ]
}

/** 二级 `.v3-sub`：高 40、14/400、左内边距 38（文字与一级文字对齐） */
function subClass(active: boolean) {
  return [ROW_BASE, 'h-40px flex-none gap-10px pl-38px pr-10px font-400', active ? ACTIVE : '']
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

// 视口 <1440 时目录以浮层出现（原型 App.vue:125-135），点浮层外部即收起；≥1440 并排在布局里，行为不变
const asideRef = ref<HTMLElement>()
let wideMq: MediaQueryList | null = null
function onDocPointerDown(e: PointerEvent) {
  if (!panel.value || wideMq?.matches) return
  if (asideRef.value && !asideRef.value.contains(e.target as Node)) closePanel()
}
onMounted(() => {
  wideMq = window.matchMedia('(min-width: 1440px)')
  document.addEventListener('pointerdown', onDocPointerDown)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))

const currentPanel = computed(() => {
  const key = panel.value
  if (!key) return null
  if (key === 'image' || key === 'video' || key === 'ai') return panels[key]
  const owner = legacySubs.find((s) => s.panel === key)
  return owner ? { title: owner.name, groups: routeGroups(owner.path) } : null
})

// ---------- 电商 / 商拍目录的收起条（与工具页目录 views/tools/index.vue 同一做法、同一组原型值） ----------
/** 只有电商 / 商拍目录可收起；收起 = 44 宽图标条（原型 NextDirectory .v3-dir__rail） */
const railable = computed(() => panel.value === 'e-commerce' || panel.value === 'studio')
const dirCollapsed = ref(false)
const railMode = computed(() => railable.value && dirCollapsed.value)
const railListRef = ref<HTMLElement>()

/**
 * 收起态的功能名气泡（原型 NextDirectory 收起条）：悬停 300ms 后把整列名字一次性挂出来，从折叠条底下推出
 * （420ms），移走 160ms 宽限后原路缩回（240ms）再卸载；悬停那枚原尺寸 + 选中材质，其余缩到 0.9。
 * 展开目录 / 切目录 / 换页时立刻收掉。点气泡 = 点它对应的那条功能。
 */
interface RailTip {
  id: string
  label: string
  route?: string
  x: number
  y: number
}
const railTips = ref<RailTip[]>([])
const hoveredRail = ref('')
const tipsClosing = ref(false)
let tipTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
function clearRailTimer(t: ReturnType<typeof setTimeout> | undefined) {
  if (t) clearTimeout(t)
  return undefined
}
function showRailTips() {
  closeTimer = clearRailTimer(closeTimer)
  tipsClosing.value = false
  const el = railListRef.value
  if (!el || !railMode.value || !currentPanel.value) return
  const entries = new Map(currentPanel.value.groups.flatMap((g) => g.entries).map((e) => [e.key, e]))
  railTips.value = [...el.querySelectorAll<HTMLElement>('[data-rail-id]')].flatMap((node) => {
    const e = entries.get(node.dataset.railId ?? '')
    if (!e) return []
    const r = node.getBoundingClientRect()
    return [
      {
        id: e.key,
        label: e.route ? e.name : `${e.name}（即将开放）`,
        route: e.route,
        x: r.right + 8,
        y: r.top + r.height / 2,
      },
    ]
  })
}
function hideRailTips(immediate = false) {
  tipTimer = clearRailTimer(tipTimer)
  leaveTimer = clearRailTimer(leaveTimer)
  closeTimer = clearRailTimer(closeTimer)
  hoveredRail.value = ''
  if (immediate || !railTips.value.length) {
    tipsClosing.value = false
    railTips.value = []
    return
  }
  tipsClosing.value = true
  closeTimer = setTimeout(() => {
    closeTimer = undefined
    tipsClosing.value = false
    railTips.value = []
  }, 240)
}
function scheduleRailTips() {
  leaveTimer = clearRailTimer(leaveTimer)
  tipTimer = clearRailTimer(tipTimer)
  tipTimer = setTimeout(() => {
    tipTimer = undefined
    showRailTips()
  }, 300)
}
function scheduleHideRailTips() {
  leaveTimer = clearRailTimer(leaveTimer)
  if (!railTips.value.length) return hideRailTips(true)
  leaveTimer = setTimeout(() => {
    leaveTimer = undefined
    hideRailTips()
  }, 160)
}
function enterRailTip(tip: RailTip) {
  leaveTimer = clearRailTimer(leaveTimer)
  hoveredRail.value = tip.id
}
function clickRailTip(tip: RailTip) {
  hideRailTips(true)
  if (tip.route) go(tip.route)
}
function onRailScroll() {
  if (railTips.value.length && !tipsClosing.value) showRailTips()
}
const tipActive = (tip: RailTip) => !!tip.route && matches(route.path, tip.route)
watch([dirCollapsed, panel, () => route.path], () => hideRailTips(true))
onBeforeUnmount(() => hideRailTips(true))
</script>

<template>
  <!-- 层级尺（原型 NextSidebar.vue:319）：侧栏 38；<1440 目录浮层打开时抬到 140，压过页面弹层以下的内容 -->
  <aside
    ref="asideRef"
    class="sticky top-0 flex h-100vh bg-white"
    :class="currentPanel ? 'z-38 lt-wide:z-140' : 'z-38'"
  >
    <!-- B1：宽 204、内边距 12、右边框 #e5e7eb、往右投影压在目录上（NextSidebar.vue:314-337） -->
    <div
      class="group relative z-2 flex h-full min-h-0 flex-none flex-col overflow-hidden border-r border-r-solid border-r-line bg-white py-12px shadow-cast-r transition-[width] duration-150"
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
          <small class="mt-1px block whitespace-nowrap text-11px font-400 leading-16px text-muted">
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
          @click="go('/tools')"
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

      <!-- 底部：gap 16、上下内边距 12（NextSidebar.vue:426-432） -->
      <div class="mt-auto flex flex-none flex-col gap-16px py-12px">
        <!-- 更新条：主按钮材质（藤紫渐变 + 内高光 + 双层短投影），内边距 10 10 8、r8、12/18 -->
        <div
          v-if="showUpdateBar"
          class="flex flex-col gap-2px rounded-lg border border-solid border-violet-border px-10px pb-8px pt-10px text-12px leading-18px text-white sx-grad-primary shadow-btn"
          role="status"
        >
          <div class="flex items-start gap-6px">
            <svg
              class="mt-2px h-14px w-14px flex-none opacity-92"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path v-for="d in ICON.info" :key="d" :d="d" />
            </svg>
            <span class="flex min-w-0 flex-col">
              <b class="font-600">{{ props.updateNotice }}</b>
              <span class="font-400 opacity-82">需要升级客户端后使用</span>
            </span>
          </div>
          <div class="mt-2px flex justify-end gap-6px">
            <button
              type="button"
              class="h-22px rounded-sm border border-solid border-white/42 bg-transparent px-8px text-12px font-500 leading-20px text-white cursor-pointer transition-[background,border-color,box-shadow] duration-120 ease-[ease] hover:(border-white/64 bg-white/12) active:bg-white/20 focus-visible:(outline outline-2 outline-solid outline-white outline-offset-1)"
              @click="updateDismissed = true"
            >
              稍后
            </button>
            <button
              type="button"
              class="h-22px rounded-sm border border-solid border-white bg-white px-8px text-12px font-600 leading-20px text-violet-ink cursor-pointer shadow-[0_1px_2px_rgba(40,24,48,0.18)] transition-[background,border-color,box-shadow] duration-120 ease-[ease] hover:(border-violet-tint bg-violet-tint) active:(border-#efe6f5 bg-#efe6f5 shadow-[inset_0_1px_2px_rgba(40,24,48,0.12)]) focus-visible:(outline outline-2 outline-solid outline-white outline-offset-1)"
              @click="emit('update')"
            >
              立即更新
            </button>
          </div>
        </div>

        <!-- 通知铃铛 + 签到（签到开关关闭时 CheckInButton 不渲染任何内容）；收起态竖排 -->
        <div class="flex items-center gap-4px" :class="collapsed ? 'flex-col' : '-mx-6px px-6px'">
          <NotificationBell :placement="collapsed ? 'right-end' : 'top-start'" />
          <CheckInButton :placement="collapsed ? 'right-end' : 'top-start'" />
        </div>

        <!-- 用户行：高 40、内边距 0 6、r8，头像 32（NextSidebar.vue:533-563）；手机号 + 可用点数两行；点开账号菜单 -->
        <NDropdown
          trigger="click"
          :show="accountOpen"
          :options="accountOptions"
          :placement="collapsed ? 'right-end' : 'top-start'"
          @update:show="onAccountShow"
          @select="onAccountSelect"
        >
          <button
            ref="accountRef"
            type="button"
            class="flex h-40px flex-none items-center gap-10px rounded-lg border border-solid border-transparent bg-transparent text-left cursor-pointer hover:bg-surface3"
            :class="[FOCUS, collapsed ? 'justify-center' : '-mx-6px px-6px']"
            aria-haspopup="menu"
            :aria-expanded="accountOpen"
            aria-label="账号菜单"
            :title="collapsed ? `可用点数 ${userInfo?.availablePoints ?? '-'}` : undefined"
          >
            <img
              class="block h-32px w-32px flex-none rounded-full border border-solid border-line bg-surface3 object-cover"
              :src="userInfo?.avatar || DEFAULT_AVATAR"
              alt=""
            />
            <span v-if="!collapsed" class="flex min-w-0 flex-col gap-2px">
              <span v-if="maskedPhone" class="truncate text-14px font-500 leading-20px text-ink" :title="maskedPhone">{{
                maskedPhone
              }}</span>
              <span class="flex min-w-0 items-center gap-6px text-12px font-400 leading-16px text-muted">
                <i class="icon-ic_hone_bean flex-none text-violet" aria-hidden="true"></i>
                <span class="truncate" aria-label="可用点数">{{ userInfo?.availablePoints }}</span>
              </span>
            </span>
          </button>
        </NDropdown>
      </div>
    </div>

    <!-- 二级目录栏（原型 B2 NextDirectory）：宽 160，两侧 1px #e2e2e2 外壳分隔线。
         ≥1440 并排在侧栏右侧、往右投影；<1440 改为浮层（left 204、上下各 8、r10、浮层影），不挤内容 -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 -translate-x-24px">
      <!-- 电商 / 商拍目录可收起为 44 图标条（同工具页目录）：宽度 0.2s ease 过渡，overflow-hidden 裁掉过渡中的文字 -->
      <div
        v-if="currentPanel"
        ref="panelRef"
        class="z-1 flex flex-none flex-col box-border overflow-hidden border-x border-solid border-shell-line bg-white [transition:width_0.2s_ease] motion-reduce:transition-none wide:(relative h-full shadow-cast-r) lt-wide:(absolute bottom-8px left-full top-8px border-y rounded-xl shadow-pop)"
        :class="railMode ? 'w-44px' : 'w-160px'"
        role="dialog"
        :aria-label="currentPanel.title + '目录'"
        @keydown="onPanelKeydown"
      >
        <div class="flex h-48px flex-none items-center gap-8px" :class="railMode ? 'justify-center' : 'pl-14px pr-8px'">
          <b
            class="min-w-0 flex-1 truncate text-16px font-600 leading-[1.25] text-ink"
            :class="railMode ? 'sr-only' : ''"
            >{{ currentPanel.title }}</b
          >
          <!-- 电商 / 商拍：原型 .v3-iconbtn 28 / r4，展开态菜单图标 = 收起为图标条，收起态右箭头 = 展开（同工具页目录） -->
          <button
            v-if="railable"
            type="button"
            class="grid h-28px w-28px flex-none place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer hover:(bg-surface3 text-ink)"
            :class="FOCUS"
            :aria-expanded="!dirCollapsed"
            aria-controls="nav-panel-list"
            :aria-label="dirCollapsed ? '展开目录' : '收起目录'"
            :title="dirCollapsed ? '展开目录' : '收起目录'"
            @click="dirCollapsed = !dirCollapsed"
          >
            <svg
              class="h-16px w-16px"
              viewBox="0 0 512 512"
              fill="none"
              stroke="currentColor"
              stroke-width="32"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-if="dirCollapsed" stroke-width="48" d="M184 112l144 144-144 144" />
              <path v-else stroke-miterlimit="10" d="M80 160h352M80 256h352M80 352h352" />
            </svg>
          </button>
          <button
            v-else
            type="button"
            class="grid h-28px w-28px flex-none place-items-center rounded-sm border-none bg-transparent p-0 text-muted cursor-pointer hover:bg-surface3 hover:text-ink"
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

        <!--
          展开（原型 .v3-dir__body）：内边距 0 6 10；组距上 16 / 下 10，组线 0.8px #efefef + 2px 淡影。
          收起（原型 .v3-dir__rail，仅电商 / 商拍）：内边距 2 0 2 3、gap 2；图标钮 36 / r6、muted，悬停 110ms；组间 11 高分隔线。
        -->
        <div
          id="nav-panel-list"
          ref="railListRef"
          class="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-h-0 flex-1 overflow-y-auto"
          :class="railMode ? 'flex flex-col items-start gap-2px pb-2px pl-3px pr-0 pt-2px' : 'px-6px pb-10px'"
          role="menu"
          :aria-label="currentPanel.title"
          @scroll="railMode && onRailScroll()"
          @mouseenter="railMode && scheduleRailTips()"
          @mouseleave="railMode && scheduleHideRailTips()"
        >
          <template v-for="(g, gi) in currentPanel.groups" :key="g.label ?? gi">
            <div
              v-if="railMode && gi"
              class="mb-1px ml-[-3px] mr-0 mt-1px flex h-11px flex-[0_0_11px] items-center self-stretch before:(h-[0.8px] w-full bg-shell-line shadow-[0_1px_2px_rgba(31,35,41,0.07)] content-[''])"
              aria-hidden="true"
            />
            <section
              :class="
                railMode
                  ? 'contents'
                  : gi
                    ? 'mt-16px pt-10px shadow-[inset_0_0.8px_0_#efefef,inset_0_2px_3px_-2px_rgba(31,35,41,0.10)]'
                    : ''
              "
            >
              <!-- 分组标题：高 28、内边距 0 8、12/600、字距 .02em（NextDirectory.vue:457-466）；收起态只留给读屏 -->
              <h3
                v-if="g.label"
                class="m-0 flex h-28px items-center whitespace-nowrap px-8px text-12px font-600 tracking-[.02em] text-muted"
                :class="railMode ? 'sr-only' : ''"
              >
                {{ g.label }}
              </h3>
              <component
                :is="e.route || e.panel ? 'button' : 'div'"
                v-for="e in g.entries"
                :key="e.key"
                :type="e.route || e.panel ? 'button' : undefined"
                role="menuitem"
                :data-panel-node="e.route || e.panel ? '' : undefined"
                :data-rail-id="railMode ? e.key : undefined"
                :aria-current="!e.panel && entryActive(e) ? 'page' : undefined"
                :aria-disabled="e.route || e.panel ? undefined : 'true'"
                :aria-label="e.route || e.panel ? (railMode ? e.name : undefined) : `${e.name}（即将开放）`"
                class="flex items-center rounded-md border border-solid border-transparent bg-transparent text-left"
                :class="[
                  railMode
                    ? 'h-36px w-36px flex-[0_0_36px] justify-center p-0 [transition:background_110ms,color_110ms] motion-reduce:transition-none'
                    : ['w-full gap-10px', e.icon ? 'h-48px pl-8px pr-14px' : 'h-40px px-8px'],
                  e.route || e.panel ? ['cursor-pointer hover:bg-surface3', FOCUS] : 'cursor-not-allowed',
                  entryActive(e)
                    ? ACTIVE
                    : railMode
                      ? e.route
                        ? 'text-muted hover:text-ink'
                        : 'text-muted opacity-60'
                      : '',
                ]"
                @click="(e.route || e.panel) && onEntryClick(e, $event)"
                @mouseenter="hoveredRail = e.key"
                @focus="railMode && (showRailTips(), (hoveredRail = e.key))"
                @blur="railMode && hideRailTips()"
              >
                <svg
                  v-if="railMode && e.icon"
                  class="h-18px w-18px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  :innerHTML="e.icon"
                />
                <template v-else-if="!railMode">
                  <!-- 图标框：36 / r6、line 描边、浅紫渐变 + 内高光，图标 18（同工具页目录） -->
                  <span
                    v-if="e.icon"
                    class="grid h-36px w-36px flex-none place-items-center rounded-6px border border-solid border-line sx-grad-icon shadow-[inset_0_1px_0_#fff]"
                    :class="e.route ? 'text-violet' : 'text-muted opacity-60'"
                    aria-hidden="true"
                  >
                    <svg
                      class="h-18px w-18px"
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
                    <span
                      class="truncate text-13px text-ink"
                      :class="e.icon ? 'font-500 leading-[1.3]' : 'font-400 leading-18px'"
                    >
                      {{ e.name }}
                    </span>
                    <span v-if="e.tagline" class="truncate text-11px leading-[1.35] text-muted">{{ e.tagline }}</span>
                  </span>
                </template>
                <svg
                  v-if="e.panel && !railMode"
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
          </template>
        </div>
      </div>
    </Transition>

    <!--
      收起态功能名气泡（原型 .v3-rail-tip，同工具页目录）：fixed；排在侧栏层叠里、低于目录栏（z-1），从栏底下推出来；
      内边距 5 11、1px line、r6、白底、0 6 16 α.12 + 0 1 2 α.06；13/19。静止 scale(.9)，悬停那枚 scale(1) 并换选中材质
      （白→#f8f3fc、柔紫线、紫字 600），transform 140ms cubic-bezier(.4,0,.2,1)。读屏走目录条目自己的 aria-label，气泡只给鼠标。
    -->
    <div
      v-for="tip in railTips"
      :key="tip.id"
      class="fixed z-0 box-border select-none whitespace-nowrap rounded-6px border border-solid px-11px py-5px text-13px leading-19px origin-[left_center] [transition:transform_140ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:(transition-none [animation-duration:1ms])"
      :class="[
        tipsClosing
          ? 'pointer-events-none animate-[nav-rail-tip-out_240ms_cubic-bezier(0.4,0,1,1)_both]'
          : 'animate-[nav-rail-tip-in_420ms_cubic-bezier(0.22,0.61,0.36,1)_both]',
        tip.route ? 'cursor-pointer' : 'cursor-not-allowed',
        hoveredRail === tip.id || tipActive(tip)
          ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
          : 'border-line bg-white text-ink shadow-[0_6px_16px_rgba(31,35,41,0.12),0_1px_2px_rgba(31,35,41,0.06)]',
        hoveredRail === tip.id && !tipsClosing
          ? '[transform:translateY(calc(-50%_-_0.5px))_scale(1)]'
          : '[transform:translateY(calc(-50%_-_0.5px))_scale(0.9)] motion-reduce:[transform:translateY(calc(-50%_-_0.5px))_scale(1)]',
      ]"
      :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
      aria-hidden="true"
      @mouseenter="enterRailTip(tip)"
      @mouseleave="scheduleHideRailTips"
      @click="clickRailTip(tip)"
    >
      {{ tip.label }}
    </div>
  </aside>
</template>

<style>
/*
 * 收起目录的功能名气泡推入 / 缩回（原型 NextDirectory rail-tip-in / rail-tip-out）：UnoCSS 的 animate-[…] 只能引用名字，
 * 关键帧本身写不成原子类。工具页 views/tools/index.vue 的同款关键帧随工具页分包按需加载，侧栏常驻、不能依赖它，
 * 所以这里带 nav- 前缀另放一份；不加 scoped（scoped 会给关键帧名加哈希，模板里的原子类就对不上）。
 * 用独立的 translate 属性，和气泡自身 transform（居中 + 0.9/1 缩放）互不覆盖。
 */
@keyframes nav-rail-tip-in {
  from {
    translate: calc(-100% - 12px) 0;
  }
  to {
    translate: 0 0;
  }
}
@keyframes nav-rail-tip-out {
  from {
    translate: 0 0;
  }
  to {
    translate: calc(-100% - 12px) 0;
  }
}
</style>
