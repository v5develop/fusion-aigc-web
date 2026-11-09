<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { NDropdown, type DropdownOption } from 'naive-ui'
import { sessionKeyOf, tabLabel, useEcTabsStore, type EcTab } from '@/stores/e-commerce/tabs'
import { useSessionIdStore } from '@/stores/e-commerce'
import { shangpingshiping_data } from '@/views/e-commerce/entries'

const route = useRoute()
const router = useRouter()
const tabsStore = useEcTabsStore()
const sessionIdStore = useSessionIdStore()
const { tabs, runningMap } = storeToRefs(tabsStore)

// 首项固定为「返回 AI 图片 / AI 视频」（见 overviewOf），不进 tabs、不可关闭

// 同类目可以多开，光比 name 不够，还要比实例 id
const isActive = (id: string) => route.query.tab === id

const go = (id: string, name: string) => router.push({ name, query: { tab: id } })

/**
 * 「回模块首页」去哪：2026-11-09 主导航隐藏了 AI 电商，电商功能并进 AI 图片 / AI 视频，
 * 所以回到对应总览页（商品视频四项回 /video，其余回 /image）；电商首页 /e-commerce 仍可深链打开。
 */
const VIDEO_PAGE_NAMES = new Set(shangpingshiping_data.map((e) => e.pathName))
const overviewOf = (name: unknown) =>
  VIDEO_PAGE_NAMES.has(String(name)) ? { path: '/video', label: 'AI 视频' } : { path: '/image', label: 'AI 图片' }
const overview = computed(() => overviewOf(route.name))

/** 关闭后的会话清理：只保留仍然打开的标签对应的会话 */
const pruneSessions = () => sessionIdStore.pruneSessionIds(new Set(tabs.value.map(sessionKeyOf)))

const close = (tab: { id: string; name: string }) => {
  const next = tabsStore.closeTab(tab.id)
  // 显式关闭视为丢弃这批生成结果：连它的会话记录一起清掉，否则 localStorage 只增不减
  pruneSessions()

  // 关的不是当前标签就不用动路由，停在原地
  if (!isActive(tab.id)) return
  router.push(next ? { name: next.name, query: { tab: next.id } } : overviewOf(tab.name).path)
}

/**
 * 批量关闭。当前标签被关掉时，落到剩余标签里离它原来位置最近的一个；没有剩余则回电商首页
 */
function removeMany(ids: string[]) {
  if (!ids.length) return
  const before = tabs.value
  const activeIndex = before.findIndex((t) => isActive(t.id))
  tabsStore.removeTabs(ids)
  pruneSessions()

  if (!ids.some((id) => isActive(id))) return
  const remaining = tabs.value
  const fallback = overviewOf(route.name).path
  if (!remaining.length) {
    router.push(fallback)
    return
  }
  let best: EcTab | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const t of remaining) {
    const distance = Math.abs(before.findIndex((b) => b.id === t.id) - activeIndex)
    if (distance < bestDistance) {
      best = t
      bestDistance = distance
    }
  }
  if (!best) {
    router.push(fallback)
    return
  }
  router.push({ name: best.name, query: { tab: best.id } })
}

// ---------------- 右键菜单 ----------------

const menu = ref<{ show: boolean; x: number; y: number; tab: EcTab | null }>({
  show: false,
  x: 0,
  y: 0,
  tab: null,
})

const menuIndex = computed(() => {
  const tab = menu.value.tab
  return tab ? tabs.value.findIndex((t) => t.id === tab.id) : -1
})

/** 菜单项：置灰规则与 store 的钉住/移动规则保持一致 */
const menuOptions = computed<DropdownOption[]>(() => {
  const i = menuIndex.value
  const tab = menu.value.tab
  if (!tab || i < 0) return []
  const list = tabs.value
  const pinned = Boolean(tab.pinned)
  const hasLeft = list.slice(0, i).some((t) => !t.pinned)
  const hasRight = list.slice(i + 1).some((t) => !t.pinned)
  const hasOthers = list.some((t, j) => j !== i && !t.pinned)
  const hasUnpinned = list.some((t) => !t.pinned)
  const prev = list[i - 1]
  const next = list[i + 1]
  return [
    { label: '关闭当前', key: 'close', disabled: pinned },
    { label: '关闭左侧', key: 'closeLeft', disabled: !hasLeft },
    { label: '关闭右侧', key: 'closeRight', disabled: !hasRight },
    { label: '关闭其他', key: 'closeOthers', disabled: !hasOthers },
    { label: '关闭全部', key: 'closeAll', disabled: !hasUnpinned },
    { type: 'divider', key: 'divider-1' },
    { label: pinned ? '取消钉住' : '钉住', key: 'pin' },
    { type: 'divider', key: 'divider-2' },
    { label: '左移', key: 'moveLeft', disabled: !prev || Boolean(prev.pinned) !== pinned },
    { label: '右移', key: 'moveRight', disabled: !next || Boolean(next.pinned) !== pinned },
  ]
})

