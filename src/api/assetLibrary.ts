/**
 * 资产库增强（Go 网关 /api/v1/asset-library）接口封装。
 *
 * <p>对 Java 素材库（/api/v1/asset）的增强视图：分类条计数、资产级收藏、标签字典、
 * 版本、相关资产与详情。字段与 app/gateway/api/gateway.api 的 assetlib 组逐字段对应，
 * snake_case 原样收发；时间均为 unix 毫秒。
 *
 * <p>复用 api/index.ts 的实例（token 注入、401 刷新、业务错误 toast 全部沿用）。
 */
import { get, post, put, del, patch } from './index.ts'

const PREFIX = '/api/v1/asset-library'

// ---------------- 类型（照抄 gateway.api assetlib 组） ----------------

/** 元数据。PATCH 时整体替换，缺省子字段视为空 */
export interface IAssetLibMetadata {
  industry?: string // 行业
  style?: string // 风格
  shot?: string // 镜头
  color?: string // 色彩
}

/** 溯源信息。AI 生成但没写过溯源的，run_id 填来源任务号 */
export interface IAssetLibProvenance {
  run_id: string
  workflow_id: string
  node_id: string
  operator: string
  model: string
  /** JSON 文本；空=没有 */
  params: string
  created_at: number
}

/** 资产版本。version_no 同资产从 1 起 */
export interface IAssetLibVersion {
  id: number
  version_no: number
  image: string
  prompt: string
  model: string
  /** JSON 文本 */
  params: string
  created_at: number
}

/** 资产。kind 空串 = 未分类；license 空串 = 未设置 */
export interface IAssetLibAsset {
  id: number
  /** model / scene / makeup / hair / accessory；空 = 未分类 */
  kind: string
  title: string
  prompt: string
  /** 当前版本图 > 原图（视频为封面） */
  image: string
  /** image / video */
  media: string
  video_url: string
  /** upload / generated / official */
  source: string
  /** 标签名数组，没有为 [] */
  tags: string[]
  created_at: number
  favorite: boolean
  /** cleared / internal / unknown；空 = 未设置 */
  license: string
  metadata: IAssetLibMetadata
  provenance: IAssetLibProvenance
  /** 仅详情带（当前页），列表里为 [] */
  versions: IAssetLibVersion[]
  /** 0 = 原图 */
  current_version_id: number
  /** 仅详情带（相关资产当前页 id） */
  related_ids: number[]
  entry_code: string
  width: number
  height: number
}

/** 列表大类筛选 */
export type AssetLibKindGroup = 'image' | 'video'

export interface IAssetLibListParams {
  /** 空 = 全部；uncategorized = 未分类；或 5 个 kind 之一；或视频二级分类键（VIDEO_KINDS） */
  kind?: string
  /** 大类：image = 5 个图片 kind；video = 视频二级分类键。与 kind 同传时同时生效 */
  kind_group?: AssetLibKindGroup
  /** 空 = 全部；input = official + upload */
  source?: string
  /** 空 = 全部；image / video */
  media?: string
  /** 比例 宽:高，如 1:1 / 3:4 / 9:16，精确匹配 */
  aspect_ratio?: string
  /** 入口码，逗号分隔（每项 [A-Za-z0-9_.-]{1,64}，≤200 个），按 entry_code IN (...)；分类树节点的 entryCodes */
  entry_codes?: string
  /** 标签名（精确匹配） */
  tag?: string
  favorite_only?: boolean
  /** 标题 / 提示词模糊，≤100 字 */
  q?: string
  page?: number
  /** 上限 100 */
  page_size?: number
}

export interface IAssetLibListResp {
  items: IAssetLibAsset[]
  total: number
}

export interface IAssetLibCategory {
  /** all / model / scene / makeup / hair / accessory / uncategorized */
  key: string
  label: string
  count: number
}

export interface IAssetLibCategoriesResp {
  items: IAssetLibCategory[]
}

/** 分类树节点的创作入口（仅二级有） */
export interface IAssetCategoryEntry {
  entryCode: string
  /** 展示名；查不到时等于 entryCode */
  entryName: string
}

/**
 * Java 素材库聚合分类（GET /api/v1/asset/categories，AssetCategoryRespVO）。
 * 一级是 tab，children 为二级 chip（二级的 children 恒为 []）。
 * 二级里编码以 __other 结尾的「其他」是后端合成的虚拟分类，id 为 null：渲染 key 用 categoryCode。
 */
export interface IAssetCategoryNode {
  /** 虚拟「其他」恒为 null */
  id: number | null
  categoryCode: string
  categoryName: string
  sortOrder: number | null
  /** 成员入口码；一级 = 各二级之并 ∪ 未归类兜底 */
  entryCodes: string[] | null
  /** 按素材类型分组的节点：二级的 kind（模特 / 场景 / 妆容 / 发型 / 配饰）；一级（创作素材）的 kindGroup = image */
  kind?: string | null
  kindGroup?: AssetLibKindGroup | null
  children: IAssetCategoryNode[] | null
  /** 当前用户在该分类下的素材数（一级按并集去重）；取不到当前用户时为 null */
  count: number | null
  /** 入口及展示名（仅二级有，一级为 []） */
  entries: IAssetCategoryEntry[] | null
}

