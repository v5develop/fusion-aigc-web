/**
 * 资产库增强（Go 网关 /api/v1/asset-library）接口封装。
 *
 * <p>对 Java 素材库（/api/v1/asset）的增强视图：分类条计数、资产级收藏、标签字典、
 * 版本、相关资产与详情。字段与 app/gateway/api/gateway.api 的 assetlib 组逐字段对应；
 * 前端字段一律 camelCase（Java 原生 camelCase；Go 网关请求体 / query / 响应均兼容 camelCase）；时间均为 unix 毫秒。
 *
 * <p>复用 api/index.ts 的实例（token 注入、401 刷新、业务错误 toast 全部沿用）。
 */
import { post, put, patch, get, del } from './index.ts'

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
  runId: string
  workflowId: string
  nodeId: string
  operator: string
  model: string
  /** JSON 文本；空=没有 */
  params: string
  createdAt: number
}

/** 资产版本。version_no 同资产从 1 起 */
export interface IAssetLibVersion {
  id: number
  versionNo: number
  image: string
  prompt: string
  model: string
  /** JSON 文本 */
  params: string
  createdAt: number
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
  videoUrl: string
  /** upload / generated / official */
  source: string
  /** 标签名数组，没有为 [] */
  tags: string[]
  createdAt: number
  favorite: boolean
  /** cleared / internal / unknown；空 = 未设置 */
  license: string
  metadata: IAssetLibMetadata
  provenance: IAssetLibProvenance
  /** 仅详情带（当前页），列表里为 [] */
  versions: IAssetLibVersion[]
  /** 0 = 原图 */
  currentVersionId: number
  /** 仅详情带（相关资产当前页 id） */
  relatedIds: number[]
  entryCode: string
  width: number
  height: number
}

/** 列表大类筛选 */
export type AssetLibKindGroup = 'image' | 'video'

export interface IAssetLibListParams {
  /** 空 = 全部；uncategorized = 未分类；或 5 个 kind 之一；或视频二级分类键（VIDEO_KINDS） */
  kind?: string
  /** 大类：image = 5 个图片 kind；video = 视频二级分类键。与 kind 同传时同时生效 */
  kindGroup?: AssetLibKindGroup
  /** 空 = 全部；input = official + upload */
  source?: string
  /** 空 = 全部；image / video */
  media?: string
  /** 比例 宽:高，如 1:1 / 3:4 / 9:16，精确匹配 */
  aspectRatio?: string
  /** 入口码，逗号分隔（每项 [A-Za-z0-9_.-]{1,64}，≤200 个），按 entry_code IN (...)；分类树节点的 entryCodes */
  entryCodes?: string
  /** 标签名（精确匹配） */
  tag?: string
  /** true = 只要没挂任何标签的素材（「未分类」，口径同 GET /tags 的 untagged_count）；不能与 tag 同传 */
  untagged?: boolean
  favoriteOnly?: boolean
  /** 标题 / 提示词模糊，≤100 字 */
  q?: string
  page?: number
  /** 上限 100 */
  pageSize?: number
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
  versionPage?: number
  relatedPage?: number
  resultPage?: number
  /** 三组子列表共用，默认 6，上限 50 */
  pageSize?: number
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
  generatedResults: IAssetLibAssetPage
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
  currentVersionId?: number
  /** cleared / internal / unknown；空串 = 清除 */
  license?: string
}

export interface IAssetLibTag {
  id: number
  name: string
  assetCount: number
  createdAt: number
}

export interface IAssetLibTagListResp {
  items: IAssetLibTag[]
  /** 当前用户没挂任何标签的素材数（「未分类」的计数） */
  untaggedCount?: number | null
}

export interface IAssetLibBatchTagResp {
  /** 新增的关联条数 */
  added: number
}

/** 删除结果（单删 / 批量同形） */
export interface IAssetLibDeleteResp {
  /** 实际删除条数 */
  deleted: number
  /** 官方素材，未删除 */
  officialSkipped: number
  /** 不存在 / 不属于本人 / 已删除，跳过 */
  missing: number
  /** 已删除的资产 id */
  deletedIds: number[]
}

