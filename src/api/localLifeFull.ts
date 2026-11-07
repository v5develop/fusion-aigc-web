/**
 * 本地生活 · 全案设计（/local-life 入口页）接口：Java Creaft v1 兼容路由。
 *
 * <p>契约以 Java 为准（fusion-aigc 仓库）：
 * <ul>
 *   <li>品牌档案 / 模板：controller/compat/v1/support/CreaftV1SupportController；</li>
 *   <li>全案提交与续跑：controller/compat/v1/coretools/CreaftV1CoreToolsController
 *       （请求体 CoreToolSubmissionRequest，回 Submission{taskId, taskIds, workflowHistoryIds}）；</li>
 *   <li>单条历史：GET /workflows/{workflowTitle}/histories/{historyId}（本地生活标题 local-life-dianping）；</li>
 *   <li>价目：GET /features/biz-points 的 localLife.{fivePanel…}.points（每张单价）。</li>
 * </ul>
 *
 * <p>复用 api/index.ts 的实例（token、401 刷新、业务错误 toast）；这里不吞错。
 * 请求体没有兜底 map：字段名不对会被 Jackson 静默丢弃，照样扣费，所以逐字对齐 Java。
 */
import { get, post, put } from './index.ts'
import { deleteWorkflowHistories } from './workflows.ts'
import { llShopProfileList } from './localLife.ts'

// ---------------- 品牌档案数据源开关 ----------------

/**
 * 全案页的品牌档案来源（唯一切换点）。
 *
 * <ul>
 *   <li>`java`：GET /api/v1/brand-profiles（Java 兼容表）。全案提交 /workflows/local-life 的 brandProfileId
 *       只认这张表，且每张参考图都必须是该档案里的 Logo / 门店图 / 特色菜图；</li>
 *   <li>`go`：GET /api/v1/local-life/shop-profiles（Go）。只有文字字段、没有图片，id 也不是 Java 档案 id，
 *       只能列出来选择，不能用于全案提交（页面会禁用提交并说明原因）。</li>
 * </ul>
 */
export type LLProfileSource = 'java' | 'go'
export const LL_PROFILE_SOURCE: LLProfileSource = 'java'

/** 两个来源归一后的列表项 */
export interface LLProfileItem {
  id: number
  title: string
  logoUrl?: string
  source: LLProfileSource
  /** 以下为 Java 列表摘要（2026-11-07 新增）；Go 源没有 */
  category?: string
  address?: string
  coverUrl?: string
  imageCount?: number
  templateCount?: number
}

// ---------------- 图种 ----------------

/** 提交体上的图种键（CoreToolSubmissionRequest 字段名，也是 biz-points.localLife 与历史 payload.templateUrls 的键） */
export type LLKindKey = 'fivePanel' | 'entryImage' | 'twoPanel' | 'setMealImage' | 'closeupImage'

/** 档案产物（/brand-profiles/{id}/assets）里的 bizType 短名 → 提交键 */
export const BIZ_TYPE_TO_KIND: Record<string, LLKindKey> = {
  five_panel: 'fivePanel',
  two_panel: 'twoPanel',
  entry_image: 'entryImage',
  set_meal_image: 'setMealImage',
  closeup_image: 'closeupImage',
}

// ---------------- Java 品牌档案 ----------------

/** GET /brand-profiles 列表项（不分页；不含 data） */
export interface BrandProfileListItem {
  brandProfileId: number
  brandFormId: number
  title?: string | null
  createdAt?: string | null
  logoUrl?: string | null
  /** 摘要（Java 2026-11-07 只加不改）：行业 / 所在城市·区域 / 封面 / 可作参考图的图片数 / 该行业官方模板数 */
  category?: string | null
  address?: string | null
  coverUrl?: string | null
  imageCount?: number | null
  templateCount?: number | null
}

/** GET /brand-profiles/{id}：多一个 data = 表单 json_schema，每个字段附上已填的 value */
export interface BrandProfileDetail extends BrandProfileListItem {
  data?: Record<string, unknown> | null
}

/** 档案里可作为全案参考图的素材 */
export interface BrandProfileImage {
  url: string
  /** logo = 档案 Logo；store = 门店图；feature = 特色菜图（推荐菜至少要一张） */
  role: 'logo' | 'store' | 'feature'
  /** 特色菜名（role=feature 时） */
  name?: string
}

