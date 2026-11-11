<script setup lang="ts">
/**
 * 全站完成提醒（挂在 App，常驻路由之外）：订阅 utils/taskWatcher 的共享轮询器。
 *
 * <ul>
 *   <li>用户已离开提交页（或任务是进站前就在跑的）→ 右下角轻提示 + 「查看」去任务中心；仍停在提交页时页面自己会出结果，不重复打扰；
 *       在任务中心页时不提示（列表本身会更新）。</li>
 *   <li>标签页在后台 → 标题加角标「(n) 已完成 · 原标题」，切回即清；轻提示攒到切回时再出。</li>
 *   <li>浏览器桌面通知：只有用户在任务中心明确开启后才发（setDesktopNotify），这里从不请求授权。</li>
 * </ul>
 */
import { h, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNotification } from 'naive-ui'
import {
  desktopNotifyEnabled,
  onTasksFinished,
  startTaskWatcher,
  stopTaskWatcher,
  type FinishedTask,
} from '@/utils/taskWatcher'

const route = useRoute()
const router = useRouter()
const notification = useNotification()

const TASKS_PATH = '/tasks'
/** 任务中心 / 登录页上不弹 */
const quietHere = () => route.path === TASKS_PATH || route.name === 'login'

let baseTitle = ''
let unseen = 0
const pending: FinishedTask[] = []

function setBadge(n: number) {
  if (!baseTitle) baseTitle = document.title.replace(/^\(\d+\)\s*已完成\s*·\s*/, '')
  document.title = n > 0 ? `(${n}) 已完成 · ${baseTitle}` : baseTitle
  // 复原后忘掉这次的原标题：之后切了页面再进后台，要以那时的标题为准
  if (n <= 0) baseTitle = ''
}

function goTasks() {
  if (route.path !== TASKS_PATH) void router.push(TASKS_PATH)
}

function toast(list: FinishedTask[]) {
  if (!list.length || quietHere()) return
  const okCount = list.filter((t) => t.ok).length
  const failCount = list.length - okCount
  const single = list.length === 1 ? list[0]! : null
  const title = single
    ? single.ok
      ? '生成完成'
      : '生成未成功'
    : failCount
      ? `${list.length} 个任务已结束`
      : `${list.length} 个任务已完成`
  const content = single
    ? single.ok
      ? single.title
      : `${single.title}：未成功，点数已按规则退回`
    : failCount
      ? `成功 ${okCount} 个，未成功 ${failCount} 个（点数已按规则退回）`
      : list.map((t) => t.title).join('、')
  const n = notification.create({
    type: failCount && !okCount ? 'warning' : 'success',
    title,
    content,
    duration: 8000,
    keepAliveOnHover: true,
    action: () =>
      h(
        'button',
        {
          type: 'button',
          class: 'sx-btn h-28px px-12px rounded-4px text-13px cursor-pointer',
          onClick: () => {
            n.destroy()
            goTasks()
          },
        },
        '查看',
      ),
  })
}

function desktop(list: FinishedTask[]) {
  if (!desktopNotifyEnabled()) return
  const okCount = list.filter((t) => t.ok).length
  const body =
    list.length === 1
      ? `${list[0]!.title}${list[0]!.ok ? ' 已完成' : ' 未成功，点数已按规则退回'}`
      : `${list.length} 个任务已结束（成功 ${okCount} 个）`
  try {
    const n = new Notification('小岐AI · 生成结束', {
      body,
      tag: 'xq-task-finished',
      icon: `${import.meta.env.BASE_URL || '/'}favicon.ico`,
    })
    n.onclick = () => {
      window.focus()
      goTasks()
      n.close()
    }
  } catch {
    // 个别环境（容器 WebView）构造会抛：静默放弃，站内提示照常
  }
}

function onFinished(list: FinishedTask[]) {
  if (document.visibilityState === 'hidden') {
    unseen += list.length
    setBadge(unseen)
    desktop(list)
    pending.push(...list)
    return
  }
  // 还停在提交页：页面会自己出结果，不重复提示
  toast(list.filter((t) => t.seenOn === null || t.seenOn !== route.path))
}

function onVisibility() {
  if (document.visibilityState !== 'visible') return
  if (unseen) {
    unseen = 0
    setBadge(0)
  }
  if (pending.length) {
    const list = pending.splice(0)
    toast(list.filter((t) => t.seenOn === null || t.seenOn !== route.path))
  }
}

let off: (() => void) | null = null
onMounted(() => {
  off = onTasksFinished(onFinished)
  startTaskWatcher(() => route.path)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  off?.()
  stopTaskWatcher()
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <span hidden />
</template>
