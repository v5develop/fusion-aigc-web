/**
 * 画布变更订阅：编辑器打开期间连着 SSE 事件流，事件交给 store.handleRemoteEvent（静默载入 / 三方合并）。
 *
 * <p>连接策略：
 * - 断线指数退避重连（1s → 2s → … 封顶 30s，带抖动），重连带 Last-Event-ID = 最近看到的 revision；
 *   重连成功后补查一次 /revision，防止服务端没有续传缓冲时漏掉断线期间的变化。
 * - 45s 没收到任何字节（含心跳）视为假死，主动断开重连。
 * - 页面隐藏时断开、暂停轮询；回到前台立即重连并补查。
 * - 服务端 hello.mode=poll（无 Redis）或接口不存在 → 退回轮询 /revision（间隔取服务端 pollIntervalMs，缺省 5s）。
 * - gone（CANVAS_GONE / SESSION_EXPIRED）：不重连、不轮询，给出终止提示；bye（RECONNECT / CONN_SLOT_UNAVAILABLE）：
 *   按 SSE `retry:` 间隔重连（RECONNECT 立即带 Last-Event-ID 续传）。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { CanvasEventsUnsupported, canvasRevision, openCanvasEventStream } from '@/api/canvas-sync.ts'
import type { CanvasEditorStore } from './useCanvasEditor.ts'

export type CanvasSyncStatus = 'idle' | 'connecting' | 'live' | 'poll' | 'reconnecting' | 'gone'

export interface ICanvasSyncGone {
  code: string
  text: string
}

const POLL_MS = 5000
const STALL_MS = 45_000
const BACKOFF_MIN = 1000
const BACKOFF_MAX = 30_000

export function useCanvasSync(store: CanvasEditorStore, canvasId: Ref<string>, ready: Ref<boolean>) {
  const status = ref<CanvasSyncStatus>('idle')
  /** 服务端宣告终止（不再重连）：画布已删除 / 登录已失效 */
  const gone = ref<ICanvasSyncGone | null>(null)
  let pollMs = POLL_MS
  let retryMs = 0
  let nextDelay: number | null = null
  let goneFlag = false
  let running = false
  let mode: 'sse' | 'poll' = 'sse'
  let controller: AbortController | null = null
  let wakeTimer: ReturnType<typeof setTimeout> | null = null
  let wake: (() => void) | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let lastSeen = ''

  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  /** 可被打断的等待（页面回到前台 / 停止时提前结束） */
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      wake = () => {
        if (wakeTimer) clearTimeout(wakeTimer)
        wakeTimer = null
        wake = null
        resolve()
      }
      wakeTimer = setTimeout(() => wake?.(), ms)
    })
  }

  function armStall(): void {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller?.abort(), STALL_MS)
  }

  async function checkRevision(id: string): Promise<void> {
    try {
      const res = await canvasRevision(id)
      if (res.revision) {
        lastSeen = res.revision
        store.checkRemoteRevision(res.revision)
      }
    } catch {
      // 轮询失败：下一轮再试
    }
  }

  async function loop(gen: number): Promise<void> {
    let backoff = BACKOFF_MIN
    let connectedBefore = false
    while (running && gen === generation) {
      const id = canvasId.value
      if (!id) return
      if (hidden()) {
        status.value = 'idle'
        await sleep(60_000)
        continue
      }
      if (mode === 'poll') {
        status.value = 'poll'
        await checkRevision(id)
        await sleep(pollMs)
        continue
      }
      status.value = connectedBefore ? 'reconnecting' : 'connecting'
      controller = new AbortController()
      let opened = false
      try {
        await openCanvasEventStream(id, {
          lastEventId: lastSeen || store.revision.value,
          signal: controller.signal,
          onOpen: () => {
            opened = true
            status.value = 'live'
            backoff = BACKOFF_MIN
            armStall()
            // 重连成功：补查一次，覆盖服务端不支持续传时断线期间的变化
            if (connectedBefore) void checkRevision(id)
            connectedBefore = true
          },
          onActivity: armStall,
          onEvent: (event) => {
            lastSeen = event.revision
            store.handleRemoteEvent(event)
          },
          onPollHint: (intervalMs) => {
            mode = 'poll'
            if (intervalMs && intervalMs >= 1000) pollMs = intervalMs
            controller?.abort()
          },
          onRetry: (ms) => {
            retryMs = ms
          },
          onGone: (code, reason) => {
            goneFlag = true
            gone.value = {
              code,
              text:
                code === 'SESSION_EXPIRED'
                  ? '登录已失效，实时同步已停止。请重新登录后继续编辑'
                  : reason && code !== 'CANVAS_GONE'
                    ? reason
                    : '这张画布已被删除或不再属于你，实时同步已停止',
            }
            controller?.abort()
          },
          onBye: (code) => {
            // RECONNECT：到达最长存活，立即续传；CONN_SLOT_UNAVAILABLE：按 retry 间隔（缺省 5s）
            nextDelay = code === 'RECONNECT' ? 200 : retryMs || POLL_MS
          },
        })
      } catch (err) {
        if (err instanceof CanvasEventsUnsupported) mode = 'poll'
      } finally {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = null
        controller = null
      }
      if (!running || gen !== generation) return
      if (goneFlag) {
        status.value = 'gone'
        running = false
        return
      }
      if (mode === 'poll' || hidden()) continue
      if (nextDelay != null) {
        const delay = nextDelay
        nextDelay = null
        status.value = 'reconnecting'
        await sleep(delay)
        continue
      }
      // 服务端正常关流（opened）也按退避重连，避免紧循环
      status.value = 'reconnecting'
      const delay = Math.min(BACKOFF_MAX, backoff) * (0.8 + Math.random() * 0.4)
      backoff = opened ? BACKOFF_MIN * 2 : Math.min(BACKOFF_MAX, backoff * 2)
      await sleep(delay)
    }
  }

  function start(): void {
    stop()
    if (!canvasId.value) return
    running = true
    mode = 'sse'
    gone.value = null
    goneFlag = false
    nextDelay = null
    retryMs = 0
    pollMs = POLL_MS
    lastSeen = store.revision.value
    generation += 1
    void loop(generation)
  }

  function stop(): void {
    running = false
    generation += 1
    controller?.abort()
    controller = null
    wake?.()
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = null
    if (!goneFlag) status.value = 'idle'
  }

  function onVisibility(): void {
    if (!running) return
    if (hidden()) {
      // 隐藏：断开事件流（loop 会进入等待），轮询也停在 sleep 里
      controller?.abort()
    } else {
      wake?.()
      // 回到前台立即补查一次
      if (canvasId.value) void checkRevision(canvasId.value)
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  // 画布加载完成（或切换画布）后开始订阅；卸载时停
  watch(
    [canvasId, ready],
    ([id, isReady], [prevId]) => {
      if (!id || !isReady) {
        if (id !== prevId) stop()
        return
      }
      if (!running || id !== prevId) start()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stop()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  })

  return { status, gone, start, stop }
}