/** 归一后的档案详情：全案页只用到这几项 */
export interface BrandProfileView {
  id: number
  title: string
  logoUrl: string
  /** 行业分类：官方模板必须与它一致（Java：所选模板与品牌档案分类不一致） */
  category: string
  images: BrandProfileImage[]
  /** 以下只用于手机预览，档案没填就是空（预览显示中性占位，不编造） */
  address?: string
  avgPrice?: string
  /** 特色项标签（去重） */
  tags?: string[]
  /** 特色项名（推荐菜位） */
  featureNames?: string[]
  /** 套餐图组（名称 / 价格） */
  meals?: { name: string; price: string }[]
}

export function brandProfileList() {
  return get<BrandProfileListItem[]>('/api/v1/brand-profiles')
}

export function brandProfileDetail(id: number) {
  return get<BrandProfileDetail>(`/api/v1/brand-profiles/${id}`)
}

/** GET /brand-profiles/forms 一项：jsonSchema 决定 data 的结构（x-order / x-required / x-hide / x-input-type / x-group …） */
export interface BrandFormItem {
  brandFormId: number
  category: string
  title: string
  jsonSchema: Record<string, unknown>
}

/** 品牌档案表单（不传 category 返回数组） */
export function brandFormList() {
  return get<BrandFormItem[]>('/api/v1/brand-profiles/forms')
}

/**
 * POST /brand-profiles：data 键按表单 jsonSchema（lowerCamel）。
 * 成功回 {brandProfileId}（Java 2026-11-07 只加不改；v1 / 老后端回 data:null，调用方要兜底）
 */
export function brandProfileCreate(brandFormId: number, data: Record<string, unknown>) {
  return post<{ brandProfileId?: number | null } | null>('/api/v1/brand-profiles', { brandFormId, data })
}

/** PUT /brand-profiles/{id}：data 整份替换（没传的键会丢）；brandFormId 不可改 */
export function brandProfileUpdate(id: number, data: Record<string, unknown>) {
  return put<null>(`/api/v1/brand-profiles/${id}`, { data })
}

/** 品牌档案列表（按 LL_PROFILE_SOURCE 取数并归一） */
export async function loadProfileList(source: LLProfileSource = LL_PROFILE_SOURCE): Promise<LLProfileItem[]> {
  if (source === 'go') {
    const res = await llShopProfileList()
    return (res.data?.list ?? []).map((p) => ({ id: p.id, title: p.name, source }))
  }
  const res = await brandProfileList()
  return (res.data ?? []).map((p) => ({
    id: p.brandProfileId,
    title: p.title || `#${p.brandProfileId}`,
    logoUrl: p.logoUrl || undefined,
    source,
    category: p.category || undefined,
    address: p.address || undefined,
    coverUrl: p.coverUrl || p.logoUrl || undefined,
    imageCount: typeof p.imageCount === 'number' ? p.imageCount : undefined,
    templateCount: typeof p.templateCount === 'number' ? p.templateCount : undefined,
  }))
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((i) => (typeof i === 'string' ? i : (asRecord(i)?.url as string | undefined)))
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim())
}

/** 详情 data 的取值：schema+value 形状取 properties[key].value，否则按扁平数据取；camel 与 snake 都认 */
function profileValue(data: Record<string, unknown>, ...keys: string[]): unknown {
  const props = asRecord(data.properties)
  for (const key of keys) {
    if (props) {
      const field = asRecord(props[key])
      if (field && 'value' in field) return field.value
    } else if (key in data) {
      return data[key]
    }
  }
  return undefined
}

