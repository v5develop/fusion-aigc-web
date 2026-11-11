/**
 * 任务中心接口（Java CreationTaskCenterController，/api/v1/creation/task-center/*）。
 *
 * <p>状态桶、状态文案、进度都由后端算好，页面直接展示，不要自己推导；
 * 封面只用 coverUrl（已脱敏 / 预签名），不要碰 result_url。
 */
import { del, get, post, put } from './index.ts'

/** 状态桶：queued / processing / success / failed / cancelled */
export type TaskStatusBucket = 'queued' | 'processing' | 'success' | 'failed' | 'cancelled'

/**
 * 进度来源：REAL = 子任务 / 管线步骤真实推进；ESTIMATED = 按耗时外推的估算；NONE = 无从估计。
 * ESTIMATED 只是估算，展示上要比 REAL 弱一档。
 */
export type TaskProgressSource = 'REAL' | 'ESTIMATED' | 'NONE'

/** 总览与列表共用的筛选条件 */
export interface ITaskCenterFilter {
  /** 创作入口编码（筛选项接口下发），空 = 全部 */
  entryCode?: string
  /** today / 7d / 30d / custom，空 = 不限 */
  timeRange?: string
  /** yyyy-MM-dd HH:mm:ss，仅 timeRange=custom 生效 */
  startTime?: string
  endTime?: string
  /** true = 只看已收藏 */
  collected?: boolean
}

export interface ITaskCenterQuery extends ITaskCenterFilter {
  /** 空 = 全部；active = 排队中 + 生成中；或 success / failed / cancelled 等单桶 */
  statusBucket?: 'active' | TaskStatusBucket | string
  page: number
  /** 上限 50 */
  pageSize: number
}

/** 各状态桶计数（无任务时为 0） */
export interface ITaskCenterOverview {
  total: number
  queued: number
  processing: number
  success: number
  failed: number
  cancelled: number
}

export interface ITaskCenterItem {
  /** 任务编号（原样展示） */
  taskId: string
  entryCode: string
  typeName: string
  /** 入口名 + 编号末 10 位 */
  title: string
  status: number
  statusBucket: TaskStatusBucket | string
  statusLabel: string
  /** yyyy-MM-dd HH:mm:ss */
  createTime: string
  /** 0..100 */
  progress: number | null
  /** 预计剩余秒数（≤3600）；未知 / 已超时 / 已结束为 null */
  etaSeconds?: number | null
  /** 进度来源（旧后端不下发时按 NONE 处理） */
  progressSource?: TaskProgressSource | string | null
  /** video / image / text */
  resultType: string | null
  coverUrl: string | null
  /**
   * 封面缩略图（列表卡片用，只增字段；旧后端不下发）：私有桶签名封面由服务端缩放（最长边 480、webp）后重签，
   * 客户端追加处理参数会 403。无法派生时与 coverUrl 相同。只用于缩略展示，预览 / 下载仍用 coverUrl。
   */
  coverThumbnailUrl?: string | null
  resultText: string | null
  width: number | null
  height: number | null
  failReason: string | null
  /** 能否取消：仅排队 / 生成中、且尚未提交给模型供应商（已产生成本的不给取消），以后端为准 */
  canCancel: boolean | null
  assetGroupId: string | null
  blocked: boolean | null
  /** 当前用户是否已收藏 */
  collected?: boolean | null
  /** 能否「做同款 / 参数回填」（来自工具 / 工作流页的任务） */
  canRefill?: boolean | null
}

/** GET /tasks/{taskId}/params：原始提交参数（已脱敏），供做同款 / 参数回填 */
export interface ITaskCenterParams {
  taskId: string
  entryCode: string | null
  entryName: string | null
  /** tool 工具页 / workflow 工作流页 / unsupported 不支持 */
  kind: 'tool' | 'workflow' | 'unsupported' | string
  /** kind=tool：工具历史 toolTitle（对 ToolSchema.historyTitle） */
  toolTitle: string | null
  /** kind=workflow：模板 title（对 WorkflowSchema.templateTitle） */
  workflowTitle: string | null
  route: string | null
  requestParams: Record<string, unknown> | null
  refillable: boolean
  reason: string | null
}

export interface ITaskCenterPage {
  list: ITaskCenterItem[]
  total: number
}

export interface ITaskCenterOption {
  value: string
  label: string
}

