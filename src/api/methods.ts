import { post, get, ssePost } from './index.ts'
import type { SsePostHandlers } from './index.ts'
import * as types from './types'
import { createSafeUuid } from '@/utils/utils'

export function getSts(data: types.IGetSts) {
  const { subDir = 'uploads', visibility = 'public', ...rest } = data
  return post('/api/v1/storage/direct/sts', {
    subDir,
    visibility,
    ...rest,
  })
}

export function uploadConfirm(data: { objectKey: string }) {
  return post('/api/v1/storage/direct/confirm', data)
}

export function login(data: { username: string; password: string }) {
  return post('/api/v1/auth/login', data)
}

export function unionTokenLogin(data: { token: string }) {
  return post('/api/v1/auth/union-token-login', data)
}

export function getUserInfo() {
  return get('/api/v1/auth/user-info', {})
}

export function ecommerceSubmit(data: any, headers: any = { 'Idempotency-Key': createSafeUuid() }) {
  return post('/api/v1/creation/ecommerce/submit', data, headers, 60000)
}

export function pollingTask(sessionId: string) {
  return get(`/api/v1/creation/session/${sessionId}`)
}

export function pollingSingleTask(taskId: string) {
  return get(`/api/v1/creation/query/${taskId}`)
}

export function assetAll(params: types.IAssetAll, headers?: any) {
  return get('/api/v1/asset/all', params, headers)
}

/** 批量删除资产：ids 为资产 id 列表 */
export function assetBatchDelete(data: types.IAssetBatchDelete) {
  return post('/api/v1/asset/batch-delete', data)
}

export function faceRecognition(data: types.IFaceRecognition) {
  return post('/api/v1/creation/face-recognition/submit', data)
}

export function faceRecognitionStatusQuery(taskId: string) {
  return get(`/api/v1/creation/faceRecognition/${taskId}`)
}

export function publicTemplate(params: types.IPublicTemplate) {
  const { bizType, moduleCode, slotCode, type, filters, page, pageSize } = params as types.IPublicTemplate
  // 后端 /asset/public/template 约定 filters 为「JSON 字符串」，值须为数组：
  // {"gender":["female"],"handType":["handGestures"]}。axios 默认会把嵌套对象展开成
  // filters[gender][]=... 使后端 @RequestParam filters 取不到值、筛选整体失效，故此处统一序列化。
  // 同时剔除空值：调用方普遍写 gender: [filterData.gender]，未选择时是 [null]，
  // 后端会把 null 当筛选值导致查不到数据，故值数组过滤空元素、过滤后为空的字段整个不传。
  let normalizedFilters: string | undefined
  if (filters && typeof filters === 'object') {
    const cleaned: Record<string, any[]> = {}
    for (const [key, val] of Object.entries(filters)) {
      const arr = (Array.isArray(val) ? val : [val]).filter((v) => v !== null && v !== undefined && v !== '')
      if (arr.length) cleaned[key] = arr
    }
    normalizedFilters = Object.keys(cleaned).length ? JSON.stringify(cleaned) : undefined
  } else {
    normalizedFilters = filters
  }
  // 仅透传契约字段，剔除调用方 spread 分页状态带入的 loading/hasMore 等无关参数
  return get('/api/v1/asset/public/template', {
    bizType: bizType ?? 'ecommerce',
    type: type ?? 'image',
    moduleCode,
    ...(slotCode ? { slotCode } : {}),
    page: page ?? 1,
    pageSize: pageSize ?? 15,
    ...(normalizedFilters ? { filters: normalizedFilters } : {}),
  })
}

export function creationSubmit(data: types.ICreationSubmit, headers: any = { 'Idempotency-Key': createSafeUuid() }) {
  // 图生图等任务后端需先处理输入图，提交耗时可能超过全局 10s 超时，单独放宽
  return post('/api/v1/creation/submit', data, headers, 60000)
}

export function publicDisplay(params: any) {
  return get('/api/v1/asset/public/display', params)
}

export function optimizePrompt(params: types.IOptimizePrompt) {
  return post('/api/v1/creation/optimize-prompt', params)
}

/** 流式优化提示词（SSE）：逐段返回正文增量，改善带图优化的等待体感。返回可用于中断的 abort 函数。 */
export function optimizePromptStream(params: types.IOptimizePrompt, handlers: SsePostHandlers) {
  return ssePost('/api/v1/creation/optimize-prompt-stream', params, handlers)
}

/** 提示词模板列表（首屏卡片，轻量） */
export function promptList(params: types.IPromptList = {}) {
  return get<types.IPromptListData>('/api/v1/creation/prompts', params)
}

/** 提示词模板详情（点击卡片后获取完整内容，解析后填充输入框插槽） */
export function promptDetail(id: string) {
  return get<types.IPromptDetail>(`/api/v1/creation/prompts/${id}`)
}

export function creationHistory(params: types.ICreationHistory) {
  return get('/api/v1/creation/history', params)
}

export function quotePreview(data: types.IQuotePreview) {
  return post('/api/v1/billing/quote/preview', data)
}