/** 档案详情 → 全案页视图（键名照 Java CompatLocalLifeProjectionService.profileView） */
export function toBrandProfileView(d: BrandProfileDetail): BrandProfileView {
  const data = asRecord(d.data) ?? {}
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
  const logoUrl = text(profileValue(data, 'logoUrl', 'logo_url')) || d.logoUrl || ''
  const images: BrandProfileImage[] = []
  const seen = new Set<string>()
  const push = (img: BrandProfileImage) => {
    if (seen.has(img.url)) return
    seen.add(img.url)
    images.push(img)
  }
  const tags: string[] = []
  const featureNames: string[] = []
  const features = profileValue(data, 'features')
  for (const raw of Array.isArray(features) ? features : []) {
    const f = asRecord(raw)
    if (!f) continue
    const name = text(f.name)
    if (name) featureNames.push(name)
    for (const tag of Array.isArray(f.tags) ? f.tags : []) {
      const t = text(tag)
      if (t && !tags.includes(t)) tags.push(t)
    }
    for (const url of asStrings(f.imageUrls ?? f.image_urls)) push({ url, role: 'feature', name })
  }
  const meals: { name: string; price: string }[] = []
  const setMeal = profileValue(data, 'setMeal', 'set_meal')
  for (const raw of Array.isArray(setMeal) ? setMeal : []) {
    const m = asRecord(raw)
    const name = m ? text(m.name) : ''
    if (m && name) meals.push({ name, price: text(m.price) })
  }
  for (const url of asStrings(profileValue(data, 'storeImageUrls', 'store_image_urls'))) push({ url, role: 'store' })
  if (logoUrl) push({ url: logoUrl, role: 'logo' })
  return {
    id: d.brandProfileId,
    title: text(profileValue(data, 'name', 'shop_name')) || d.title || `#${d.brandProfileId}`,
    logoUrl,
    category: text(profileValue(data, 'category')),
    images,
    address: text(profileValue(data, 'address')),
    avgPrice: text(profileValue(data, 'avgPrice', 'avg_price')),
    tags,
    featureNames,
    meals,
  }
}

// ---------------- 设计模板 ----------------

export interface V1Page<T> {
  current: number
  pages: number
  total: number
  data: T[]
}

/** GET /local-life-templates/list 列表项（公共模板；payload 只有 overviewImage 全览图） */
export interface LocalLifeTemplate {
  localLifeTemplateId: number
  category: string
  title: string
  payload?: { overviewImage?: unknown } | null
  /** 有模板图的图种短名（five_panel …；Java 2026-11-07 新增）。选了未覆盖的图种，提交会被拒 */
  coverage?: string[] | null
}

/** GET /user-local-life-templates/list 列表项（自建模板；data 是自由 JSON） */
export interface UserLocalLifeTemplate {
  userLocalLifeTemplateId: number
  title: string
  data?: Record<string, unknown> | null
  createdAt?: string | null
  updatedAt?: string | null
}

export function localLifeTemplates(params: { category?: string; page?: number; size?: number } = {}) {
  return get<V1Page<LocalLifeTemplate>>('/api/v1/local-life-templates/list', {
    category: '',
    page: 1,
    size: 50,
    ...params,
  })
}

export function userLocalLifeTemplates(params: { page?: number; size?: number } = {}) {
  return get<V1Page<UserLocalLifeTemplate>>('/api/v1/user-local-life-templates/list', { page: 1, size: 50, ...params })
}

/** 全览图地址：overviewImage 可能是字符串、{url} 或 {images:[{url}]} */
export function overviewUrl(v: unknown): string {
  if (typeof v === 'string') return v
  const r = asRecord(v)
  if (!r) return Array.isArray(v) ? (asStrings(v)[0] ?? '') : ''
  if (typeof r.url === 'string') return r.url
  return asStrings(r.images)[0] ?? ''
}

const KIND_SHORT: Record<LLKindKey, string> = {
  fivePanel: 'five_panel',
  twoPanel: 'two_panel',
  entryImage: 'entry_image',
  setMealImage: 'set_meal_image',
  closeupImage: 'closeup_image',
}

/**
 * 自建模板里某图种的模板图（自定义模式上行 templateUrls 用）。
 * 自建模板 data 是端侧自由 JSON，按 Java templateImages 同一口径找：
 * data[短名|camel].images / data.payload[短名|camel].images；也认 data.templateUrls[camel]。
 */
export function userTemplateUrls(data: Record<string, unknown> | null | undefined, kind: LLKindKey): string[] {
  if (!data) return []
  const pick = (node: unknown) => {
    const r = asRecord(node)
    if (r) return asStrings(r.images ?? r.templateUrls ?? r.urls)
    return asStrings(node)
  }
  const fromTemplateUrls = asRecord(data.templateUrls)?.[kind]
  if (fromTemplateUrls) return asStrings(fromTemplateUrls)
  const short = KIND_SHORT[kind]
  const direct = data[short] ?? data[kind]
  if (direct) return pick(direct)
  const payload = asRecord(data.payload)
  return payload ? pick(payload[short] ?? payload[kind]) : []
}

// ---------------- 全案提交 / 续跑 ----------------

export interface LLPanelGroup {
  content?: string
  imageUrls: string[]
  index: number
}

export interface LLBizConfig {
  templateUrls?: string[]
  groups: LLPanelGroup[]
}

