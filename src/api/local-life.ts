/**
 * 本地生活（Go 网关）接口封装。
 *
 * <p>与 Java 接口共用同一个域名与令牌（网关按 /api/v1/local-life 前缀转发给 Go），
 * 复用 api/index.ts 的实例：token 注入、401 刷新、业务错误 toast 全部沿用。
 *
 * <p>幂等：所有提交生成接口必须带 Idempotency-Key（UUID，网络重试时沿用同一个）。
 */
import { post, put, get, del } from './index.ts'
import type * as types from './local-life-types.ts'
import { AUTO_IDEM, idemDone, resolveIdem } from '@/utils/idempotency'

const PREFIX = '/api/v1/local-life'

/** 提交生成类接口的幂等头。每次点「生成」新取一个，重试时沿用调用方缓存的那份 */
export const llIdempotencyHeaders = () => ({ 'Idempotency-Key': AUTO_IDEM })

/** 提交：占位头换成按「路径 + 载荷」稳定的键（刷新 / 重试复用），成功后丢弃 */
async function llPost<T>(url: string, data: unknown, headers: any) {
  const h = resolveIdem(url, data, headers)
  const r = await post<T>(url, data, h, 60000)
  idemDone(url, data)
  return r
}

// ---------------- 使用约定 ----------------

export function llGetAgreement() {
  return get<types.ILAgreement>(`${PREFIX}/agreements/aigc`)
}

export function llAcceptAgreement() {
  return post<types.ILAgreement>(`${PREFIX}/agreements/aigc/accept`, {})
}

// ---------------- 店铺档案 ----------------

export function llShopProfileList(params: { page?: number; pageSize?: number } = {}) {
  return get<types.ILShopProfileList>(`${PREFIX}/shop-profiles`, { page: 1, pageSize: 50, ...params })
}

export function llShopProfileCreate(data: types.ILShopProfileForm) {
  return post<types.ILShopProfile>(`${PREFIX}/shop-profiles`, data)
}

export function llShopProfileGet(id: number) {
  return get<types.ILShopProfile>(`${PREFIX}/shop-profiles/${id}`)
}

export function llShopProfileSave(id: number, data: types.ILShopProfileForm) {
  return put<types.ILShopProfile>(`${PREFIX}/shop-profiles/${id}`, data)
}

export function llShopProfileRemove(id: number) {
  return del(`${PREFIX}/shop-profiles/${id}`)
}

// ---------------- AI文案 ----------------

export function llCopywritingOptions() {
  return get<types.ILCopywritingOptions>(`${PREFIX}/copywriting/options`)
}

/** AI帮写（同步，几秒返回） */
export function llCopywritingAiWrite(data: types.ILAiWriteReq) {
  return post<{ text: string }>(`${PREFIX}/copywriting/ai-write`, data, undefined, 60000)
}

/** AI帮写或爆款仿写：提交生成（异步，轮询详情） */
export function llCopywritingGenerate(data: types.ILCopywritingGenerateReq, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILCopywriting>(`${PREFIX}/copywriting/generate`, data, headers)
}

export function llCopywritingRegenerate(id: number, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILCopywriting>(`${PREFIX}/copywriting/${id}/regenerate`, {}, headers)
}

/** 自主撰写：直接保存 */
export function llCopywritingSave(data: { title?: string; body: string }) {
  return post<types.ILCopywriting>(`${PREFIX}/copywriting`, data)
}

export function llCopywritingList(params: types.ILCopywritingListReq = {}) {
  return get<types.ILCopywritingList>(`${PREFIX}/copywriting`, { status: -1, page: 1, pageSize: 20, ...params })
}

/** 文案详情（生成中轮询这个） */
export function llCopywritingDetail(id: number) {
  return get<types.ILCopywriting>(`${PREFIX}/copywriting/${id}`)
}

export function llCopywritingPut(id: number, data: { title?: string; body: string }) {
  return put<types.ILCopywriting>(`${PREFIX}/copywriting/${id}`, data)
}

export function llCopywritingRemove(id: number) {
  return del(`${PREFIX}/copywriting/${id}`)
}

/** 生成历史：这条文案被拿去生成过哪些成品（只返回已完成的） */
export function llCopywritingDerivatives(id: number, params: { kind?: string; page?: number; pageSize?: number } = {}) {
  return get<types.ILDerivativesList>(`${PREFIX}/copywriting/${id}/derivatives`, { page: 1, pageSize: 50, ...params })
}

// ---------------- AI数字人 ----------------

export function llPublicDigitalHumans() {
  return get<{ list: types.ILPublicDigitalHuman[] }>(`${PREFIX}/digital-humans/public`)
}

export function llDhOptions() {
  return get<types.ILDhOptions>(`${PREFIX}/digital-humans/options`)
}

/** AI 定制形象：提交生成（出 4 张 9:16 图，轮询 llPortraitDetail） */
export function llCreatePortrait(data: types.ILCreatePortraitReq, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILPortrait>(`${PREFIX}/digital-humans/portraits`, data, headers)
}

export function llPortraitDetail(id: number) {
  return get<types.ILPortrait>(`${PREFIX}/digital-humans/portraits/${id}`)
}

export function llRegeneratePortrait(id: number, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILPortrait>(`${PREFIX}/digital-humans/portraits/${id}/regenerate`, {}, headers)
}

export function llVoiceCategories() {
  return get<{ list: types.ILLOption[] }>(`${PREFIX}/voices/categories`)
}

export function llVoices(category?: string) {
  return get<{ list: types.ILVoice[] }>(`${PREFIX}/voices`, { category })
}

export function llCreateDigitalHuman(data: types.ILCreateDigitalHumanReq, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILDigitalHuman>(`${PREFIX}/digital-humans`, data, headers)
}