export interface IAssetLibDetailParams {
  version_page?: number
  related_page?: number
  result_page?: number
  /** 三组子列表共用，默认 6，上限 50 */
  page_size?: number
}

export interface IAssetLibAssetPage {
  items: IAssetLibAsset[]
  total: number
}

export interface IAssetLibVersionPage {
  items: IAssetLibVersion[]
  total: number
}

export interface IAssetLibDetail {
  asset: IAssetLibAsset
  versions: IAssetLibVersionPage
  /** reference（双向）+ 本资产的生成来源 */
  related: IAssetLibAssetPage
  /** 由本资产生成的资产 */
  generated_results: IAssetLibAssetPage
}

/** PATCH /assets/:id 请求体。服务端只改带了的字段（undefined 不发），整组替换的见各字段注释 */
export interface IAssetLibUpdateReq {
  /** ≤100 字 */
  title?: string
  /** 5 个 kind 之一；空串 = 改回未分类 */
  kind?: string
  favorite?: boolean
  /** 标签名数组，整组替换（[] 清空）；字典里没有的自动建，≤10 个 */
  tags?: string[]
  /** 整体替换，没带的子字段视为空 */
  metadata?: IAssetLibMetadata
  /** 某个版本 id；0 = 回到原图 */
  current_version_id?: number
  /** cleared / internal / unknown；空串 = 清除 */
  license?: string
}

export interface IAssetLibTag {
  id: number
  name: string
  asset_count: number
  created_at: number
}

export interface IAssetLibTagListResp {
  items: IAssetLibTag[]
  /** 当前用户没挂任何标签的素材数（「未分类」的计数） */
  untagged_count?: number | null
}

export interface IAssetLibBatchTagResp {
  /** 新增的关联条数 */
  added: number
}

// ---------------- 资产 ----------------

export function assetLibList(params: IAssetLibListParams) {
  return get<IAssetLibListResp>(`${PREFIX}/assets`, params)
}

/** 分类条计数：固定返回 all + 5 kind + uncategorized，计数随 source / media 变化 */
export function assetLibCategories(params: { source?: string; media?: string } = {}) {
  return get<IAssetLibCategoriesResp>(`${PREFIX}/assets/categories`, params)
}

/** 我的资产分类树（Java 素材库接口，同一请求实例带用户 token） */
export function assetCategoryTree() {
  return get<IAssetCategoryNode[]>('/api/v1/asset/categories')
}

/** 详情：版本 / 相关资产 / 生成结果三组子列表各自分页，共用 page_size（默认 6） */
export function assetLibDetail(id: number, params: IAssetLibDetailParams = {}) {
  return get<IAssetLibDetail>(`${PREFIX}/assets/${id}`, { page_size: 6, ...params })
}

/** 改标题 / 分类 / 收藏 / 标签 / 元数据 / 授权 / 当前版本（只改带了的字段），返回改后的完整资产 */
export function assetLibUpdate(id: number, data: IAssetLibUpdateReq) {
  return patch<IAssetLibAsset>(`${PREFIX}/assets/${id}`, data)
}

/** 追加版本（版本号自增），并设为当前版本。image_url 须为 Go 签发的地址（goUploadImage） */
export function assetLibAddVersion(
  id: number,
  data: { image_url: string; prompt?: string; model?: string; params?: string },
) {
  return post<IAssetLibVersion>(`${PREFIX}/assets/${id}/versions`, data)
}

/** 建立资产关系（reference：两个方向都算相关资产） */
export function assetLibAddRelation(id: number, relatedAssetId: number, relationType = 'reference') {
  return post(`${PREFIX}/assets/${id}/relations`, { related_asset_id: relatedAssetId, relation_type: relationType })
}

/** 删除资产关系（reference 两个方向都删） */
export function assetLibRemoveRelation(id: number, relatedAssetId: number, relationType = 'reference') {
  return del(`${PREFIX}/assets/${id}/relations`, { related_asset_id: relatedAssetId, relation_type: relationType })
}

// ---------------- 标签 ----------------

/** 我的标签字典（含每个标签的资产数），按名字排序 */
export function assetLibTags() {
  return get<IAssetLibTagListResp>(`${PREFIX}/tags`)
}

/** 新建标签（≤20 字，每用户 ≤200 个）。重名 4002 */
export function assetLibTagCreate(name: string) {
  return post<IAssetLibTag>(`${PREFIX}/tags`, { name })
}

/** 重命名标签，资产上的标签名随之变化 */
export function assetLibTagRename(id: number, name: string) {
  return put<IAssetLibTag>(`${PREFIX}/tags/${id}`, { name })
}

/** 删除标签，同时从所有资产上摘掉 */
export function assetLibTagDelete(id: number) {
  return del(`${PREFIX}/tags/${id}`)
}

/** 批量给资产加标签（追加，已有的跳过）。一次 ≤100 资产、≤10 标签，返回新增关联数 */
export function assetLibBatchTag(data: { asset_ids: number[]; tag_ids: number[] }) {
  return post<IAssetLibBatchTagResp>(`${PREFIX}/assets/batch-tag`, data)
}
