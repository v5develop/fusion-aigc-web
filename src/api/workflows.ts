/**
 * 工作流页（/workflow?flow=&category=&template=）接口：Java v1 兼容路由 `/api/v1/workflows/*`。
 *
 * <p>与 api/tools.ts 同一套：复用 api/index.ts 的实例（token、401 刷新、业务错误 toast），这里不吞错；
 * 请求体同为 Java `CoreToolSubmissionRequest` 的 camelCase 子集，按路由生效
 * （fashion = v1 ImageRequest、visual = v1 VisualRequest，见 views/workflow/schemas.ts）。
 *
 * <p>提交即计费；每次提交带一个新的 Idempotency-Key，避免重试重复扣费。
 */
import { get, post } from './index.ts'
import { createSafeUuid } from '@/utils/utils'
import { deleteWithBody, type SubmittedToolRequest } from './tools.ts'

/** 工作流提交凭据（CoreToolWorkflowSubmissionAdapter.Submission：workflows 路由只回 workflowHistoryIds） */
export interface WorkflowSubmission {
  workflowHistoryIds?: number[]
}

/** GET /api/v1/workflows/templates/{category} 的单条（CoreToolHistoryService.TemplateView） */
export interface WorkflowTemplateView {
  workflowId: number
  category: string
  /** 提交体 title 与历史分桶键，如 fashion-model-replace */
  title: string
  titleZh: string
  /** v1 workflow.payload 原样（运营配置）：{ result: string[], payload: { prompt, image_urls[] } } */
  payload?: {
    result?: string[]
    payload?: { prompt?: string; image_urls?: { url?: string; title?: string; max_num?: number }[] }
  } | null
  createdAt?: string | null
  updatedAt?: string | null
}

interface TaskResult {
  url?: string | null
}

/** data.result.tasks[] 的一项（CompatV1HistoryView.WorkflowTask） */
export interface WorkflowTaskItem {
  itemIndex: number
  taskId?: string | null
  status?: string | null
  error?: string | null
  taskResult?: TaskResult | null
}

/** GET /api/v1/workflows/{workflowTitle}/histories 的单条（CompatV1HistoryView.WorkflowHistory） */
export interface WorkflowHistoryItem {
  workflowHistoryId: number
  /** PENDING / RUNNING / WAITING_MANUAL_PROCESS / SUCCEED / FAILED / TIMEOUT / CANCELLED / PARTIAL_SUCCEED */
  status: string
  workflowTitle?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  data?: {
    type?: string | null
    payload?: { prompt?: string | null; imageUrls?: string[] | null; videoUrls?: string[] | null } | null
    result?: {
      status?: string | null
      error?: string | null
      errorCode?: string | null
      taskResult?: TaskResult | null
      tasks?: WorkflowTaskItem[] | null
    } | null
    inputImageUrls?: string[] | null
    inputVideoUrls?: string[] | null
    resultImageUrls?: string[] | null
    resultVideoUrls?: string[] | null
    /** 原始提交体（CompatV1HistoryView.WorkflowData.requestParams），「重新编辑」回填用；老记录为 null */
    requestParams?: SubmittedToolRequest | null
  } | null
}

export interface WorkflowHistoryPage {
  current: number
  pages: number
  total: number
  data: WorkflowHistoryItem[]
}

const SUBMIT_TIMEOUT = 60000

/** 提交：POST 到 schema.javaEndpoint（/api/v1/workflows/fashion | visual） */
export function submitWorkflow(endpoint: string, body: Record<string, unknown>) {
  return post<WorkflowSubmission>(endpoint, body, { 'Idempotency-Key': createSafeUuid() }, SUBMIT_TIMEOUT)
}

/** 某分类（fashion / video / visual …）下已启用的模板；返回数组，不是分页信封 */
export function workflowTemplates(category: string) {
  return get<WorkflowTemplateView[]>(`/api/v1/workflows/templates/${category}`)
}

/**
 * 某个工作流的历史（只返回本人的记录）。`original=true` 取下载用地址（不带水印），
 * false 取查看用地址（带水印）——Java 控制器口径「查看带水印、下载不带」。
 */
export function workflowHistories(workflowTitle: string, page = 1, size = 20, original = false) {
  return get<WorkflowHistoryPage>(`/api/v1/workflows/${workflowTitle}/histories`, { page, size, original })
}

/**
 * 删除工作流历史：DELETE /api/v1/workflows/{workflowTitle}/histories，请求体 {historyIds:[id]}。
 * 整批校验，记录（含组执行成员）仍在进行中会整批拒绝。
 */
export function deleteWorkflowHistories(workflowTitle: string, ids: number[]) {
  return deleteWithBody(`/api/v1/workflows/${workflowTitle}/histories`, { historyIds: ids })
}
