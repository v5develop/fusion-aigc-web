<script setup lang="ts">
/**
 * 通知铃铛：未读角标（GET /api/v1/notifications/unread-count，可见时每 60 秒一次）+ 点开的通知列表浮层。
 *
 * <p>点一条通知展开正文并标为已读；「全部已读」只提交当前已加载的未读 id（后端不接受空数组代表全部）。
 * 未读数按后端配置封顶，只做角标显示。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NPopover } from 'naive-ui'
import {
  notificationList,
  notificationMarkRead,
  notificationUnreadCount,
  type INotification,
} from '@/api/notifications'

const props = withDefaults(defineProps<{ placement?: 'right-end' | 'top-start' | 'top-end' }>(), {
  placement: 'right-end',
})

const POLL_MS = 60_000
const PAGE_SIZE = 20
const FOCUS = 'focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)'

const TYPE_LABELS: Record<string, string> = { SYSTEM: '系统', ACTIVITY: '活动', MAINTENANCE: '维护' }

const router = useRouter()
const unread = ref(0)
const open = ref(false)
const items = ref<INotification[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadError = ref(false)
const expanded = ref<number | null>(null)

const badgeText = computed(() => (unread.value > 99 ? '99+' : String(unread.value)))
const bellLabel = computed(() => (unread.value > 0 ? `通知，${badgeText.value} 条未读` : '通知，没有未读'))
const unreadLoaded = computed(() => items.value.filter((n) => !n.read).map((n) => n.id))
const hasMore = computed(() => items.value.length < total.value)

async function refreshUnread() {
  try {
    const res = await notificationUnreadCount()
    unread.value = Number(res.data) || 0
  } catch {
    // 角标失败不打扰用户，下次轮询再试
  }
}

async function loadPage(reset: boolean) {
  loading.value = true
  loadError.value = false
  try {
    const next = reset ? 1 : page.value + 1
    const res = await notificationList({ page: next, pageSize: PAGE_SIZE })
    const list = res.data?.page?.list ?? []
    items.value = reset ? list : [...items.value, ...list]
    total.value = res.data?.page?.total ?? 0
    page.value = next
    unread.value = Number(res.data?.unreadCount) || 0
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function onShow(show: boolean) {
  open.value = show
  if (show) {
    expanded.value = null
    void loadPage(true)
  }
}

async function markRead(ids: number[]) {
  if (!ids.length) return
  try {
    await notificationMarkRead(ids)
    const set = new Set(ids)
    items.value = items.value.map((n) => (set.has(n.id) ? { ...n, read: true } : n))
    void refreshUnread()
  } catch {
    // 拦截器已提示
  }
}

/** 站内链接：只放行本站路径（含同源绝对地址）；缺 link 时按 bizType 兜底到视频做同款任务；都没有 = 原行为 */
function targetOf(n: INotification): string {
  const raw = (n.link ?? '').trim()
  if (raw) {
    try {
      const u = new URL(raw, window.location.origin)
      if (u.origin === window.location.origin) {
        const path = u.pathname + u.search + u.hash
        // 只放行单斜杠开头的站内路径，拒绝 // 开头（协议相对地址）
        if (/^\/(?!\/)/.test(path)) return path
        return ''
      }
    } catch {
      // 非法地址当作没有
    }
    return ''
  }
  if (n.bizType && /replicate/i.test(n.bizType) && n.bizId != null && n.bizId !== '') {
    return `/local-life/video-replicate?job=${encodeURIComponent(String(n.bizId))}`
  }
  return ''
}

function onItemClick(n: INotification) {
  const to = targetOf(n)
  if (to) {
    if (!n.read) void markRead([n.id])
    open.value = false
    void router.push(to).catch(() => undefined)
    return
  }
  expanded.value = expanded.value === n.id ? null : n.id
  if (!n.read) void markRead([n.id])
}

