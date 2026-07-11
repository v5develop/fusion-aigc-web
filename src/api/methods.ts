import { post, get, ssePost } from './index.ts'
import type { SsePostHandlers } from './index.ts'
import * as types from './types'
import type { IOptimizePrompt } from './types'
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

export function faceRecognition(data: types.IFaceRecognition) {
  return post('/api/v1/creation/face-recognition/submit', data)
}

export function faceRecognitionStatusQuery(taskId: string) {
  return get(`/api/v1/creation/faceRecognition/${taskId}`)
}

export function publicTemplate(params: types.IPublicTemplate) {
  return get('/api/v1/asset/public/template', {
    bizType: 'ecommerce',
    type: 'image',
    page: 1,
    pageSize: 15,
    ...params,
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

export function creationHistory(params: types.ICreationHistory) {
  return get('/api/v1/creation/history', params)
}

export function quotePreview(data: types.IQuotePreview) {
  return post('/api/v1/billing/quote/preview', data)
}
