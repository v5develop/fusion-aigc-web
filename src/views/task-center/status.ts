/**
 * 任务中心列表与详情抽屉共用的状态口径：只按后端给的 statusBucket 选样式，文案一律用后端 statusLabel。
 */

/** 在途（排队中 + 生成中）：显示进度 / 预计剩余时间、可能可取消 */
export const IN_FLIGHT = new Set(['queued', 'processing'])

/** 后端允许删除的状态桶（任务已结束）；在途任务不给删除入口 */
export const DELETABLE = new Set(['success', 'failed', 'cancelled'])

/** 状态胶囊底色 + 字色 */
export const CHIP_CLS: Record<string, string> = {
  queued: 'bg-warning-soft text-warning',
  processing: 'bg-info-soft text-violet-ink',
  success: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger',
  cancelled: 'text-muted bg-surface3',
}

/** 状态胶囊里的 5px 状态点 */
export const DOT_CLS: Record<string, string> = {
  queued: 'bg-warning',
  processing: 'bg-violet',
  success: 'bg-success',
  failed: 'bg-danger',
  cancelled: 'bg-placeholder',
}

/** 「生成较慢」提示的缺省文案（后端 slowHint 缺失时用） */
export const SLOW_HINT_FALLBACK = '生成较慢，可以离开页面，完成后自动保存到素材库'

/** 在途且后端标了生成较慢时的提示文案；其余返回空串（状态标签不变，只多一行浅色提示） */
export function slowHintOf(t: { statusBucket: string; slow?: boolean | null; slowHint?: string | null }): string {
  if (!IN_FLIGHT.has(t.statusBucket) || t.slow !== true) return ''
  return t.slowHint?.trim() || SLOW_HINT_FALLBACK
}
