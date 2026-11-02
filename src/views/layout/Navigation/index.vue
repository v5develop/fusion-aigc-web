<script setup lang="ts">
/**
 * 左侧主导航 —— 对齐「AI 创作」新版外壳 v2.3 原型（prototype/shell-v2.css · .sv-sidebar）。
 *
 * <p>结构：品牌块（收起按钮 32 + 间距 12 + logo 40 = 84）→ 一级行（44 高 / 图标 18 / 14/500）
 * → 「AI 创作」二级组（40 高）→ 弹性留白 → 更新条 + 用户行。
 * 二级行带下级页面时，悬停滑出 280 满高目录浮层（原型 B2：开 150ms / 关 320ms）。
 * 侧栏可收起为 44 图标条，此时悬停「AI 创作」滑出整组目录。
 *
 * <p>选中态按原型 v2.3「内凹，无左侧色条」实现，PRD §4.1 的「底色 + 竖条」已被原型覆盖。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserInfoStore } from '@/stores/userInfo.ts'
import { storeToRefs } from 'pinia'

const props = defineProps<{
  /** 更新条文案；不传则不显示更新条 */
  updateNotice?: string
}>()

const router = useRouter() // 用来跳转
const route = useRoute() // 用来获取当前地址
const store = useUserInfoStore()
const { userInfo } = storeToRefs(store)

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL
const DEFAULT_AVATAR =
  'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp'

interface NavLeaf {
  name: string
  path: string
}

interface NavRow extends NavLeaf {
  /** iconfont 类名（老入口） */
  icon?: string
  iconActive?: string
  /** 无现成 iconfont 的入口用内联 SVG path（描边，跟随 currentColor） */
  svg?: string
}

interface DirGroup {
  /** 组头；为空表示不出组头 */
  head?: NavLeaf
  items: NavLeaf[]
}

interface Flyout {
  key: string
  title: string
  groups: DirGroup[]
}

// 按原型 v2.3 分组：首页 / AI 创作（二级）/ 提示词库
const homeRow: NavRow = { name: '首页', path: '/', icon: 'icon-ic_nav_home', iconActive: 'icon-ic_nav_home_full' }
const aiSubs: NavLeaf[] = [
  { name: '智能体', path: '/agent' },
  { name: 'AI 图片', path: '/picture' },
  { name: 'AI 视频', path: '/video' },
  { name: '电商', path: '/e-commerce' },
  { name: '商拍', path: '/studio' },
  { name: '本地生活', path: '/local-life' },
  { name: '画布', path: '/canvas' },
  { name: '资产', path: '/asset-library' },
  { name: '创意广场', path: '/plaza' },
]
const tailRows: NavRow[] = [
  {
    name: '提示词库',
    path: '/prompt-library',
    svg: 'M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM9.5 3.5v7l2.5-1.5 2.5 1.5v-7',
  },
]

const ICON = {
  spark: [
    'M12 3.5l1.9 5.1L19 10.5l-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z',
    'M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z',
  ],
  chevL: ['M14.5 5.5 8 12l6.5 6.5'],
  chevR: ['m9.5 5.5 6.5 6.5-6.5 6.5'],
  chevD: ['m5.5 9.5 6.5 6.5 6.5-6.5'],
  close: ['m6 6 12 12M18 6 6 18'],
  search: ['M15 15l5 5', 'M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0z'],
}

function handleRouterActive(path: string) {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.includes(path)
}

// ---------- 原型样式（UnoCSS） ----------
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2'
const ROW_BASE =
  'relative flex w-full items-center border border-solid border-transparent rounded-6px bg-transparent text-ink-2 ' +
  'text-left text-14px cursor-pointer transition-colors duration-110 hover:bg-surface3 hover:text-ink ' +
  FOCUS
/** v2.3 选中态 = 内凹，无左侧色条 */
const ACTIVE =
  '!border-line !text-ink bg-[linear-gradient(#f3f4f5,#fafbfc)] ' +
  'shadow-[inset_0_1px_3px_rgba(31,35,41,0.10),inset_0_-1px_0_#fff]'