export interface LLCloseupConfig {
  content?: string
  imageUrls: string[]
  templateUrls?: string[]
}

/** CoreToolSubmissionRequest 中 /workflows/local-life 与 /continue 读取的子集 */
export interface LocalLifeSubmitBody {
  title?: string
  /** 整体设计要求 · 总需求（≤2000）；进每张图的提示词。续跑沿用上一轮，不读 */
  content?: string
  /** 整体设计要求 · 风格需求（≤2000）；出图后按它做一道风格转换。续跑沿用上一轮，不读 */
  style?: string
  brandProfileId?: number
  /** official（默认，templateIds）/ custom（各图种 templateUrls） */
  mode?: 'official' | 'custom'
  templateIds?: number[]
  workflowHistoryId?: number
  fivePanel?: LLBizConfig
  twoPanel?: LLBizConfig
  entryImage?: LLBizConfig
  setMealImage?: LLBizConfig
  closeupImage?: LLCloseupConfig
}

/** 提交凭据（Submission）：workflows 路由回 workflowHistoryIds，产物从历史接口取 */
export interface LocalLifeSubmission {
  taskId?: string | null
  taskIds?: string[] | null
  workflowHistoryIds?: number[] | null
}

const SUBMIT_TIMEOUT = 60000
/** 本地生活新建与续跑共用的历史标题（Java LOCAL_LIFE_TITLE） */
export const LOCAL_LIFE_WORKFLOW_TITLE = 'local-life-dianping'

export function submitLocalLife(body: LocalLifeSubmitBody, idempotencyKey: string) {
  return post<LocalLifeSubmission>(
    '/api/v1/workflows/local-life',
    body,
    { 'Idempotency-Key': idempotencyKey },
    SUBMIT_TIMEOUT,
  )
}

/** 续跑：必须带 workflowHistoryId（只有已成功的历史可以继续）；档案、模式、官方模板沿用上一轮 */
export function continueLocalLife(body: LocalLifeSubmitBody, idempotencyKey: string) {
  return post<LocalLifeSubmission>(
    '/api/v1/workflows/local-life/continue',
    body,
    { 'Idempotency-Key': idempotencyKey },
    SUBMIT_TIMEOUT,
  )
}

/** 单条工作流历史（CompatV1HistoryView.WorkflowHistory 的子集） */
export interface LocalLifeHistory {
  workflowHistoryId: number
  /** PENDING / RUNNING / WAITING_MANUAL_PROCESS / SUCCEED / FAILED / TIMEOUT / CANCELLED / PARTIAL_SUCCEED */
  status: string
  data?: {
    payload?: { mode?: string | null; templateUrls?: Partial<Record<LLKindKey, string[]>> | null } | null
    result?: { status?: string | null; error?: string | null; errorCode?: string | null } | null
    resultImageUrls?: string[] | null
  } | null
}

export function localLifeHistory(historyId: number) {
  return get<LocalLifeHistory>(`/api/v1/workflows/${LOCAL_LIFE_WORKFLOW_TITLE}/histories/${historyId}`)
}

/** GET /brand-profiles/{id}/assets 的一行：该档案的一次全案（含续跑），按图种给产物 */
export interface BrandProfileAssetRow {
  workflowHistoryId: number
  status: string
  createdAt?: string | null
  /** 提交时冻结的点数（失败整单退回、部分失败按张退回；Java 2026-11-07 新增） */
  points?: number | null
  /** 失败原因的用户文案（非失败为 null；Java 2026-11-07 新增） */
  error?: string | null
  businesses?: {
    bizType: string
    imageUrls?: string[] | null
    tasks?: string[] | null
    results?: { slot?: string; versionIndex?: number; groupIndex?: number; url?: string | null }[] | null
  }[]
}

/** 删除全案历史（Java 整批校验归属；任一仍在生成中整批拒绝） */
export function deleteLocalLifeHistories(historyIds: number[]) {
  return deleteWorkflowHistories(LOCAL_LIFE_WORKFLOW_TITLE, historyIds)
}

export function brandProfileAssets(id: number, page = 1, size = 10) {
  return get<V1Page<BrandProfileAssetRow>>(`/api/v1/brand-profiles/${id}/assets`, { page, size })
}

// ---------------- 价目 ----------------

export interface BizPoints {
  localLife?: Partial<Record<LLKindKey, { points: number; count: number; total: number }>>
  [key: string]: unknown
}

export function bizPoints() {
  return get<BizPoints>('/api/v1/features/biz-points')
}