function openMenu(x: number, y: number, tab: EcTab) {
  menu.value = { show: true, x, y, tab }
}

function onTabContextMenu(e: MouseEvent, tab: EcTab) {
  e.preventDefault()
  openMenu(e.clientX, e.clientY, tab)
}

/** 键盘：菜单键 或 Shift+F10，在标签下方弹出菜单 */
function onTabKeydown(e: KeyboardEvent, tab: EcTab) {
  if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu(rect.left, rect.bottom, tab)
}

function onMenuSelect(key: string | number) {
  const tab = menu.value.tab
  menu.value.show = false
  if (!tab) return
  const list = tabs.value
  const i = list.findIndex((t) => t.id === tab.id)
  if (i < 0) return

  switch (key) {
    case 'close':
      close(tab)
      break
    case 'closeLeft':
      removeMany(
        list
          .slice(0, i)
          .filter((t) => !t.pinned)
          .map((t) => t.id),
      )
      break
    case 'closeRight':
      removeMany(
        list
          .slice(i + 1)
          .filter((t) => !t.pinned)
          .map((t) => t.id),
      )
      break
    case 'closeOthers':
      removeMany(list.filter((t, j) => j !== i && !t.pinned).map((t) => t.id))
      break
    case 'closeAll':
      removeMany(list.filter((t) => !t.pinned).map((t) => t.id))
      break
    case 'pin':
      tabsStore.togglePin(tab.id)
      break
    case 'moveLeft':
      tabsStore.moveTab(tab.id, -1)
      break
    case 'moveRight':
      tabsStore.moveTab(tab.id, 1)
      break
  }
}
</script>

<template>
  <!-- 页签对齐原型 CreationPillTabs（高 32、r8、14 / 500，选中 #f1ecf3 底 + 600）。
       与页面同底色：sticky 吸顶时下方内容不能从背后透出来；电商首页走 body 滚动，标签条必须吸顶。
       标签多了横向滚动，但不为此撑出一条滚动条占掉高度 -->
  <nav
    class="sticky top-0 z-10 flex-none flex items-center gap-2px h-48px px-16px bg-page overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    aria-label="电商标签"
  >
    <button
      type="button"
      class="sx-pilltab flex-none border-none bg-transparent sx-focus"
      @click="router.push(overview.path)"
    >
      返回{{ overview.label }}
    </button>

    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="sx-pilltab flex-none max-w-180px gap-6px !pr-6px"
      :class="{ 'sx-pilltab-on': isActive(tab.id) }"
      @contextmenu="onTabContextMenu($event, tab)"
    >
      <button
        type="button"
        class="flex items-center gap-6px min-w-0 p-0 border-none bg-transparent text-inherit [font:inherit] cursor-pointer rounded-sm sx-focus"
        :aria-current="isActive(tab.id) ? 'page' : undefined"
        @click="go(tab.id, tab.name)"
        @keydown="onTabKeydown($event, tab)"
      >
        <!-- 钉住的标签用图钉标出，且不显示关闭按钮（取消钉住后才能关） -->
        <svg
          v-if="tab.pinned"
          class="flex-none w-12px h-12px text-violet"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          role="img"
          aria-label="已钉住"
        >
          <path d="M12 17v5M9 10.76V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4.76l2 2.24H7l2-2.24z" />
        </svg>
        <!-- 后台标签仍在轮询，用小圆点把「还在跑」透出来，这是多标签的主要价值 -->
        <i
          v-if="runningMap[tab.id]"
          class="flex-none w-6px h-6px rounded-full bg-violet animate-pulse motion-reduce:animate-none"
          role="img"
          aria-label="生成中"
        ></i>
        <span class="truncate">{{ tabLabel(tab) }}</span>
      </button>
      <button
        v-if="!tab.pinned"
        type="button"
        class="flex-none grid place-items-center w-20px h-20px p-0 border-none rounded-sm bg-transparent text-muted cursor-pointer hover:(bg-violet-soft-2 text-ink) sx-focus sx-hit"
        :aria-label="`关闭${tabLabel(tab)}`"
        @click.stop="close(tab)"
      >
        <svg
          class="w-12px h-12px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="menu.show"
      :x="menu.x"
      :y="menu.y"
      :options="menuOptions"
      @select="onMenuSelect"
      @clickoutside="menu.show = false"
    />
  </nav>
</template>
