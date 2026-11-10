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
import { get, post, del, patch, authorizedFetch } from './index.ts'
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

/**
 * 商拍「AI 找细节」（免费只读、不要 Idempotency-Key）：回每张服装图的细节框（归一化 [x,y,w,h]）与部位名；
 * 前端按框在原图上本地显示裁切缩略图（不调裁图接口），删减 / 重新裁切后随提交带回 detail_crops。
 * 读图慢（单次可达 1–3 分钟），超时同配对预览；同一用户同时只能跑一个、按用户限频（都是 4002）。
 */
export const TRYON_DETAILS_TIMEOUT = POSE_PREVIEW_TIMEOUT
export function studioTryonDetails(data: types.StudioDetailsReq) {
  return post<types.StudioDetailsResp>(`${PREFIX}/tryon/details`, data, undefined, TRYON_DETAILS_TIMEOUT)
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

// ---------------- 模型档能力 ----------------

/**
 * 模型档能力（只读）：每个模型档的展示名、实际可用的分辨率 / 比例、参考图上限；with_price 附单张点数。
 * kind 影响参考图上限与是否有「自动」比例；不传 = imagegen。
 */
export function studioModels(params: { kind?: types.StudioKind; with_price?: boolean } = {}) {
  return get<types.StudioModelsResp>(`${PREFIX}/models`, params)
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

/**
 * 编辑提示词后重新生成单张（POST /tasks/{task_id}/regenerate，仅姿态复刻）：用改过的提示词重跑这一张的生图，
 * 计费同重试（重新冻结 1 张点数）；失败 / 成功的任务都可以；同一提示词重复提交幂等。回批次详情，之后照常轮询批次。
 */
export function studioRegenerateTask(taskId: string, prompt: string) {
  return post<types.StudioBatchDetail>(`${PREFIX}/tasks/${encodeURIComponent(taskId)}/regenerate`, { prompt })
}

/**
 * 保存子任务的校色参数（PATCH /tasks/{task_id}/color-fix）：仅本人、仅成功的任务；浏览器里烘图，服务端只存五个滑杆值。
 * 回该子任务（含 color_fix_params）。老网关没有这个接口时返回 HTTP 404。
 */
export function studioSaveTaskColorFix(taskId: string, data: types.StudioTaskColorFixReq) {
  return patch<types.StudioTask>(`${PREFIX}/tasks/${encodeURIComponent(taskId)}/color-fix`, data)
}

/**
 * 同一接口的「页面关闭前」版本：fetch keepalive（页面卸载后浏览器仍把请求发完），与 axios 同一 baseURL 与 Bearer。
 * 不走拦截器（不 toast、不刷新令牌后重放）；sendBeacon 只能 POST、带不了 Authorization，所以用 keepalive。
 */
export function studioSaveTaskColorFixKeepalive(taskId: string, data: types.StudioTaskColorFixReq): Promise<Response> {
  return authorizedFetch(`${PREFIX}/tasks/${encodeURIComponent(taskId)}/color-fix`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    keepalive: true,
  })
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

// ---------------- 区域蒙版（局部校色） ----------------

/** 区域蒙版超时：服务端未命中缓存时要等一次分割调用（上限约 120s），比网关路由超时（250s）短 */
export const SEGMENT_MASK_TIMEOUT = 130000

/**
 * 区域蒙版（POST /masks，免费）：识别 imageUrl 的服装 / 商品 / 人物 / 背景区域，回白色 + 软 alpha 的 PNG 蒙版地址。
 * 服装可带 parts（上衣 / 外套 / 下装 / 裙装 / 鞋 / 包 / 帽，多选）只取这些部位；响应 available_parts 缺省 = 老网关不支持细分。
 * 服务端按（去查询串的地址, 区域, 部位）缓存，重复请求立即返回 cached=true。
 * 错误（已在 SILENT_ERROR_URLS，不弹全局 toast，调用方就地提示）：4001「没识别到对应区域」、
 * 4002「识别太频繁，请稍后再试」、1003 地址不是本服务的、6001 识别服务暂不可用、7003 未开放；老网关 HTTP 404。
 */
export function studioSegmentMask(imageUrl: string, target: types.StudioMaskTarget, parts?: types.StudioMaskGarmentPart[]) {
  const body: types.StudioMaskReq = { image_url: imageUrl, target }
  if (target === 'garment' && parts?.length) body.parts = parts
  return post<types.StudioMaskResp>(`${PREFIX}/masks`, body, undefined, SEGMENT_MASK_TIMEOUT)
}