/** 「存为资产」请求（POST /assets/from-url） */
export interface IAssetLibFromUrlReq {
  /** 本人上传的图片地址，或本人资产库里已有的图片地址；别人的 / 外链 / mr:// 后端拒收（1003） */
  url: string
  /** 1-100 字；缺省「画布图片」 */
  title?: string
  /** 目前只有 canvas */
  source?: 'canvas'
  /** 来源画布 / 节点，写进资产溯源 */
  canvasId?: string
  nodeId?: string
  /** 标签名，≤10 个 */
  tags?: string[]
}

export interface IAssetLibFromUrlResp {
  /** 新建的 / 已存在的资产（image 是素材库公开地址） */
  asset: IAssetLibAsset
  /** true = 已在资产库里（重复点击 / 已入库），没有新建 */
  existing: boolean
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

/** 详情：版本 / 相关资产 / 生成结果三组子列表各自分页，共用 pageSize（默认 6） */
export function assetLibDetail(id: number, params: IAssetLibDetailParams = {}) {
  return get<IAssetLibDetail>(`${PREFIX}/assets/${id}`, { pageSize: 6, ...params })
}

/** 改标题 / 分类 / 收藏 / 标签 / 元数据 / 授权 / 当前版本（只改带了的字段），返回改后的完整资产 */
export function assetLibUpdate(id: number, data: IAssetLibUpdateReq) {
  return patch<IAssetLibAsset>(`${PREFIX}/assets/${id}`, data)
}

/**
 * 把自己的一张图存为资产（画布「存为资产」）。后端按「本人 + 内容 sha256」幂等：重复点击返回已有资产（existing=true）。
 * 业务失败（1003 来源无法确认 / 不是图片 / 超 10MB，4002 同一张图正在保存，5001 繁忙）由全局拦截器 toast 后端原话，
 * 调用方不要再叠一条（网络失败 isNetwork 才需要自己提示）。
 */
export function assetLibCreateFromUrl(data: IAssetLibFromUrlReq) {
  return post<IAssetLibFromUrlResp>(`${PREFIX}/assets/from-url`, data)
}

/** 追加版本（版本号自增），并设为当前版本。image_url 须为 Go 签发的地址（goUploadImage） */
export function assetLibAddVersion(
  id: number,
  data: { imageUrl: string; prompt?: string; model?: string; params?: string },
) {
  return post<IAssetLibVersion>(`${PREFIX}/assets/${id}/versions`, data)
}

/** 建立资产关系（reference：两个方向都算相关资产） */
export function assetLibAddRelation(id: number, relatedAssetId: number, relationType = 'reference') {
  return post(`${PREFIX}/assets/${id}/relations`, { relatedAssetId: relatedAssetId, relationType: relationType })
}

/** 删除资产关系（reference 两个方向都删） */
export function assetLibRemoveRelation(id: number, relatedAssetId: number, relationType = 'reference') {
  return del(`${PREFIX}/assets/${id}/relations`, { relatedAssetId: relatedAssetId, relationType: relationType })
}

/**
 * 删除单个资产（逻辑删除，同时解除标签；不删存储对象、不影响任务结果）。
 * 不存在 / 不属于本人 4001；官方素材 2005「官方素材不可删除」。
 */
export function assetLibDelete(id: number) {
  return del<IAssetLibDeleteResp>(`${PREFIX}/assets/${id}`)
}

/**
 * 批量删除资产（≤100）。只删本人的上传 / 生成资产：官方素材与不存在的 id 静默跳过，
 * 分别计入 official_skipped / missing（不算错误）。
 */
export function assetLibBatchDelete(assetIds: number[]) {
  return post<IAssetLibDeleteResp>(`${PREFIX}/assets/batch-delete`, { assetIds: assetIds })
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
export function assetLibBatchTag(data: { assetIds: number[]; tagIds: number[] }) {
  return post<IAssetLibBatchTagResp>(`${PREFIX}/assets/batch-tag`, data)
}
