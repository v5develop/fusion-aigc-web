/**
 * 提示词库（Go 网关 /api/v1/prompt-library）接口封装。
 *
 * <p>与 Java 接口共用同一个域名与令牌（网关按前缀转发给 Go），复用 api/index.ts
 * 的实例：token 注入、401 刷新、业务错误 toast 全部沿用。
 *
 * <p>类型与字段对齐 fusion_aigc_go gateway.api 的 promptlib 段；前端字段一律 camelCase（Java 原生 camelCase；Go 网关请求体 / query / 响应均兼容 camelCase）。
 */
import { post, put, get, del } from './index.ts'

const PREFIX = '/api/v1/prompt-library'

/** 提示词条目。官方（owner=official）只读，我的（owner=mine）可编辑删除 */
export interface IPromptLibItem {
  id: number
  title: string
  prompt: string
  /** ecommerce / general / mine */
  vertical: string
  /** 二级分类英文 key（我的提示词固定 mine / favorite） */
  group: string
  /** 适用模型：通用 / GPT / Banana / Seedream */
  models: string[]
  tags: string[]
  source: string
  /** official / mine */
  owner: string
  createdAt: number
  updatedAt: number
}

export interface IPromptLibList {
  items: IPromptLibItem[]
  total: number
}

export interface IPromptLibListReq {
  /** '' / ecommerce / general / mine */
  vertical?: string
  group?: string
  model?: string
  q?: string
  page?: number
  pageSize?: number
}

/** 新增 / 修改我的提示词。title ≤100 字、prompt ≤3000 字、models ≤10（缺省 ["通用"]）、tags ≤10 */
export interface IPromptLibUpsertReq {
  title: string
  prompt: string
  models?: string[]
  tags?: string[]
  group?: string
}

/** 提示词列表：官方（启用）+ 我的 */
export function promptLibList(params: IPromptLibListReq = {}) {
  return get<IPromptLibList>(`${PREFIX}/prompts`, { page: 1, pageSize: 20, ...params })
}

/** 新增我的提示词（每人 ≤500 条） */
export function promptLibCreate(data: IPromptLibUpsertReq) {
  return post<IPromptLibItem>(`${PREFIX}/prompts`, data)
}

/** 修改我的提示词（官方项 code=4002，界面只对 mine 放出入口） */
export function promptLibUpdate(id: number, data: IPromptLibUpsertReq) {
  return put<IPromptLibItem>(`${PREFIX}/prompts/${id}`, data)
}

/** 删除我的提示词（官方项 code=4002，界面只对 mine 放出入口） */
export function promptLibRemove(id: number) {
  return del(`${PREFIX}/prompts/${id}`)
}
