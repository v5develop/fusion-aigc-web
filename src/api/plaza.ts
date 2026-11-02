/**
 * 创意广场接口封装（Java，均为免登录 GET；带了 token 由请求层照常附上）。
 *
 * <p>模板广场：/api/v1/plaza-templates/*（CreaftV1SupportController，v1 兼容口，分页信封
 * {current, pages, total, data}）。素材广场：/api/v1/asset/public/display*（AssetController 推荐流，
 * 信封 {list, total, page, pageSize}）。
 */
import { get } from './index.ts'
import type { IDisplayCategory, IFeedItem } from './types'

// ---------------- 模板广场 ----------------

/** 模板 payload：后端已摘掉顶层 prompt 与 agentSkillId / v1PlazaTemplateId 元数据键，其余键照 v1 原样下发 */
export interface IPlazaTemplatePayload {
  /** 效果图（种子数据为 webp 地址数组） */
  result?: string[]
  image_urls?: string[]
  description?: string
  guidance?: string
  [key: string]: unknown
}

export interface IPlazaTemplate {
  plazaTemplateId: number
  title: string
  /** JSON 字符串下发（雪花 id 超出 JS 安全整数）；可能为 null */
  agentSkillId: string | null
  tags: string[]
  payload: IPlazaTemplatePayload
}

/** v1 兼容分页信封 */
export interface IPlazaPage<T> {
  current: number
  pages: number
  total: number
  data: T[]
}

export interface IPlazaTemplateListParams {
  /** 从 1 开始 */
  page: number
  size: number
  /**
   * 标签过滤，后端可重复传、多个取并集。这里只传单个：axios 默认把数组序列化成 tags[]=…，
   * Spring 的 @RequestParam List<String> tags 认不到。
   */
  tags?: string
}

export function plazaTemplateList(params: IPlazaTemplateListParams) {
  return get<IPlazaPage<IPlazaTemplate>>('/api/v1/plaza-templates/list', params)
}

/** 去重排序后的标签数组（后端只扫前 1000 条模板） */
export function plazaTemplateTags() {
  return get<string[]>('/api/v1/plaza-templates/tags')
}

// ---------------- 素材广场 ----------------

export interface IPublicDisplayPage {
  /** 源失效的条目会被剔除，本页条数可能小于 pageSize */
  list: IFeedItem[]
  total: number
  page: number
  pageSize: number
}

export interface IPublicDisplayParams {
  platform: 'APP' | 'PC'
  categoryL1Id?: number
  categoryL2Id?: number
  page: number
  pageSize: number
}

export function publicDisplayFeed(params: IPublicDisplayParams) {
  return get<IPublicDisplayPage>('/api/v1/asset/public/display', params)
}

/** 两级分类树：顶层为一级，children 为二级（可能为空） */
export function publicDisplayCategories(platform: 'APP' | 'PC') {
  return get<IDisplayCategory[]>('/api/v1/asset/public/display/categories', { platform })
}
