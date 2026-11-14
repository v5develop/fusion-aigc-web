<!--
  远端改动的呈现层（叠在舞台上）：顶部提示条「画布助手修改了 N 个节点」+ 改动节点高亮 2 秒 + 同步状态小点。
  高亮用一段按 data-id 生成的样式，不往节点对象上写字段（不进快照、不触发保存）。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CanvasSyncStatus } from './useCanvasSync.ts'

const props = defineProps<{
  notice: { text: string; seq: number } | null
  highlight: { ids: string[]; seq: number }
  status: CanvasSyncStatus
  /** 服务端宣告终止（画布已删除 / 登录已失效）：常驻横幅，不自动消失 */
  gone?: { code: string; text: string } | null
}>()

const HIGHLIGHT_MS = 2000
const NOTICE_MS = 4000

const activeIds = ref<string[]>([])
const noticeText = ref('')
let highlightTimer: ReturnType<typeof setTimeout> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.highlight.seq,
  () => {
    if (highlightTimer) clearTimeout(highlightTimer)
    activeIds.value = props.highlight.ids.slice(0, 200)
    highlightTimer = setTimeout(() => (activeIds.value = []), HIGHLIGHT_MS)
  },
)

watch(
  () => props.notice?.seq,
  () => {
    if (!props.notice) return
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeText.value = props.notice.text
    noticeTimer = setTimeout(() => (noticeText.value = ''), NOTICE_MS)
  },
)

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
})

/** 节点 id 只含字母数字下划线连字符（graph.ts nextNodeId / Go 工具 id 前缀）：其余字符一律剔除再进选择器 */
const highlightCss = computed(() => {
  const ids = activeIds.value.map((id) => id.replace(/[^\w-]/g, '')).filter(Boolean)
  if (!ids.length) return ''
  const sel = ids.map((id) => `.vue-flow__node[data-id="${id}"]`).join(',')
  return `${sel}{animation:xq-remote-pulse ${HIGHLIGHT_MS}ms ease-out 1;border-radius:14px}`
})

const statusLabel = computed(() => {
  if (props.status === 'gone') return '同步已停止'
  if (props.status === 'live') return '实时同步中'
  if (props.status === 'poll') return '定时检查更新'
  if (props.status === 'connecting') return '正在连接同步…'
  if (props.status === 'reconnecting') return '同步已断开，正在重连…'
  return '同步已暂停'
})
const statusDot = computed(() => {
  if (props.status === 'live') return 'bg-success'
  if (props.status === 'poll') return 'bg-violet'
  if (props.status === 'reconnecting') return 'bg-warning'
  if (props.status === 'gone') return 'bg-danger'
  return 'bg-line-strong'
})
</script>

<template>
  <component :is="'style'" v-if="highlightCss">{{ highlightCss }}</component>
  <div
    v-if="gone"
    class="absolute top-98px left-50% z-8 flex items-center gap-8px min-h-34px px-14px py-6px max-w-[calc(100%-32px)] rounded-17px border border-solid border-warning-line bg-warning-soft text-warning-fg text-13px -translate-x-50% shadow-[0_8px_20px_rgba(58,38,72,0.14)]"
    role="alert"
    data-testid="canvas-sync-gone"
  >
    <span class="w-6px h-6px rounded-full bg-warning shrink-0" aria-hidden="true" />
    {{ gone.text }}
  </div>
  <Transition name="xq-remote-notice">
    <div
      v-if="noticeText"
      class="absolute top-56px left-50% z-7 flex items-center gap-8px h-34px px-14px rounded-17px border border-solid border-violet-line bg-violet-soft text-violet-ink text-13px whitespace-nowrap shadow-[0_8px_20px_rgba(58,38,72,0.14)] -translate-x-50% pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <span class="w-6px h-6px rounded-full bg-violet" aria-hidden="true" />
      {{ noticeText }}
    </div>
  </Transition>
  <div
    class="absolute left-12px bottom-12px z-6 flex items-center gap-6px h-22px px-8px rounded-11px bg-surface/90 text-muted text-11px pointer-events-none"
    :title="statusLabel"
    role="status"
  >
    <span class="w-6px h-6px rounded-full" :class="statusDot" aria-hidden="true" />
    {{ statusLabel }}
  </div>
</template>

<style>
@keyframes xq-remote-pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(var(--xq-violet-rgb) / 0.55);
    outline: 2px solid rgb(var(--xq-violet-rgb) / 0.9);
    outline-offset: 4px;
  }
  70% {
    box-shadow: 0 0 0 14px rgb(var(--xq-violet-rgb) / 0);
    outline: 2px solid rgb(var(--xq-violet-rgb) / 0.6);
    outline-offset: 4px;
  }
  100% {
    box-shadow: 0 0 0 0 rgb(var(--xq-violet-rgb) / 0);
    outline: 2px solid rgb(var(--xq-violet-rgb) / 0);
    outline-offset: 4px;
  }
}
.xq-remote-notice-enter-active,
.xq-remote-notice-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.xq-remote-notice-enter-from,
.xq-remote-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}
@media (prefers-reduced-motion: reduce) {
  .xq-remote-notice-enter-active,
  .xq-remote-notice-leave-active {
    transition: none;
  }
}
</style>
