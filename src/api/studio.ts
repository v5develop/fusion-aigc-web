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

/** 图片生成（count 张拆任务） */
export function studioSubmitImageGen(data: types.StudioImageGenSubmitReq, headers: IdemHeaders = llIdempotencyHeaders()) {
  return post<types.StudioSubmitResp>(`${PREFIX}/image-generate/submit`, data, headers, SUBMIT_TIMEOUT)
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
