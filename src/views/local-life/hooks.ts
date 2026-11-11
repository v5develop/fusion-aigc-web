/** 本地生活套件共享 hooks：使用约定门闩、列表加载与轮询 */

import { computed, onUnmounted, ref } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { llAcceptAgreement, llGetAgreement } from '@/api/local-life.ts'
import { useUserInfoStore } from '@/stores/user-info.ts'
import { POLL_HIDDEN_MIN, POLL_RAMP } from '@/utils/hooks/usePolling.ts'

// ---------------- 使用约定 ----------------

// 全模块共享一份：会话内同意过就不再问。刷新页面后后端记录仍在，也不会再弹
let accepted = false
let pending: Promise<boolean> | null = null

function showAgreementModal(): Promise<boolean> {
  return new Promise((resolve) => {
    const { modal } = createDiscreteApi(['modal'])
    const dialog = modal.create({
      title: 'AIGC 功能使用约定',
      content:
        '使用 AI 生成功能前，请阅读并同意《AIGC 功能使用约定》：生成内容由 AI 产生，请注意合规使用；对外发布前请自行确认内容无误。',
      positiveText: '同意并继续',
      negativeText: '暂不使用',
      closable: false,
      maskClosable: false,
      onPositiveClick: () => {
        return llAcceptAgreement()
          .then((res) => {
            if (res.data?.accepted) accepted = true
            resolve(true)
            dialog.destroy()
          })
          .catch(() => {
            // 失败 toast 已由请求层弹出；弹窗留着让用户重试
            return Promise.reject(new Error('accept failed'))
          })
      },
      onNegativeClick: () => {
        dialog.destroy()
        resolve(false)
      },
      onClose: () => resolve(false),
    })
  })
}

/**
 * 生成前先确保已同意《AIGC功能使用约定》（后端 1007 的前端预防）。
 * 并发提交只发一次检查；同意结果会话内缓存。
 */
export function useAgreement() {
  const ensureAgreed = (): Promise<boolean> => {
    if (accepted) return Promise.resolve(true)
    if (pending) return pending
    pending = (async () => {
      try {
        const res = await llGetAgreement()
        if (res.data?.accepted) {
          accepted = true
          return true
        }
        return await showAgreementModal()
      } catch {
        // 检查接口失败不拦路：让提交请求自己报错，别把一次网络抖动变成功能不可用
        return true
      } finally {
        pending = null
      }
    })()
    return pending
  }
  return { ensureAgreed }
}

// ---------------- 详情轮询 ----------------

/**
 * 详情轮询：每 interval 执行一次 fetcher，把 data 交给 onTick；
 * onTick 返回 true 继续下一轮，返回 false 收掉。单轮失败不中断（网络抖动）。
 * 组件卸载自动停。
 *
 * <p>同一时刻只有一条轮询链：链还活着（等下一轮或请求在途）时再 start() 不另起一条；
 * stop() 之后在途请求回来的结果直接丢弃，不会再进 onTick（三栏页切换记录时靠它防止上一条的详情写回当前）。
 */
/** 页面隐藏时的轮询间隔：常规的 3 倍、至少 10 秒（切回前台由 useVisibleResume 立即补一轮） */
function hiddenAware(interval: number) {
  return document.visibilityState === 'hidden' ? Math.max(interval * 3, POLL_HIDDEN_MIN) : interval
}

/** 页面切回前台时回调；组件卸载自动解绑 */
function useVisibleResume(fn: () => void) {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') fn()
  }
  document.addEventListener('visibilitychange', onVisibility)
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibility))
}

