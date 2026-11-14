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
import { isMock } from './mock-switch.ts'

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
  /** kind 的来源：auto = 系统推算的默认分类，user = 用户改过；老后端不给 = 缺省 */
  kindSource?: 'auto' | 'user'
  /** 系统标签（只读，后端打的）；没有为 [] / 缺省 */
  sysTags?: string[]
}

/**
 * 资产分类 kind：value 以后端为准，label 只是展示名（后端新增取值时前端原样展示 value，不报错）。
 * group 对应 kind_group：image = 图片类，video = 视频类，用来在筛选条里分组展示。
 */
export const ASSET_KINDS = [
  { value: 'model', label: '模特', group: 'image' },
  { value: 'scene', label: '场景', group: 'image' },
  { value: 'makeup', label: '妆容', group: 'image' },
  { value: 'hair', label: '发型', group: 'image' },
  { value: 'accessory', label: '配饰', group: 'image' },
  { value: 'product', label: '商品', group: 'marketing' },
  { value: 'storefront', label: '门头门店', group: 'marketing' },
  { value: 'dish', label: '菜品', group: 'marketing' },
  { value: 'logo', label: 'Logo', group: 'marketing' },
  { value: 'poster', label: '海报', group: 'marketing' },
  { value: 'reference', label: '参考图', group: 'marketing' },
  { value: 'other', label: '其他', group: 'marketing' },
  { value: 'video_final', label: '成片', group: 'video' },
  { value: 'video_segment', label: '视频片段', group: 'video' },
] as const

/** kind_group 的中文名：image = 商拍，marketing = 营销素材，video = 视频 */
export const ASSET_KIND_GROUPS = [
  { key: 'image', label: '商拍' },
  { key: 'marketing', label: '营销素材' },
  { key: 'video', label: '视频' },
] as const

export function kindLabelOf(v: string | undefined | null): string {
  if (!v) return ''
  return ASSET_KINDS.find((u) => u.value === v)?.label ?? v
}

/** 列表大类筛选 */
export type AssetLibKindGroup = 'image' | 'marketing' | 'video'

export interface IAssetLibListParams {
  /** 空 = 全部；uncategorized = 未分类；或 ASSET_KINDS 里的 kind；或视频二级分类键（VIDEO_KINDS） */
  kind?: string
  /** 大类：image = 商拍，marketing = 营销素材，video = 视频（成员见 ASSET_KINDS）。与 kind 同传时同时生效；不要再传旧的视频二级键（viral_video 等，会 1003） */
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
  /** 多个用户标签，逗号分隔，须全部包含（单个时用 tag） */
  tags?: string
  /** 系统标签，逗号分隔，须全部包含 */
  sysTags?: string
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
  /** 所属大类 image / marketing / video；all、uncategorized 为空 */
  group?: string
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
  /** ASSET_KINDS 里的 kind；空串 = 改回未分类（kindSource 随之变 user） */
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

export interface IAssetLibSysTag {
  name: string
  assetCount: number
}

export interface IAssetLibTagListResp {
  items: IAssetLibTag[]
  /** 当前用户没挂任何标签的素材数（「未分类」的计数） */
  untaggedCount?: number | null
}

export interface IAssetLibBatchTagResp {
  /** 新增的关联条数 */
  added: number
  /** 移除的关联条数 */
  removed?: number
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

export async function assetLibList(params: IAssetLibListParams) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockList(params)
  return get<IAssetLibListResp>(`${PREFIX}/assets`, params)
}

/** 分类条计数：固定返回 all + 5 kind + uncategorized，计数随 source / media 变化 */
export async function assetLibCategories(params: { source?: string; media?: string } = {}) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockCategories(params)
  return get<IAssetLibCategoriesResp>(`${PREFIX}/assets/categories`, params)
}

/** 我的资产分类树（Java 素材库接口，同一请求实例带用户 token） */
export async function assetCategoryTree() {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockTree()
  return get<IAssetCategoryNode[]>('/api/v1/asset/categories')
}

/** 详情：版本 / 相关资产 / 生成结果三组子列表各自分页，共用 pageSize（默认 6） */
export function assetLibDetail(id: number, params: IAssetLibDetailParams = {}) {
  return get<IAssetLibDetail>(`${PREFIX}/assets/${id}`, { pageSize: 6, ...params })
}

/** 改标题 / 分类 / 收藏 / 标签 / 元数据 / 授权 / 当前版本（只改带了的字段），返回改后的完整资产 */
export async function assetLibUpdate(id: number, data: IAssetLibUpdateReq) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockUpdate(id, data)
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
export async function assetLibTags(sort: 'count' | 'name' = 'count') {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockTags(sort)
  return get<IAssetLibTagListResp>(`${PREFIX}/tags`, { sort })
}

/** 系统标签字典（只读）：本人资产里出现过的系统标签及资产数，按数量倒序；点选后作为列表 sysTags 传 */
export async function assetLibSysTags() {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockSysTags()
  return get<{ items: IAssetLibSysTag[] }>(`${PREFIX}/sys-tags`)
}

/** 新建标签（≤20 字，每用户 ≤200 个）。重名 4002 */
export async function assetLibTagCreate(name: string) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockTagCreate(name)
  return post<IAssetLibTag>(`${PREFIX}/tags`, { name })
}

/** 重命名标签，资产上的标签名随之变化 */
export async function assetLibTagRename(id: number, name: string) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockTagRename(id, name)
  return put<IAssetLibTag>(`${PREFIX}/tags/${id}`, { name })
}

/** 删除标签，同时从所有资产上摘掉 */
export async function assetLibTagDelete(id: number) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockTagDelete(id)
  return del(`${PREFIX}/tags/${id}`)
}

/**
 * 批量追加（tagIds）/ 移除（removeTagIds）标签，至少给一个，同一事务先移后加。
 * 一次 ≤200 资产、追加与移除各 ≤20 标签；任一资产追加后超 20 个标签 1003，整批不生效。
 */
export async function assetLibBatchTag(data: { assetIds: number[]; tagIds?: number[]; removeTagIds?: number[] }) {
  if (isMock('asset')) return (await import('./asset-mock.ts')).mockBatchTag(data)
  return post<IAssetLibBatchTagResp>(`${PREFIX}/assets/batch-tag`, data)
}