export function llDigitalHumanList(params: { status?: number; page?: number; pageSize?: number } = {}) {
  return get<types.ILDigitalHumanList>(`${PREFIX}/digital-humans`, { status: -1, page: 1, pageSize: 20, ...params })
}

/** 数字人详情（生成中轮询这个） */
export function llDigitalHumanDetail(id: number) {
  return get<types.ILDigitalHuman>(`${PREFIX}/digital-humans/${id}`)
}

export function llDigitalHumanRemove(id: number) {
  return del(`${PREFIX}/digital-humans/${id}`)
}

// ---------------- AI图文笔记 ----------------

export function llNoteOptions() {
  return get<types.ILNoteOptions>(`${PREFIX}/notes/options`)
}

export function llNotePlan(data: types.ILPlanNoteReq, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILNote>(`${PREFIX}/notes/plan`, data, headers)
}

/** 笔记详情（构思中 / 生成中都轮询这个） */
export function llNoteDetail(id: number) {
  return get<types.ILNote>(`${PREFIX}/notes/${id}`)
}

/** 重新构思（可换套图数量） */
export function llNoteReplan(id: number, imageCount?: number, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILNote>(
    `${PREFIX}/notes/${id}/replan`,
    imageCount != null ? { imageCount: imageCount } : {},
    headers,
  )
}

/** 确认生成；生成失败后再调一次即重试 */
export function llNoteGenerate(
  id: number,
  data: { title?: string; content?: string; tags?: string[]; imageCount?: number },
  headers: any = llIdempotencyHeaders(),
) {
  return llPost<types.ILNote>(`${PREFIX}/notes/${id}/generate`, data, headers)
}

export function llNoteList(params: { status?: number; page?: number; pageSize?: number } = {}) {
  return get<types.ILNoteList>(`${PREFIX}/notes`, { status: -1, page: 1, pageSize: 20, ...params })
}

/** 编辑笔记：标题、正文、话题、图片（整组提交，保留原图 + 新增直传图） */
export function llNoteUpdate(
  id: number,
  data: { title: string; content: string; tags?: string[]; imageUrls: string[] },
) {
  return put<types.ILNote>(`${PREFIX}/notes/${id}`, data)
}

export function llNoteRemove(id: number) {
  return del(`${PREFIX}/notes/${id}`)
}

// ---------------- 海报 / 长图 / 动作迁移 / 数字人口播 ----------------

export function llCreationOptions(kind: types.ILCreationKind) {
  return get<types.ILCreationOptions>(`${PREFIX}/creations/options`, { kind })
}

/** 模板列表（海报可按类型筛；kind=voiceover 返回预设背景） */
export function llCreationTemplates(kind: types.ILCreationKind, posterType?: string) {
  return get<{ list: types.ILCreationTemplate[] }>(`${PREFIX}/creations/templates`, {
    kind,
    ...(posterType ? { posterType: posterType } : {}),
  })
}

export function llCreationSubmit(data: types.ILCreateCreationReq, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILCreation>(`${PREFIX}/creations`, data, headers)
}

export function llCreationList(
  kind: types.ILCreationKind | '',
  params: { status?: number; page?: number; pageSize?: number } = {},
) {
  return get<types.ILCreationList>(`${PREFIX}/creations`, { kind, status: -1, page: 1, pageSize: 20, ...params })
}

/** 生成中轮询这个 */
export function llCreationDetail(id: number) {
  return get<types.ILCreation>(`${PREFIX}/creations/${id}`)
}

export function llCreationRemove(id: number) {
  return del(`${PREFIX}/creations/${id}`)
}

export function llActionVideos() {
  return get<{ presets: types.ILActionVideo[]; mine: types.ILActionVideo[] }>(`${PREFIX}/action-videos`)
}

/** 导入动作视频（前端直传后回传地址），自动命名「我的动作N」 */
export function llActionVideoImport(data: { url: string; coverUrl?: string; name?: string }) {
  return post<types.ILActionVideo>(`${PREFIX}/action-videos`, data)
}

export function llActionVideoRemove(id: number) {
  return del(`${PREFIX}/action-videos/${id}`)
}

// ---------------- 探店视频 / 带货短剧 / 爆款视频复刻 ----------------

export function llVideoOptions(kind: types.ILVideoKind) {
  return get<types.ILVideoOptions>(`${PREFIX}/video-creations/options`, { kind })
}

export function llVideoCreate(data: types.ILCreateVideoReq, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILVideoCreation>(`${PREFIX}/video-creations`, data, headers)
}

/** 详情（构思中、生成中都轮询这个） */
export function llVideoDetail(id: number) {
  return get<types.ILVideoCreation>(`${PREFIX}/video-creations/${id}`)
}

export function llVideoReplan(id: number, headers: any = llIdempotencyHeaders()) {
  return llPost<types.ILVideoCreation>(`${PREFIX}/video-creations/${id}/replan`, {}, headers)
}

/** 确认剧本开始出片；复刻可带改过的 prompt/model/size */
export function llVideoGenerate(
  id: number,
  data: types.ILGenerateVideoReq = {},
  headers: any = llIdempotencyHeaders(),
) {
  return llPost<types.ILVideoCreation>(`${PREFIX}/video-creations/${id}/generate`, data, headers)
}

export function llVideoList(
  kind: types.ILVideoKind | '',
  params: { status?: number; page?: number; pageSize?: number } = {},
) {
  return get<types.ILVideoCreationList>(`${PREFIX}/video-creations`, {
    kind,
    status: -1,
    page: 1,
    pageSize: 20,
    ...params,
  })
}

export function llVideoRemove(id: number) {
  return del(`${PREFIX}/video-creations/${id}`)
}
