/**
 * 任务中心「预计剩余时间」：后端 etaSeconds / progressSource 的展示与两次轮询之间的本地倒计时。
 *
 * <p>口径（Java CreationTaskCenterService）：etaSeconds 为剩余秒数（≤3600），未知 / 已超时 / 已结束为 null；
 * progressSource = REAL（真实推进）/ ESTIMATED（按耗时外推）/ NONE（无从估计）。
 *
 * <p>展示规则：
 * - 有 etaSeconds：每秒本地递减，「预计还需约 N 秒 / 分钟」；减到 0 先显示「即将完成」，
 *   宽限期过后服务端仍在处理就改为「仍在生成」；每次拿到新的服务端值重新起算。
 * - 无 etaSeconds 且来源不是 NONE：「仍在生成」。
 * - ESTIMATED 比 REAL 弱一档（调用方按 tone 选更淡的颜色）。
 *
 * <p>读屏：可见文案每秒都可能变，不能直接挂 aria-live；另给一份粗粒度的 srText
 * （「不到 N 分钟」分档 / 即将完成 / 仍在生成），只在跨档时变化，供 aria-live="polite" 播报。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

export type EtaTone = 'real' | 'estimated'

export interface TaskEtaView {
  /** 可见文案（可能每秒变化） */
  text: string
  /** 读屏播报文案（只在跨档时变化） */
  srText: string
  tone: EtaTone
}

export interface EtaSource {
  taskId: string
  etaSeconds?: number | null
  progressSource?: string | null
}

/** 倒计时归零后「即将完成」保留多久（秒），之后服务端仍在处理就显示「仍在生成」 */
export const SOON_GRACE_SECONDS = 20
/** 读屏分档（分钟）：只在跨档时播报 */
const SR_MINUTE_BANDS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60]

const STILL = '仍在生成'
const SOON = '即将完成'

/** 可见文案：<60 秒按 5 秒取整（不报 0 秒），否则按分钟四舍五入（至少 1 分钟） */
export function formatEta(seconds: number): string {
  if (seconds < 60) {
    const n = Math.max(5, Math.ceil(seconds / 5) * 5)
    if (n < 60) return `预计还需约 ${n} 秒`
  }
  return `预计还需约 ${Math.max(1, Math.round(seconds / 60))} 分钟`
}

/** 读屏文案：粗分档「不到 N 分钟」 */
export function formatEtaForScreenReader(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  const band = SR_MINUTE_BANDS.find((b) => b >= minutes) ?? 60
  return `预计还需不到 ${band} 分钟`
}

/**
 * 纯函数：给定服务端剩余秒数与距拿到它已过去的秒数，算出展示内容。
 * 无可展示内容（来源 NONE 且无 ETA）返回 null。
 */
export function resolveEta(
  etaSeconds: number | null | undefined,
  progressSource: string | null | undefined,
  elapsedSeconds: number,
): TaskEtaView | null {
  const source = progressSource || 'NONE'
  const tone: EtaTone = source === 'REAL' ? 'real' : 'estimated'
  if (etaSeconds == null || !Number.isFinite(etaSeconds)) {
    return source === 'NONE' ? null : { text: STILL, srText: STILL, tone }
  }
  const remaining = Math.max(0, etaSeconds - Math.max(0, elapsedSeconds))
  if (remaining > 0) return { text: formatEta(remaining), srText: formatEtaForScreenReader(remaining), tone }
  const overdue = Math.max(0, elapsedSeconds) - etaSeconds
  return overdue <= SOON_GRACE_SECONDS
    ? { text: SOON, srText: SOON, tone }
    : { text: STILL, srText: STILL, tone }
}

/**
 * 列表倒计时：items 每次被整体替换（即拿到新一轮服务端数据）就重新起算；
 * 只在有带 ETA 的在途任务时开 1 秒节拍，卸载时清理。
 *
 * @param items 任务列表（每轮刷新整体替换）
 * @param isActive 只对在途任务算 ETA（终态不显示）
 */
export function useTaskEta<T extends EtaSource>(items: Ref<T[]>, isActive: (item: T) => boolean) {
  /** taskId → 拿到该服务端值的时间戳 */
  const stamps = new Map<string, number>()
  const now = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | null = null

  function stopTicker() {
    if (ticker) clearInterval(ticker)
    ticker = null
  }

  watch(
    items,
    (list) => {
      const at = Date.now()
      stamps.clear()
      for (const item of list) if (isActive(item) && item.etaSeconds != null) stamps.set(item.taskId, at)
      now.value = at
      if (stamps.size === 0) stopTicker()
      else if (!ticker) ticker = setInterval(() => (now.value = Date.now()), 1000)
    },
    { immediate: true },
  )

  onBeforeUnmount(stopTicker)

  function etaOf(item: T): TaskEtaView | null {
    if (!isActive(item)) return null
    const at = stamps.get(item.taskId)
    const elapsed = at == null ? 0 : Math.floor((now.value - at) / 1000)
    return resolveEta(item.etaSeconds, item.progressSource, elapsed)
  }

  return { etaOf }
}