const collapsed = ref(false)
const aiExpanded = ref(true)
const updateDismissed = ref(false)

const showUpdateBar = computed(() => !!props.updateNotice && !updateDismissed.value && !collapsed.value)
const aiSubActive = computed(() => aiSubs.some((s) => handleRouterActive(s.path)))

function rowClass(active: boolean) {
  return [
    ROW_BASE,
    'h-44px gap-10px font-500',
    collapsed.value ? 'justify-center px-0' : 'px-10px',
    active ? ACTIVE : '',
  ]
}

function subClass(active: boolean) {
  return [ROW_BASE, 'h-40px gap-6px pl-40px pr-10px font-400', active ? ACTIVE : '']
}

// ---------- 280 悬浮目录（B2） ----------

/** 某一入口下的页面目录：直接取已注册路由里带 meta.title 的下级静态页，不新增路由 */
function dirItems(path: string): NavLeaf[] {
  if (path === '/') return []
  return router
    .getRoutes()
    .filter((r) => r.path.startsWith(path + '/') && !r.path.includes(':') && typeof r.meta?.title === 'string')
    .map((r) => ({ name: r.meta.title as string, path: r.path }))
}

const subDirs = computed(() => {
  const map: Record<string, NavLeaf[]> = {}
  aiSubs.forEach((s) => (map[s.path] = dirItems(s.path)))
  return map
})

function dirsOf(path: string): NavLeaf[] {
  return subDirs.value[path] ?? []
}

const flyout = ref<Flyout | null>(null)
const flyoutQuery = ref('')
const flyoutRef = ref<HTMLElement>()
const sidebarRef = ref<HTMLElement>()
const flyoutLeft = ref(0)
let anchorEl: HTMLElement | null = null
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

function flyoutFor(key: string): Flyout | null {
  if (key === 'ai') {
    return { key, title: 'AI 创作', groups: aiSubs.map((s) => ({ head: s, items: dirsOf(s.path) })) }
  }
  const sub = aiSubs.find((s) => s.path === key)
  const items = dirsOf(key)
  if (!sub || !items?.length) return null
  return { key, title: sub.name, groups: [{ items }] }
}

const filteredGroups = computed<DirGroup[]>(() => {
  if (!flyout.value) return []
  const q = flyoutQuery.value.trim().toLowerCase()
  if (!q) return flyout.value.groups
  return flyout.value.groups.flatMap((g) => {
    // 组头命中则整组保留；否则只留命中的条目，一条不剩的组整组隐藏
    if (g.head?.name.toLowerCase().includes(q)) return [g]
    const items = g.items.filter((i) => i.name.toLowerCase().includes(q))
    return items.length ? [{ head: g.head, items }] : []
  })
})

function clearTimers() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
}

function openFlyout(key: string, anchor: HTMLElement, focus?: 'first' | 'last') {
  clearTimers()
  const next = flyoutFor(key)
  if (!next) return
  if (flyout.value?.key !== key) flyoutQuery.value = ''
  anchorEl = anchor
  flyoutLeft.value = Math.round(sidebarRef.value?.getBoundingClientRect().right ?? 0)
  flyout.value = next
  if (focus) {
    requestAnimationFrame(() => {
      const nodes = flyoutRef.value?.querySelectorAll<HTMLElement>('[data-dir-node]')
      if (nodes?.length) nodes[focus === 'last' ? nodes.length - 1 : 0]?.focus()
    })
  }
}

function closeFlyout(returnFocus = false) {
  clearTimers()
  if (!flyout.value) return
  flyout.value = null
  if (returnFocus) anchorEl?.focus()
  anchorEl = null
}

function scheduleOpen(key: string, e: Event) {
  const anchor = e.currentTarget as HTMLElement
  clearTimers()
  openTimer = setTimeout(() => openFlyout(key, anchor), 150)
}

function scheduleClose() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    if (flyoutRef.value?.contains(document.activeElement)) return
    closeFlyout()
  }, 320)
}

function onAnchorKeydown(key: string, e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    openFlyout(key, e.currentTarget as HTMLElement, e.key === 'ArrowDown' ? 'first' : 'last')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeFlyout(true)
  }
}

function onFlyoutKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeFlyout(true)
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const nodes = Array.from(flyoutRef.value?.querySelectorAll<HTMLElement>('[data-dir-node]') ?? [])
  if (!nodes.length) return
  e.preventDefault()
  const idx = nodes.indexOf(document.activeElement as HTMLElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  nodes[(idx + step + nodes.length) % nodes.length]?.focus()
}

function onFlyoutFocusout(e: FocusEvent) {
  const next = e.relatedTarget as Node | null
  if (next && (flyoutRef.value?.contains(next) || anchorEl?.contains(next))) return
  scheduleClose()
}

function isAnchorOpen(key: string) {
  return flyout.value?.key === key
}

function go(path: string) {
  closeFlyout()
  router.push(path)
}

function onAiRowClick(e: MouseEvent) {
  if (collapsed.value) {
    openFlyout('ai', e.currentTarget as HTMLElement)
    return
  }
  aiExpanded.value = !aiExpanded.value
  closeFlyout()
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  closeFlyout()
}

watch(
  () => route.path,
  () => closeFlyout(),
)

onBeforeUnmount(clearTimers)
</script>

<template>
  <aside
    ref="sidebarRef"
    class="sticky top-0 z-60 flex h-100vh flex-col overflow-hidden border-r border-r-solid border-r-line bg-white transition-[width] duration-150"
    :class="collapsed ? 'w-44px' : 'w-204px'"
  >
    <div class="flex h-full min-h-0 flex-col pt-12px" :class="collapsed ? 'px-2px' : 'px-12px'">
      <!-- 品牌块：收起按钮 32 + 12 + logo 40 = 84 -->
      <div class="flex h-32px flex-none items-center" :class="collapsed ? 'justify-center' : ''">
        <button
          type="button"
          class="grid h-32px w-32px place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer hover:bg-surface3 hover:text-ink"
          :class="FOCUS"
          :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
          :title="collapsed ? '展开侧栏' : '收起侧栏'"
          :aria-expanded="!collapsed"
          @click="toggleCollapsed"
        >
          <svg
            class="h-16px w-16px"
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
      <div class="mt-12px flex flex-none items-center gap-10px" :class="collapsed ? 'justify-center' : 'px-2px'">
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
      </div>

      <!-- 导航行；矮视口下允许滚动，兜底不把更新条/用户行挤出去 -->
      <nav
        class="mt-16px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex min-h-0 flex-col gap-2px overflow-y-auto"
        aria-label="主导航"
      >
        <button
          type="button"
          :class="rowClass(handleRouterActive(homeRow.path))"
          :aria-current="handleRouterActive(homeRow.path) ? 'page' : undefined"
          :aria-label="collapsed ? homeRow.name : undefined"
          :title="collapsed ? homeRow.name : undefined"
          @click="go(homeRow.path)"
        >
          <span class="grid h-18px w-18px flex-none place-items-center">
            <i
              class="text-18px leading-none"
              :class="handleRouterActive(homeRow.path) ? homeRow.iconActive : homeRow.icon"
            ></i>
          </span>
          <span v-if="!collapsed" class="min-w-0 flex-1">{{ homeRow.name }}</span>
        </button>

        <!-- AI 创作：展开态点击开合二级；收起态悬停/点击滑出整组目录 -->
        <button
          type="button"
          :class="rowClass((collapsed || !aiExpanded) && aiSubActive)"
          :aria-expanded="collapsed ? isAnchorOpen('ai') : aiExpanded"
          :aria-haspopup="collapsed ? 'menu' : undefined"
          :aria-label="collapsed ? 'AI 创作' : undefined"
          :title="collapsed ? 'AI 创作' : undefined"
          @click="onAiRowClick"
          @mouseenter="collapsed && scheduleOpen('ai', $event)"
          @mouseleave="collapsed && scheduleClose()"
          @keydown="collapsed && onAnchorKeydown('ai', $event)"
        >
          <span class="grid h-18px w-18px flex-none place-items-center">
            <svg
              class="h-18px w-18px"
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
          </span>
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1">AI 创作</span>
            <span
              class="grid h-12px w-12px flex-none place-items-center text-placeholder transition-transform duration-150"
              :class="aiExpanded ? '' : '-rotate-90'"
            >
              <svg
                class="h-12px w-12px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path v-for="d in ICON.chevD" :key="d" :d="d" />
              </svg>
            </span>
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
            :class="subClass(handleRouterActive(sub.path))"
            :aria-current="handleRouterActive(sub.path) ? 'page' : undefined"
            :aria-haspopup="dirsOf(sub.path).length ? 'menu' : undefined"
            :aria-expanded="dirsOf(sub.path).length ? isAnchorOpen(sub.path) : undefined"
            @click="go(sub.path)"
            @mouseenter="dirsOf(sub.path).length && scheduleOpen(sub.path, $event)"
            @mouseleave="dirsOf(sub.path).length && scheduleClose()"
            @keydown="dirsOf(sub.path).length && onAnchorKeydown(sub.path, $event)"
          >
            <span class="min-w-0 flex-1">{{ sub.name }}</span>
            <span
              v-if="dirsOf(sub.path).length"
              class="ml-auto grid h-12px w-12px flex-none place-items-center text-placeholder"
            >
              <svg
                class="h-12px w-12px"
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
            </span>
          </button>
        </div>

        <button
          v-for="row in tailRows"
          :key="row.path"
          type="button"
          :class="rowClass(handleRouterActive(row.path))"
          :aria-current="handleRouterActive(row.path) ? 'page' : undefined"
          :aria-label="collapsed ? row.name : undefined"
          :title="collapsed ? row.name : undefined"
          @click="go(row.path)"
        >
          <span class="grid h-18px w-18px flex-none place-items-center">
            <svg
              v-if="row.svg"
              class="h-18px w-18px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="row.svg" />
            </svg>
            <i
              v-else
              class="text-18px leading-none"
              :class="handleRouterActive(row.path) ? row.iconActive : row.icon"
            ></i>
          </span>
          <span v-if="!collapsed" class="min-w-0 flex-1">{{ row.name }}</span>
        </button>
      </nav>

      <div class="min-h-12px flex-1"></div>

      <!-- 更新条 -->
      <div
        v-if="showUpdateBar"
        class="flex flex-none flex-col items-start gap-2px rounded-6px bg-violet-soft px-10px pb-7px pt-9px text-12px leading-[1.55] text-violet-press"
        role="status"
      >
        <span>{{ props.updateNotice }}</span>
        <button
          type="button"
          class="m-[-6px_-6px_-6px_auto] inline-flex min-h-32px min-w-32px items-center justify-center self-end border-none bg-transparent px-6px text-12px leading-[1.55] text-violet-deep cursor-pointer hover:underline hover:underline-offset-3"
          :class="FOCUS"
          @click="updateDismissed = true"
        >
          稍后
        </button>
      </div>

      <!-- 用户行：头像 36 + 可用点数 -->
      <div
        class="flex flex-none items-center gap-10px pb-20px pt-16px"
        :class="collapsed ? 'justify-center px-0' : 'px-2px'"
        :title="collapsed ? `可用点数 ${userInfo?.availablePoints ?? '-'}` : undefined"
      >
        <img
          class="block h-36px w-36px flex-none rounded-full border border-solid border-line object-cover"
          :src="userInfo?.avatar || DEFAULT_AVATAR"
          alt="头像"
        />
        <span v-if="!collapsed" class="flex min-w-0 items-center gap-6px text-14px font-500 text-ink">
          <i class="icon-ic_hone_bean flex-none text-violet" aria-hidden="true"></i>
          <span class="break-all" aria-label="可用点数">{{ userInfo?.availablePoints }}</span>
        </span>
      </div>
    </div>

    <!-- 280 满高悬浮目录（B2）：左缘贴侧栏，留 8px 间隙 -->
    <Transition
      enter-active-class="transition duration-120 ease-[cubic-bezier(.2,.7,.2,1)]"
      leave-active-class="transition duration-120 ease-[cubic-bezier(.2,.7,.2,1)]"
      enter-from-class="opacity-0 -translate-x-4px"
      leave-to-class="opacity-0 -translate-x-4px"
    >
      <div
        v-if="flyout"
        class="fixed bottom-8px top-8px z-130 w-288px pl-8px"
        :style="{ left: flyoutLeft + 'px' }"
        @mouseenter="clearTimers"
        @mouseleave="scheduleClose"
      >
        <div
          ref="flyoutRef"
          class="relative flex h-full max-h-[calc(100vh-16px)] w-280px flex-col overflow-hidden rounded-8px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
          role="dialog"
          :aria-label="flyout.title + '目录'"
          @keydown="onFlyoutKeydown"
          @focusout="onFlyoutFocusout"
        >
          <div class="flex h-52px flex-none items-center gap-8px border-b border-b-solid border-b-line pl-14px pr-8px">
            <b class="min-w-0 flex-1 text-16px font-600 leading-[1.25] text-ink">{{ flyout.title }}</b>
            <button
              type="button"
              class="grid h-28px w-28px flex-none place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer hover:bg-surface3 hover:text-ink"
              :class="FOCUS"
              aria-label="关闭目录"
              title="关闭目录"
              @click="closeFlyout(true)"
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
                <path v-for="d in ICON.close" :key="d" :d="d" />
              </svg>
            </button>
          </div>

          <div class="px-10px pb-8px pt-6px">
            <div class="relative">
              <svg
                class="pointer-events-none absolute left-9px top-8px h-14px w-14px text-placeholder"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path v-for="d in ICON.search" :key="d" :d="d" />
              </svg>
              <input
                v-model="flyoutQuery"
                type="search"
                class="box-border h-32px w-full rounded-4px border border-solid border-#c9cfd6 bg-white pl-30px pr-8px text-12px text-ink outline-none placeholder:text-placeholder hover:border-#aeb6bf focus-visible:border-violet"
                placeholder="搜索功能…"
                aria-label="搜索功能"
              />
            </div>
          </div>

          <div
            class="[scrollbar-color:#d9dde2_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-4px [&::-webkit-scrollbar]:w-4px [&::-webkit-scrollbar-thumb]:rounded-2px [&::-webkit-scrollbar-thumb]:bg-line-strong min-h-0 flex-1 overflow-auto px-6px pb-10px"
            role="menu"
            :aria-label="flyout.title"
          >
            <div v-for="(g, gi) in filteredGroups" :key="g.head?.path ?? gi" :class="gi > 0 ? 'mt-18px' : ''">
              <button
                v-if="g.head"
                type="button"
                role="menuitem"
                data-dir-node
                class="flex h-36px w-full items-center rounded-6px border border-solid border-transparent bg-transparent px-8px text-left text-14px font-600 text-muted cursor-pointer hover:bg-surface3"
                :class="[FOCUS, route.path === g.head.path ? ACTIVE : '']"
                :aria-current="route.path === g.head.path ? 'page' : undefined"
                @click="go(g.head.path)"
              >
                {{ g.head.name }}
              </button>
              <button
                v-for="item in g.items"
                :key="item.path"
                type="button"
                role="menuitem"
                data-dir-node
                class="flex h-48px w-full items-center gap-10px rounded-6px border border-solid border-transparent bg-transparent px-8px text-left text-14px font-500 leading-[1.3] text-ink cursor-pointer hover:bg-surface3 focus-visible:bg-surface3"
                :class="[FOCUS, route.path === item.path ? ACTIVE : '']"
                :aria-current="route.path === item.path ? 'page' : undefined"
                @click="go(item.path)"
              >
                {{ item.name }}
              </button>
            </div>

            <div
              v-if="!filteredGroups.length"
              class="flex flex-col items-center justify-center px-10px py-28px text-center text-11px leading-[1.7] text-muted"
            >
              <b class="mb-6px block text-12px font-600 text-ink-2">没有匹配的功能</b>
              <button
                type="button"
                class="h-28px rounded-4px border border-solid border-line bg-white px-8px text-11px text-violet-ink cursor-pointer"
                :class="FOCUS"
                @click="flyoutQuery = ''"
              >
                清空搜索
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </aside>
</template>