let timer: ReturnType<typeof setInterval> | null = null
function onVisible() {
  if (document.visibilityState === 'visible') void refreshUnread()
}
onMounted(() => {
  void refreshUnread()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshUnread()
  }, POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <n-popover trigger="click" :show="open" :placement="props.placement" :show-arrow="false" raw @update:show="onShow">
    <template #trigger>
      <button
        type="button"
        class="relative grid h-32px w-32px flex-none place-items-center rounded-md border border-solid border-transparent bg-transparent p-0 text-muted cursor-pointer hover:(bg-surface3 text-ink)"
        :class="FOCUS"
        :aria-label="bellLabel"
        :title="bellLabel"
        aria-haspopup="dialog"
        :aria-expanded="open"
      >
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
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
        <span
          v-if="unread > 0"
          class="absolute -right-2px -top-2px grid h-16px min-w-16px box-border place-items-center rounded-full border border-solid border-white bg-danger px-4px text-10px font-600 leading-none text-white tabular-nums"
          aria-hidden="true"
          >{{ badgeText }}</span
        >
      </button>
    </template>

    <div
      class="flex max-h-[min(520px,80vh)] w-360px flex-col overflow-hidden rounded-10px border border-solid border-line bg-white shadow-pop"
      role="dialog"
      aria-label="通知"
    >
      <div class="flex h-44px flex-none items-center gap-8px border-b border-b-solid border-line-soft pl-14px pr-8px">
        <b class="min-w-0 flex-1 text-14px font-600 text-ink">通知</b>
        <button
          type="button"
          class="h-26px rounded-sm border-none bg-transparent px-8px text-12px text-violet-ink cursor-pointer hover:bg-surface3 disabled:(text-placeholder cursor-not-allowed hover:bg-transparent)"
          :class="FOCUS"
          :disabled="!unreadLoaded.length"
          @click="markRead(unreadLoaded)"
        >
          全部已读
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-6px py-6px">
        <p v-if="loading && !items.length" class="m-0 py-24px text-center text-12px text-muted" role="status">
          加载中…
        </p>
        <div v-else-if="loadError && !items.length" class="flex flex-col items-center gap-8px py-24px" role="alert">
          <span class="text-12px text-muted">通知加载失败</span>
          <button type="button" class="sx-btn !h-28px !text-12px" @click="loadPage(true)">重试</button>
        </div>
        <div v-else-if="!items.length" class="flex flex-col items-center gap-4px py-28px">
          <strong class="text-13px font-600 text-ink-2">没有新通知</strong>
          <span class="text-11px text-muted">有公告或任务消息时会显示在这里</span>
        </div>
        <ul v-else class="m-0 flex list-none flex-col gap-2px p-0">
          <li v-for="n in items" :key="n.id">
            <button
              type="button"
              class="flex w-full flex-col gap-4px rounded-md border border-solid border-transparent bg-transparent px-10px py-8px text-left cursor-pointer hover:bg-surface3"
              :class="FOCUS"
              :aria-expanded="expanded === n.id"
              @click="onItemClick(n)"
            >
              <span class="flex w-full items-center gap-6px">
                <span
                  class="h-6px w-6px flex-none rounded-full"
                  :class="n.read ? 'bg-transparent' : 'bg-violet'"
                  aria-hidden="true"
                />
                <span class="sr-only">{{ n.read ? '已读' : '未读' }}</span>
                <span
                  class="min-w-0 flex-1 truncate text-13px leading-18px"
                  :class="n.read ? 'font-400 text-ink-2' : 'font-600 text-ink'"
                  >{{ n.title }}</span
                >
                <span
                  v-if="n.targetScope === 'ALL'"
                  class="ll-chip text-violet-ink bg-violet-soft border border-violet-line"
                  >公告</span
                >
                <span v-else-if="TYPE_LABELS[n.notificationType]" class="ll-chip text-muted bg-surface3">{{
                  TYPE_LABELS[n.notificationType]
                }}</span>
              </span>
              <span
                class="pl-12px text-12px leading-18px text-muted whitespace-pre-line break-all"
                :class="expanded === n.id ? '' : 'line-clamp-2'"
                >{{ n.content }}</span
              >
              <span class="pl-12px text-11px leading-16px text-placeholder tabular-nums">{{ n.publishTime }}</span>
            </button>
          </li>
        </ul>
        <div v-if="items.length && hasMore" class="py-8px text-center">
          <button
            type="button"
            class="border-none bg-transparent p-0 text-12px text-violet-ink cursor-pointer hover:text-violet-press"
            :class="FOCUS"
            :disabled="loading"
            @click="loadPage(false)"
          >
            {{ loading ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </div>
    </div>
  </n-popover>
</template>
