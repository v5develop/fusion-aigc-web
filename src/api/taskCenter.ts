/**
 * 任务中心接口（Java CreationTaskCenterController，/api/v1/creation/task-center/*）。
 *
 * <p>状态桶、状态文案、进度都由后端算好，页面直接展示，不要自己推导；
 * 封面只用 coverUrl（已脱敏 / 预签名），不要碰 result_url。
 */
import { del, get, put } from './index.ts'

/** 状态桶：queued / processing / success / failed / cancelled */
export type TaskStatusBucket = 'queued' | 'processing' | 'success' | 'failed' | 'cancelled'

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
  /** video / image / text */
  resultType: string | null
  coverUrl: string | null
  resultText: string | null
  width: number | null
  height: number | null
  failReason: string | null
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
  /** 带水印副本地址（免费用户在工具页看到的是它；无副本时不下发） */
  watermark?: string | null
}

/** 单条任务详情（状态口径与列表一致，另带素材库产物引用） */
export interface ITaskCenterTask {
  taskId: string
  status: number
  statusBucket: string
  statusLabel: string
  createTime: string
  progress: number
  coverUrl: string
  assetGroupId: string
  blocked: boolean
  assets: ITaskCenterAssetRef[]
}

/** 单条任务详情：结果图「校色后存为资产版本」靠它定位素材库资产 */
export function taskCenterTask(taskId: string) {
  return get<ITaskCenterTask>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}`)
}

/** 任务的原始提交参数（只能查自己的任务） */
export function taskCenterParams(taskId: string) {
  return get<ITaskCenterParams>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}/params`)
}