export interface ITaskCenterFilters {
  entryTypes: { entryCode: string; name: string }[]
  statuses: ITaskCenterOption[]
  timeRanges: ITaskCenterOption[]
}

export function taskCenterOverview(params: ITaskCenterFilter) {
  return get<ITaskCenterOverview>('/api/v1/creation/task-center/overview', params)
}

export function taskCenterTasks(params: ITaskCenterQuery) {
  return get<ITaskCenterPage>('/api/v1/creation/task-center/tasks', params)
}

export function taskCenterFilters() {
  return get<ITaskCenterFilters>('/api/v1/creation/task-center/filters')
}

/** 删除自己的已结束任务；在途或未结清的任务后端会拒绝 */
export function taskCenterDelete(taskId: string) {
  return del<boolean>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}`)
}

/** 收藏 / 取消收藏自己的任务（幂等）；返回操作后的收藏状态 */
export function taskCenterCollect(taskId: string, collected: boolean) {
  const url = `/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}/collect`
  return collected ? put<boolean>(url, {}) : del<boolean>(url)
}

/** 任务详情里的素材库产物引用（校色后按 image 对号定位资产） */
export interface ITaskCenterAssetRef {
  id: number
  image: string
  cover: string
  /** 封面缩略图（列表卡片用，只增字段）；无法派生时与 cover 相同 */
  coverThumbnailUrl?: string | null
  /** 带水印副本地址（免费用户在工具页看到的是它；无副本时不下发） */
  watermark?: string | null
  /** 产物媒体类型（旧后端不下发，按扩展名猜） */
  mediaType?: 'image' | 'video' | 'audio' | string | null
}

/** 详情里的子任务摘要（仅 FAN_OUT / 部分成功的父任务，最多 50 条） */
export interface ITaskCenterChild {
  taskId: string
  statusBucket: TaskStatusBucket | string
  statusLabel: string
  /** 仅失败子任务下发 */
  failReason?: string | null
  coverThumbnailUrl?: string | null
}

/**
 * 单条任务详情（状态口径与列表一致，另带素材库产物引用）。
 * 入口名、标题、失败原因、产物类型 / 文案、尺寸、耗时、收藏与回填能力、子任务由详情直接下发（均为只增字段，
 * 旧后端缺失时抽屉退回列表行 / params 接口补齐）；点数未下发，不显示。
 */
export interface ITaskCenterTask {
  taskId: string
  status: number
  statusBucket: string
  statusLabel: string
  createTime: string
  progress: number
  /** 预计剩余秒数（≤3600）；未知 / 已超时 / 已结束为 null */
  etaSeconds?: number | null
  /** 进度来源（旧后端不下发时按 NONE 处理） */
  progressSource?: TaskProgressSource | string | null
  coverUrl: string
  /** 封面缩略图（只增字段，口径同列表项）；无法派生时与 coverUrl 相同 */
  coverThumbnailUrl?: string | null
  assetGroupId: string
  blocked: boolean
  /** 能否取消：与列表项同一口径（排队 / 生成中、本人任务、尚未提交给模型供应商）；旧后端不下发 */
  canCancel?: boolean | null
  assets: ITaskCenterAssetRef[]
  entryCode?: string | null
  typeName?: string | null
  title?: string | null
  /** 仅失败时下发 */
  failReason?: string | null
  /** video / image / text */
  resultType?: string | null
  resultText?: string | null
  width?: number | null
  height?: number | null
  /** yyyy-MM-dd HH:mm:ss，仅终态 */
  finishedAt?: string | null
  /** 耗时秒数，仅终态 */
  durationSeconds?: number | null
  collected?: boolean | null
  canRefill?: boolean | null
  children?: ITaskCenterChild[] | null
}

/** 单条任务详情：结果图「校色后存为资产版本」靠它定位素材库资产 */
export function taskCenterTask(taskId: string) {
  return get<ITaskCenterTask>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}`)
}

/** 任务的原始提交参数（只能查自己的任务） */
export function taskCenterParams(taskId: string) {
  return get<ITaskCenterParams>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}/params`)
}

/** 用户取消自己的在途任务（Java CreationController POST /api/v1/creation/{taskId}/cancel）；退款由后端提交后处理 */
export function taskCenterCancel(taskId: string) {
  return post<boolean>(`/api/v1/creation/${encodeURIComponent(taskId)}/cancel`, {})
}
