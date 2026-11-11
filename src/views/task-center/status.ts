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