export function usePollingWhile<T>(
  fetcher: () => Promise<{ data?: T }>,
  onTick: (data: T | undefined) => boolean,
  interval = 3000,
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 每次 stop() 自增；链只认自己起步时的代号，代号变了即作废 */
  let generation = 0
  let alive = false
  const stop = () => {
    generation++
    alive = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  onUnmounted(stop)

  async function run(gen: number) {
    timer = null
    let keep = true
    try {
      const res = await fetcher()
      if (gen !== generation) return
      keep = onTick(res?.data)
    } catch {
      keep = true
    }
    if (gen !== generation) return
    if (keep) timer = setTimeout(() => void run(gen), hiddenAware(interval))
    else alive = false
  }

  const start = () => {
    if (alive) return
    alive = true
    void run(generation)
  }
  // 切回前台：正在等下一轮的立即补一轮（请求在途时不另起）
  useVisibleResume(() => {
    if (!alive || !timer) return
    clearTimeout(timer)
    timer = null
    void run(generation)
  })
  return { start, stop }
}

// ---------------- 列表加载与轮询 ----------------

/**
 * 本地生活通用列表：分页加载 + 「有任务在跑就自动轮询」+ 跑完刷新点数。
 *
 * <p>与电商模块的 sessionId 恢复不同，本地生活的任务都是服务端记录：
 * 刷新页面后靠「列表里还有在跑的」自然恢复轮询，前端无需持久化任何状态。
 *
 * @param fetcher   列表接口（返回标准信封，data 里有 list/total）；翻页由本 hook 攒页码并发拉取后拼接
 * @param isRunning 条目是否还在生成中（轮询进行依据）
 * @param interval  轮询间隔，默认 3s；视频类建议 5s
 * @param pageSize  每页条数
 */
export function useLLList<T extends { id: number }>(
  fetcher: (params: { page: number; page_size: number }) => Promise<{ data?: { list?: T[]; total?: number } | null }>,
  isRunning: (item: T) => boolean,
  interval = 3000,
  pageSize = 20,
) {
  const { updateUserInfo } = useUserInfoStore()

  const items = ref<T[]>([]) as { value: T[] }
  const total = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loadedPages = ref(0)

  const hasMore = computed(() => items.value.length < total.value)
  const hasRunning = computed(() => items.value.some(isRunning))
  // 上一轮的是否有在跑任务：从有到无的那一刻说明有任务到终态（扣点/退点），刷一次点数
  let lastRunning = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function loadPage(page: number): Promise<T[]> {
    const res = await fetcher({ page, page_size: pageSize })
    total.value = res.data?.total ?? 0
    return res.data?.list ?? []
  } /** 首屏 / 手动刷新。加载完按需进入轮询 */
  async function reload() {
    loading.value = true
    try {
      items.value = await loadPage(1)
      loadedPages.value = 1
      startPollingIfNeeded()
    } finally {
      loading.value = false
    }
  }

  /** 触底加载下一页 */
  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      items.value.push(...(await loadPage(loadedPages.value + 1)))
      loadedPages.value++
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * 静默刷新已加载的全部分页：列表按创建时间倒序、新生成的记录总在第 1 页，
   * 各页并发拉取后原样拼接即可，不打乱用户已看到的顺序。
   */
  async function silentRefresh() {
    const pages = await Promise.all(Array.from({ length: loadedPages.value }, (_, i) => loadPage(i + 1)))
    items.value = pages.flat()
  }

  /** 刚提交后的快查（1.5s、2s，再回常规间隔） */
  let rampStep: number = POLL_RAMP.length
  function nextDelay() {
    if (document.visibilityState === 'hidden') return hiddenAware(interval)
    return rampStep < POLL_RAMP.length ? Math.min(POLL_RAMP[rampStep++]!, interval) : interval
  }

  function startPollingIfNeeded() {
    const running = hasRunning.value
    if (lastRunning && !running) updateUserInfo()
    lastRunning = running
    if (running && !timer) {
      timer = setTimeout(loop, nextDelay())
    }
  }

  // 切回前台：有在等的下一轮就立即补
  useVisibleResume(() => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    void loop()
  })

  async function loop() {
    timer = null
    try {
      await silentRefresh()
    } catch {
      // 单轮失败继续下一轮，列表轮询不因网络抖动中断
    }
    startPollingIfNeeded()
  }

  function stopPolling() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  onUnmounted(stopPolling)

  return {
    items,
    total,
    loading,
    loadingMore,
    hasMore,
    hasRunning,
    reload,
    loadMore,
    /** 提交成功后由页面手动调用：立即刷一次列表并按需进入轮询 */
    refresh: async () => {
      rampStep = 0
      await silentRefresh().catch(() => {})
      // 已排着常规间隔的下一轮：改排到快查节奏
      stopPolling()
      startPollingIfNeeded()
    },
  }
}
