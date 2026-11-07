/**
 * 商拍工作室（Go 网关 /api/v1/studio）接口封装。
 *
 * <p>与其它接口共用同一个域名与令牌（网关按 /api/v1/studio 前缀转发给 Go），
 * 复用 api/index.ts 的实例：token 注入、401 刷新、业务错误 toast 全部沿用。
 * 字段 snake_case 原样收发，契约见 fusion_aigc_go/docs/api/api-studio.md。
 *
 * <p>幂等：三个提交接口必须带 Idempotency-Key（UUID），每次点「生成」新生成一个；
 * 重新编辑后的再提交是新的一次提交，自然拿到新 key。
 */
import { get, post, del } from './index.ts'
import type * as types from './studioTypes.ts'
import { llIdempotencyHeaders } from './localLife.ts'

const PREFIX = '/api/v1/studio'
/** 提交是重操作（整批冻结点数、图片校验），放宽超时 */
const SUBMIT_TIMEOUT = 60000

type IdemHeaders = Record<string, string>

// ---------------- 提交 ----------------

/** 商拍换装整批提交（模特数 × 每位张数，服务端拆任务） */
export function studioSubmitTryon(data: types.StudioTryonSubmitReq, headers: IdemHeaders = llIdempotencyHeaders()) {
  return post<types.StudioSubmitResp>(`${PREFIX}/tryon/submit`, data, headers, SUBMIT_TIMEOUT)
}

/** 姿态复刻整批提交（人物 1 张 + 姿势 1–9 张） */
export function studioSubmitPose(data: types.StudioPoseSubmitReq, headers: IdemHeaders = llIdempotencyHeaders()) {
  return post<types.StudioSubmitResp>(`${PREFIX}/pose/submit`, data, headers, SUBMIT_TIMEOUT)
}

/**
 * 姿态复刻多人配对预览（免费只读、不要 Idempotency-Key）。
 * 读图很慢（20–140 秒，整请求最长约 4 分钟），超时放宽到 260 秒；同一用户同时只能跑一个（4002）。
 */
export const POSE_PREVIEW_TIMEOUT = 260000
export function studioPosePreview(data: types.StudioPosePreviewReq) {
  return post<types.StudioPosePreviewResp>(`${PREFIX}/pose/preview`, data, undefined, POSE_PREVIEW_TIMEOUT)
}

/** 图片生成（count 张拆任务） */
export function studioSubmitImageGen(
  data: types.StudioImageGenSubmitReq,
  headers: IdemHeaders = llIdempotencyHeaders(),
) {
  return post<types.StudioSubmitResp>(`${PREFIX}/image-generate/submit`, data, headers, SUBMIT_TIMEOUT)
}

// ---------------- 提交前报价（只读，不冻结，不要 Idempotency-Key） ----------------

/** 提交前报价：请求体与对应提交接口同构（只读张数与模型 / 分辨率 / 比例），回本次提交预计冻结的点数 */
export function studioQuoteTryon(data: types.StudioTryonQuoteReq) {
  return post<types.StudioQuoteResp>(`${PREFIX}/tryon/quote`, data)
}

export function studioQuotePose(data: types.StudioPoseQuoteReq) {
  return post<types.StudioQuoteResp>(`${PREFIX}/pose/quote`, data)
}

export function studioQuoteImageGen(data: types.StudioImageGenQuoteReq) {
  return post<types.StudioQuoteResp>(`${PREFIX}/image-generate/quote`, data)
}

// ---------------- 批次 ----------------

/** 批次详情 + 全部子任务（生成中每 2 秒轮询这个） */
export function studioBatchDetail(id: number) {
  return get<types.StudioBatchDetail>(`${PREFIX}/batches/${id}`)
}

/** 取消批次：只取消还在排队的任务（点数立即退回），生成中的会继续跑完 */
export function studioCancelBatch(id: number) {
  return post<types.StudioCancelResp>(`${PREFIX}/batches/${id}/cancel`, {})
}

/**
 * 重试批次里一个失败的子任务（POST /tasks/{task_id}/retry，Go studio RPC RetryTask）：
 * 只重跑这一张的生图（沿用已存提示词 / 图序，不再切图、反推），按原入口重新冻结 1 张的点数；
 * 回批次详情（同 GET /batches/{id}），之后照常轮询批次。重复点击幂等（已在重做中直接回当前详情）。
 * 只收失败态任务，且批次须已结束为「全部失败 / 部分成功」；同一任务最多重做 3 轮，超过只能重新提交。
 */
export function studioRetryTask(taskId: string) {
  return post<types.StudioBatchDetail>(`${PREFIX}/tasks/${encodeURIComponent(taskId)}/retry`, {})
}

/** 删除批次（逻辑删除；生成中不能删，code=4002） */
export function studioDeleteBatch(id: number) {
  return del(`${PREFIX}/batches/${id}`)
}

// ---------------- 历史 ----------------

/** 生成历史（游标分页，按创建时间倒序）；next_cursor 空 = 没有下一页 */
export function studioHistory(params: types.StudioHistoryParams = {}) {
  return get<types.StudioHistoryResp>(`${PREFIX}/history`, {
    kind: params.kind || undefined,
    cursor: params.cursor || undefined,
    limit: params.limit ?? 20,
  })
}
