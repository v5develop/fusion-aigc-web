<script setup lang="ts">
/**
 * 全站完成提醒（挂在 App，常驻路由之外）：订阅 utils/taskWatcher（实时推送优先、轮询兜底，多标签页只由主标签页产生事件）。
 *
 * <ul>
 *   <li>用户已离开提交页（或任务是进站前就在跑的）→ 右下角轻提示 + 「查看」去任务中心；仍停在提交页时页面自己会出结果，不重复打扰；
 *       在任务中心页时不提示（列表本身会更新）。</li>
 *   <li>标签页在后台 → 标题加角标「(n) 已完成 · 原标题」，切回即清；轻提示攒到切回时再出。</li>
 *   <li>浏览器桌面通知：只有用户在任务中心明确开启后才发（setDesktopNotify），这里从不请求授权；
 *       多标签页时只由主标签页、且没有任何标签页在用户眼前时才发。</li>
 *   <li>多标签页：站内轻提示只在用户眼前（可见且有焦点；都没焦点时可见即可）的那个标签页出，出过后广播「已看过」，
 *       其它标签页切回时不再补弹。</li>
 *   <li>「查看」深链到任务中心 /tasks?taskId=…（单条时），任务中心滚动到该行并高亮。</li>
 * </ul>
 */
import { h, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNotification } from 'naive-ui'
import {
  anyTabVisible,
  desktopNotifyEnabled,
  finishedKey,
  finishedSeen,
  markFinishedSeen,
  onTasksFinished,
  otherTabFocused,
  startTaskWatcher,
  stopTaskWatcher,
  type FinishedContext,
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

/** 去任务中心；给了 taskId 就深链到那一条（任务中心滚动并高亮） */
function goTasks(taskId?: string) {
  if (taskId) void router.push({ path: TASKS_PATH, query: { taskId } })
  else if (route.path !== TASKS_PATH) void router.push(TASKS_PATH)
}

/** 本页是否是用户眼前那一页：可见且有焦点；别的标签页都没焦点时，可见即可（容器 WebView 里 hasFocus 不可靠） */
function inFront() {
  if (document.visibilityState !== 'visible') return false
  try {
    if (document.hasFocus()) return true
  } catch {
    // ignore
  }
  return !otherTabFocused()
}

function toast(list: FinishedTask[]) {
  if (!list.length) return
  // 任务中心页列表本身会更新：不弹，但算看过（别的标签页不再补弹）
  markFinishedSeen(list.map(finishedKey))
  if (quietHere()) return
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
            goTasks(single?.taskId)
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
      goTasks(list.length === 1 ? list[0]!.taskId : undefined)
      n.close()
    }
  } catch {
    // 个别环境（容器 WebView）构造会抛：静默放弃，站内提示照常
  }
}

function onFinished(list: FinishedTask[], ctx: FinishedContext) {
  if (document.visibilityState === 'hidden') {
    unseen += list.length
    setBadge(unseen)
    // 桌面通知只由主标签页发，且只在没有任何标签页在用户眼前时（有可见标签页时由它出站内提示）
    if (ctx.leader && !anyTabVisible()) desktop(list)
    pending.push(...list)
    return
  }
  if (!inFront()) {
    // 可见但焦点在别的标签页：那边出提示；本页留着，切过来时若那边没出过再补
    pending.push(...list)
    return
  }
  // 还停在提交页：页面会自己出结果，不重复提示（也算看过）
  markFinishedSeen(list.map(finishedKey))
  toast(list.filter((t) => t.seenOn === null || t.seenOn !== route.path))
}

function flushPending() {
  if (!pending.length || !inFront()) return
  const list = pending.splice(0).filter((t) => !finishedSeen(finishedKey(t)))
  markFinishedSeen(list.map(finishedKey))
  toast(list.filter((t) => t.seenOn === null || t.seenOn !== route.path))
}

function onVisibility() {
  if (document.visibilityState !== 'visible') return
  if (unseen) {
    unseen = 0
    setBadge(0)
  }
  flushPending()
}

let off: (() => void) | null = null
onMounted(() => {
  off = onTasksFinished(onFinished)
  startTaskWatcher(() => route.path)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', flushPending)
})
onBeforeUnmount(() => {
  off?.()
  stopTaskWatcher()
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', flushPending)
})
</script>

<template>
  <span hidden />
</template>
