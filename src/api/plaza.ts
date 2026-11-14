/**
 * 创意广场接口封装（Java，均为免登录 GET；带了 token 由请求层照常附上）。
 *
 * <p>模板广场：/api/v1/plaza-templates/*（CreaftV1SupportController，v1 兼容口，分页信封
 * {current, pages, total, data}）。素材广场：/api/v1/asset/public/display*（AssetController 推荐流，
 * 信封 {list, total, page, pageSize}）。
 */
import { delQuiet, get, postQuiet, put, putQuiet, getQuiet, toApiError } from './index.ts'
import { isMock } from './mock-switch.ts'
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
  /** 作者展示名；列表接口附带（官方上架的为「官方」），详情 / 旧后端没有 */
  authorName?: string
  /** 近 7 天用它做同款的次数；行业版次数不够展示（<20）时服务端下发 null，旧后端没有该字段 */
  usageCount?: number | null
  // ---- 行业版（/api/v1/plaza/*，agent-template-industry DESIGN §5.1）新增，均可选 ----
  /** false = 次数不够展示（<20），不显示做同款人数 */
  usageVisible?: boolean
  mediaType?: 'image' | 'video'
  videoUrl?: string | null
  posterUrl?: string | null
  coverThumbUrl?: string | null
  isNew?: boolean
  createdAt?: string
  /** 模板需要用户放产品图（决定输入框引导语里的槽位名） */
  needsProductImage?: boolean
  targetChannels?: IPlazaChannel[]
  /** 模板入参（详情接口下发，列表不带）；没有 = 旧模板，保持单图位。原样存 unknown 由 parseSlots 判版本与未知 type */
  slots?: unknown
  /** 模板文字入参出图后由系统叠到成品图上（详情与列表都带） */
  textOverlay?: boolean
  /** 所属行业（Go：`parentCode` 是 omitempty，一级行业没有这个键） */
  industries?: { id: number; code: string; name: string; parentCode?: string }[]
}

export interface IPlazaChannel {
  code: string
  name: string
  width: number
  height: number
  ratio: string
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

/** 卡片 → 智能体页的模板暂存键（sessionStorage，会话级） */
const HANDOFF_KEY = 'fusion:plaza-template'

/**
 * 点卡片跳 /agent?plazaTemplateId= 前把手上已有的整条模板暂存（会话级、按 id 取用一次），
 * 智能体页优先用它，省掉逐页扫列表；没有暂存（直接打开链接、刷新）才按 id 取单条（plazaTemplateById，不再逐页扫列表）。
 */
export function stashPlazaTemplate(t: IPlazaTemplate) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(t))
  } catch {
    // 隐私模式 / 配额满：拿不到暂存就走扫描兜底
  }
}

/** 取出并清掉暂存（只取一次）；id 对不上视为没有暂存 */
function takeStashedPlazaTemplate(id: number): IPlazaTemplate | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(HANDOFF_KEY)
    const t = JSON.parse(raw) as IPlazaTemplate
    return t?.plazaTemplateId === id ? t : null
  } catch {
    return null
  }
}

/**
 * 按 id 找一条已上架模板（深链 /agent?plazaTemplateId= 用）：先取暂存，没有再 GET /api/v1/plaza/templates/{id}。
 * 不存在 / 已下架（RESOURCE_NOT_FOUND）返回 null；网络 / 服务异常照常抛出，由调用方提示重试。
 */
export async function findPlazaTemplate(id: number): Promise<IPlazaTemplate | null> {
  const stashed = takeStashedPlazaTemplate(id)
  if (stashed) return stashed
  try {
    const res = await plazaTemplateById(id)
    return res.data ?? null
  } catch (err) {
    const e = toApiError(err)
    if (e && (e.reason === 'RESOURCE_NOT_FOUND' || e.httpStatus === 404)) return null
    throw err
  }
}

/** 去重排序后的标签数组（后端只扫前 1000 条模板） */
export function plazaTemplateTags() {
  return get<string[]>('/api/v1/plaza-templates/tags')
}

// ---------------- 本周头条 ----------------

/**
 * 本周头条项（GET /api/v1/plaza-headlines，Java PlazaHeadlineController）：运营从广场模板里挑的本周爆款样本。
 * 模板字段与 IPlazaTemplate 同形（payload 已摘 prompt），可直接当模板选中；另带推荐语与近 7 天复刻统计。
 */
export interface IPlazaHeadline extends IPlazaTemplate {
  /** 行业版：自动上榜的条目没有人工头条记录，为 null；旧 Java 口恒有值 */
  headlineId: number | null
  /** 过滤后的名次，从 1 开始 */
  rank: number
  /** 一句推荐语（≤60 字） */
  why: string
  /** 近 7 天用该模板做同款的智能体轮次数；行业版 `usageVisible=false` 时服务端不下发有效数字（0），页面不得显示 */
  uses: number
  /** 再往前 7 天的轮次数（同上） */
  previousUses: number
  /** (uses − previousUses) / max(previousUses, 1) 取整百分比，可为负；previousUses = 0 时为 null（显示「新上榜」） */
  trend: number | null
  isNew: boolean
  /** 行业版条目可能没有起止日期（null） */
  startDate: string | null
  endDate: string | null
  /** 行业版（Go）：HEAT = 按热度上榜（含人工）；NEW = 冷启动补位的最新上架（只显示「新上架」，不显示热度与趋势） */
  kind?: 'HEAT' | 'NEW' | string
}

export interface IPlazaHeadlineList {
  /** 统计窗口（yyyy-MM-dd，近 7 天） */
  statsFrom: string
  statsTo: string
  items: IPlazaHeadline[]
  /** 行业版附带 */
  scope?: string
  /** 榜单版本号（Go int64，递增） */
  version?: number
  /** 榜单计算时间（无时区的东八区时间 `yyyy-MM-ddTHH:mm:ss`，用 {@link parsePlazaTime} 解析），「更新于 N 分钟前」用；还没算出榜单时为 null */
  computedAt?: string | null
}

/** 本周头条（需登录）：tag 同模板页分类 chip，keyword 在标题 / 说明 / 标签 / 推荐语里搜；不分页 */
export function plazaHeadlineList(params: { tag?: string; keyword?: string }) {
  return get<IPlazaHeadlineList>('/api/v1/plaza-headlines', params)
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

// ---------------- 行业版模板广场（Go 原生，/api/v1/plaza/*） ----------------
//
// 契约：fusion_aigc_go/docs/api/api-plaza.md（以 app/gateway/api/internal/handler/plaza/plaza.go 为准）。
// 信封 {code, reason?, msg, data, requestId, timestamp}，字段 camelCase，Go 的 jsoncase 对 /api/v1/plaza/ 原样放行（不补 snake 别名）。
// 业务错误 HTTP 200 + 非 0 code：行业失效 4001 + reason INDUSTRY_NOT_FOUND、模板下架 4001（RESOURCE_NOT_FOUND）、
// 报价源不可用 6001 QUOTE_UNAVAILABLE、建议限频 4002 SUGGESTION_RATE_LIMITED；
// 缺 industry 为 HTTP 400 + code 1002 PARAM_MISSING，参数格式错 HTTP 400 + 1003 PARAM_INVALID，限流 HTTP 429 + reason TOO_FREQUENT，
// 库没配 / 功能未开 7003（PLAZA_NOT_READY）。
// 除「行业目录」「偏好」「按 id 取单条」外，一律要求 industry：类型上必填，运行时空值直接 throw（不发请求）。
// 后端未就绪时用 mock 开关（`?mock=plaza`，见 mock-switch.ts）。

export interface IIndustryChild {
  id: number
  code: string
  name: string
  /** 二级的一句话释义（Go omitempty：没配就没有这个键） */
  hint?: string
}

export interface IIndustry {
  id: number
  code: string
  name: string
  iconUrl?: string | null
  /** 一句话说明（门按钮下的小字 / 二级释义） */
  hint?: string | null
  /** 「足浴人」这类对象称呼，文案变量用 */
  audienceName?: string | null
  examples?: string[]
  nextActions?: string[]
  children?: IIndustryChild[]
}

export interface IIndustryCatalog {
  /** false = 上线开关未开 / 没配行业：前端显示「行业模板整理中」，不降级成全量列表 */
  gateEnabled: boolean
  industries: IIndustry[]
}

export interface IIndustryPreference {
  industryIds: number[]
  primaryIndustryId: number | null
  primary: { id: number; code: string; name: string; parentCode?: string } | null
  /** true = 偏好行业已停用 / 删除 / 不可见：服务端不改写用户行，由用户重选 */
  stale: boolean
}

export interface IPlazaCounts {
  scope: string
  image: number
  video: number
  newCount7d: number
}

export interface IIndustryScope {
  /** 行业 code（一级或二级），必填 */
  industry: string
  /** 二级 code，必须属于 industry */
  subIndustry?: string
}

function requireIndustry(industry: string | undefined | null): string {
  if (!industry) throw new Error('industry 必填（行业模板接口不提供跨行业视角）')
  return industry
}

/**
 * 行业已停用 / 删除 / 二级不属于该行业（INDUSTRY_NOT_FOUND），或请求没带行业（HTTP 400 PARAM_MISSING「请先选择行业」）：
 * 调用方据此清缓存回行业门（Go 契约：缺 industry 比参数格式错优先，前端据此回行业门）。
 */
export function isIndustryGone(err: unknown): boolean {
  const e = toApiError(err)
  if (!e) return false
  return e.reason === 'INDUSTRY_NOT_FOUND' || e.reason === 'PARAM_MISSING' || (e.code === 1002 && e.httpStatus === 400)
}

/** Go 下发的「无时区东八区时间」（`2006-01-02T15:04:05`）按东八区解析；已带时区的原样解析 */
export function parsePlazaTime(s: string): Date {
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}+08:00`)
}

/**
 * 行业版接口失败 → 用户文案（agent-template-industry/EXPERIENCE.md §3.12 与文案表 E-xx / G-xx）。
 * 不展示错误码 / 英文；`fallback` 是兜底（E-09）。
 */
export function plazaErrorText(err: unknown, fallback = '出了点问题，再试一次'): string {
  const e = toApiError(err)
  if (!e) return fallback
  if (e.isNetwork) return '加载超时了，检查一下网络再试'
  if (e.httpStatus === 429 || e.reason === 'TOO_FREQUENT') return '操作太快了，稍后再试' // E-05
  if (isIndustryGone(err)) return e.reason === 'INDUSTRY_NOT_FOUND' ? '这个行业已调整，请重新选择' : '请先选择行业' // G-10 / Go 400 文案
  if (e.reason === 'RESOURCE_NOT_FOUND' || e.code === 4001) return '这个模板刚刚下架了，看看相似的吧' // E-13
  if (e.reason === 'FAVORITE_LIMIT') return '收藏已满，取消一些再收藏' // F-07
  if (e.reason === 'MY_TEMPLATE_LIMIT') return '我的模板已满（最多 100 个），删除一些再保存'
  if (e.reason === 'QUOTE_UNAVAILABLE' || e.code === 6001) return '登录后查看报价'
  if (e.code === 7003 || e.reason === 'PLAZA_NOT_READY' || e.reason === 'FEATURE_NOT_READY') return '模板正在准备中，稍后再来看看' // G-13
  if (e.httpStatus && e.httpStatus >= 500) return '服务暂时有点忙，稍后再试' // E-04
  if (e.code === 1003 && e.message) return e.message // 参数错：Go 的 msg 就是用户口径
  return fallback
}

export async function plazaIndustries() {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockIndustries()
  return getQuiet<IIndustryCatalog>('/api/v1/plaza/industries')
}

export async function plazaCounts(p: IIndustryScope) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockCounts(p)
  return getQuiet<IPlazaCounts>('/api/v1/plaza/counts', { industry: p.industry, subIndustry: p.subIndustry || undefined })
}

export interface IPlazaTemplatesParams extends IIndustryScope {
  mediaType?: 'image' | 'video'
  keyword?: string
  /** 从 1 开始 */
  page?: number
  /** 默认 24，上限 100 */
  size?: number
}

export async function plazaTemplates(p: IPlazaTemplatesParams) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockTemplates(p)
  return getQuiet<IPlazaPage<IPlazaTemplate>>('/api/v1/plaza/templates', {
    industry: p.industry,
    subIndustry: p.subIndustry || undefined,
    mediaType: p.mediaType,
    keyword: p.keyword?.trim() || undefined,
    page: p.page ?? 1,
    size: p.size ?? 24,
  })
}

/** 按 id 取单条（深链 / 刷新还原用，不带行业；未发布 / 窗口外 / 已删除 → RESOURCE_NOT_FOUND） */
export async function plazaTemplateById(id: number) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockTemplateById(id)
  return getQuiet<IPlazaTemplate>(`/api/v1/plaza/templates/${encodeURIComponent(String(id))}`)
}

export async function plazaHeadlines(p: IIndustryScope & { keyword?: string }) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockHeadlines(p)
  return getQuiet<IPlazaHeadlineList>('/api/v1/plaza/headlines', {
    industry: p.industry,
    subIndustry: p.subIndustry || undefined,
    keyword: p.keyword?.trim() || undefined,
  })
}

/** 偏好（需登录） */
export async function plazaIndustryPreference() {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockGetPreference()
  return getQuiet<IIndustryPreference>('/api/v1/plaza/industry-preference')
}

/** 整体替换；v1 UI 恒传单个（可以是二级 id） */
export async function putPlazaIndustryPreference(industryId: number) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockPutPreference(industryId)
  return put<IIndustryPreference>('/api/v1/plaza/industry-preference', {
    industryIds: [industryId],
    primaryIndustryId: industryId,
  })
}

/**
 * 「没有我的行业？告诉我们」：匿名可提交，text 可空（≤40 字）；Go 返回 `{accepted:true}`。
 * 失败（含限频 4002 SUGGESTION_RATE_LIMITED：每 sid / IP 每天 ≤3 条）一律静默，页面按 G-19 当成功展示（不让想反馈的人再受一次挫）。
 */
export async function plazaIndustrySuggest(text: string) {
  if (isMock('plaza')) return { code: 0, msg: 'ok', data: { accepted: true } }
  let sid = ''
  try {
    sid = localStorage.getItem('fusion:plaza-sid') || ''
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('fusion:plaza-sid', sid)
    }
  } catch {
    sid = 'na'
  }
  return postQuiet<{ accepted: boolean }>('/api/v1/plaza/industry-suggestions', { text: text.trim().slice(0, 40) || undefined, sid })
}

/**
 * 做同款准备：POST /api/v1/plaza/templates/{id}/prepare，body { inputs }，按模板 schema 校验并返回规整后的 { inputs }。
 * 校验失败（业务码 1003 / HTTP 400）data 为 { field, errors:[{ field: 'inputs.<key>', rule, message }] }，
 * 用 {@link prepareFieldErrors} 取成 key → 文案就地提示；网络 / 5xx 照常抛出，调用方提示重试并不发送。
 */
export async function plazaPrepare(id: number, inputs: Record<string, unknown>) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockPrepare(id, inputs)
  return postQuiet<{ inputs: Record<string, unknown> }>(
    `/api/v1/plaza/templates/${encodeURIComponent(String(id))}/prepare`,
    { inputs },
  )
}

export interface IPrepareFieldErrors {
  /** 槽位 key → 错误文案（只含能定位到 inputs.<key> 的） */
  byKey: Record<string, string>
  /** 第一条文案（含定位不到字段的） */
  first: string
}

const INPUT_FIELD_RE = /^inputs\.([^.[\]]+)/

/**
 * /agent/stream 受理前拒收入参的 ERROR 帧（HTTP 200 + 一帧 ERROR，code=PARAM_INVALID，帧里带 field=inputs.<key>，
 * 也可能带 errors 列表）→ 与 prepare 失败同一形状；不是入参错误返回 null。字段位置兼容 content 顶层与 content.data。
 */
export function streamFieldErrors(frame: { event: string; data?: { content?: Record<string, any> } }): IPrepareFieldErrors | null {
  if (frame.event !== 'ERROR') return null
  const c = frame.data?.content ?? {}
  const d = (c.data && typeof c.data === 'object' ? c.data : {}) as Record<string, any>
  const code = String(c.code ?? c.reason ?? d.code ?? '')
  const field = String(c.field ?? d.field ?? '')
  const list: { field?: string; message?: string }[] = Array.isArray(c.errors) ? c.errors : Array.isArray(d.errors) ? d.errors : []
  if (code !== 'PARAM_INVALID' && !INPUT_FIELD_RE.test(field)) return null
  const msg = String(c.message ?? d.message ?? '')
  const items = list.length ? list : [{ field, message: msg }]
  const byKey: Record<string, string> = {}
  let first = ''
  for (const it of items) {
    const m = INPUT_FIELD_RE.exec(it.field ?? '')
    const text = it.message || msg
    if (m && text && !byKey[m[1]!]) byKey[m[1]!] = text
    if (!first && text) first = text
  }
  if (!Object.keys(byKey).length) return null
  return { byKey, first: first || msg }
}

/** 取出 prepare 的入参校验错误；不是校验错误（网络 / 5xx / 其他业务错误）返回 null */
export function prepareFieldErrors(err: unknown): IPrepareFieldErrors | null {
  const e = toApiError(err)
  if (!e || e.isNetwork) return null
  if (e.code !== 1003 && e.httpStatus !== 400) return null
  // HTTP 400 时 ApiError 的 data 取自响应体的 data；axios 错误已在 toApiError 里转成 ApiError
  const d = e.data as { errors?: { field?: string; message?: string }[] } | undefined
  const byKey: Record<string, string> = {}
  let first = ''
  for (const it of d?.errors ?? []) {
    const m = /^inputs\.([^.[\]]+)/.exec(it.field ?? '')
    if (m && it.message && !byKey[m[1]!]) byKey[m[1]!] = it.message
    if (!first && it.message) first = it.message
  }
  if (!first) first = e.message
  return { byKey, first }
}

// ---------------- 示例效果 / 报价 / 最近用过（Go /api/v1/plaza/{samples,quote,recent}） ----------------
//
// 契约：fusion_aigc_go app/gateway/api/internal/handler/plaza/plaza.go + app/plaza/core/{samples,quote}.go。
// 三个都要 industry（缺 → 400）；samples / quote 公开（匿名可调，带了 token 照常附上），recent 需登录。

/** 示例素材（预计算示例成品；模板级在前、行业级在后，≤6 条）。Go 只给成品图 / 视频，不给「放进去的」配对原图 */
export interface IPlazaSample {
  id: number
  /** image | video（后台录入，缺省按图处理） */
  kind: string
  url: string
  /** 缺省时服务端已回填成 url */
  thumbUrl: string
  title: string
  /** TEMPLATE | INDUSTRY */
  scope: 'TEMPLATE' | 'INDUSTRY' | string
  /** INPUT = 放进去的，OUTPUT = 做出来的；老后端 / 缺省按 OUTPUT。同 role 内按下发顺序，第 i 个 INPUT 配第 i 个 OUTPUT */
  role?: 'INPUT' | 'OUTPUT' | string
}

export interface IPlazaEta {
  p50: number
  p80: number
  samples: number
}

/** 匿名标价（listPrice，不含轮次费）或登录个性化报价（personalized，含 totalPoints / balance） */
export interface IPlazaQuote {
  templateId: number
  /** image / video；旧后端没有该字段时按图片 */
  mediaType?: 'image' | 'video'
  /** 一次最多出几版（图 4；视频以后端为准，当前 1）；缺省按图 4 / 视频 1 */
  maxVariants?: number
  variants: number
  resolution: string
  referenceCount: number
  unitPoints: number
  imagePoints: number
  turnPoints: number | null
  turnFeeIncluded: boolean
  listPrice: boolean
  personalized: boolean
  /** 样本 < 30 为 null：不显示时间，不编造 */
  etaSeconds: IPlazaEta | null
  /** 报价源不可用、沿用了 1 小时内的缓存价 */
  stale: boolean
  freeQuotaApplied?: boolean
  totalPoints?: number
  balance?: number
  sufficient?: boolean
  /** 个性化报价里后端没读到轮次费（turnPoints 按 0 计）：显示「轮次费以实际为准」 */
  turnPriceUnavailable?: boolean
}

/** 「接着做」条目：模板基本字段 + 自己的使用情况（lastUsedAt 无时区东八区时间） */
export interface IPlazaRecent extends IPlazaTemplate {
  lastUsedAt: string
  useCount: number
  channels: string[]
  subIndustryCodes: string[]
}

export interface IPlazaSamplesParams extends IIndustryScope {
  templateId?: number
}

export interface IPlazaQuoteParams extends IIndustryScope {
  templateId: number
  /** 版数 1~4，缺省 1 */
  variants?: number
  /** 请求里实际填了几张参考图（image 位已填数量）；不传 = 后端按模板是否需要产品图取 0/1 */
  refImageCount?: number
  /** 出图档位 1k / 2k / 4k；缺省 1k（不传保持老行为） */
  resolution?: PlazaResolution
}

export type PlazaResolution = '1k' | '2k' | '4k'

export async function plazaSamples(p: IPlazaSamplesParams) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockSamples(p)
  return getQuiet<{ samples: IPlazaSample[] }>('/api/v1/plaza/samples', {
    industry: p.industry,
    subIndustry: p.subIndustry || undefined,
    templateId: p.templateId || undefined,
  })
}

export async function plazaQuote(p: IPlazaQuoteParams) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockQuote(p)
  return getQuiet<IPlazaQuote>('/api/v1/plaza/quote', {
    industry: p.industry,
    subIndustry: p.subIndustry || undefined,
    templateId: p.templateId,
    variants: p.variants || undefined,
    refImageCount: p.refImageCount,
    resolution: p.resolution && p.resolution !== '1k' ? p.resolution : undefined,
  })
}

/** 需登录；严格同行业（选了二级仍返回整个行业的）；limit 默认 12、上限 50 */
export async function plazaRecent(p: IIndustryScope & { mediaType?: 'image' | 'video'; limit?: number }) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockRecent(p)
  return getQuiet<{ items: IPlazaRecent[] }>('/api/v1/plaza/recent', {
    industry: p.industry,
    subIndustry: p.subIndustry || undefined,
    mediaType: p.mediaType,
    limit: p.limit,
  })
}

/** 报价页面上显示的唯一点数：个性化取 totalPoints（含轮次费），否则 imagePoints；取不到数字返回 null */
export function quoteDisplayPoints(q: IPlazaQuote): number | null {
  const n = q.personalized ? (q.totalPoints ?? q.imagePoints + (q.turnPoints ?? 0)) : q.imagePoints
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 一次最多出几版：后端给就用后端的，缺省 4 */
export function quoteMaxVariants(q: IPlazaQuote | null): number {
  const m = q?.maxVariants
  return typeof m === 'number' && m >= 1 ? Math.min(Math.floor(m), 4) : 4
}

/**
 * 出 n 版的总点数：单价（Go 回的 unitPoints，来自 Java 报价）× n；登录用户再加一次轮次费（一次发送只收一轮，与版数无关）。
 * 只是同一份报价的乘法，用来让版数档位与「再来一版」按钮的点数即时变化，真正的价格以后端报价为准。
 */
export function quoteTierPoints(q: IPlazaQuote, n: number): number | null {
  const unit = q.unitPoints
  if (!Number.isFinite(unit) || unit <= 0 || n < 1) return null
  return unit * n + (q.personalized ? (q.turnPoints ?? 0) : 0)
}

/** 预计耗时文案（取 p50；<90 秒写「约 N 秒」，否则「约 N 分钟」）；没有样本返回空串 */
export function quoteEtaText(q: IPlazaQuote): string {
  const s = q.etaSeconds?.p50
  if (!s || s <= 0) return ''
  return s < 90 ? `约 ${s} 秒` : `约 ${Math.round(s / 60)} 分钟`
}

// ---------------- 收藏 / 我的模板 / 节点推荐（Go /api/v1/plaza/{favorites,my-templates,nodes}） ----------------
//
// 契约：fusion_aigc_go/docs/api/api-plaza.md「收藏 / 我的模板 / 节点」（迁移 Go_V1.0.43）。
// 收藏与我的模板需登录、严格按行业（industry 必填，选了二级仍传一级以显示整个行业的内容）；节点公开。
// 业务错误：收藏满 4002 FAVORITE_LIMIT、我的模板满 4002 MY_TEMPLATE_LIMIT、入参不合 schema 1003（data 带 field/errors，
// 用 prepareFieldErrors 取）、不存在 / 不是自己的 4001。

export interface IPlazaFavorite extends IPlazaTemplate {
  /** 收藏时间（无时区东八区时间） */
  favoritedAt: string
}

export interface IPlazaFavoriteList {
  items: IPlazaFavorite[]
  total: number
  /** 上限（500） */
  limit: number
}

export interface IPlazaMyTemplate {
  id: number
  name: string
  templateId: number
  /** 创建时所选行业 code（行业已失效为空串） */
  industry: string
  /** 仍然有效的入参（失效的已被服务端剔除，见 staleKeys） */
  inputs: Record<string, unknown>
  variants: number
  /** 出图档位；旧后端没有该字段按 1k */
  resolution?: PlazaResolution
  text: string
  createdAt: string
  updatedAt: string
  /** false = 模板已下线：只能改名 / 删除，不能恢复到输入区（此时 template 为 null） */
  templateAvailable: boolean
  /** 含 slots */
  template: IPlazaTemplate | null
  /** true = 模板入参定义变过，部分设置已失效 */
  stale: boolean
  staleKeys: string[]
  staleHint?: string
}

export interface IPlazaMyTemplateList {
  items: IPlazaMyTemplate[]
  total: number
  /** 上限（100） */
  limit: number
}

export interface IPlazaMyTemplateBody {
  name: string
  templateId: number
  /** 创建时所选行业（缺省服务端取模板自己的第一个行业） */
  industry?: string
  subIndustry?: string
  inputs?: Record<string, unknown>
  /** 1~4，缺省 1 */
  variants?: number
  /** 1k / 2k / 4k，缺省 1k */
  resolution?: PlazaResolution
  text?: string
}

export interface IPlazaNode {
  code: string
  name: string
  /** 一句推荐语（可空；仅内容推荐，不含优惠） */
  why: string
  /** yyyy-MM-dd */
  eventDate: string
  /** 距节点当天还有几天（当天 = 0） */
  daysLeft: number
  /** 该行业在此节点下的模板总数（templates 可能被截到 12） */
  templateCount: number
  templates: IPlazaTemplate[]
}

export async function plazaFavorites(p: IIndustryScope) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockFavorites(p)
  return getQuiet<IPlazaFavoriteList>('/api/v1/plaza/favorites', { industry: p.industry, subIndustry: p.subIndustry || undefined })
}

/** 收藏（幂等）：模板须此刻可见，否则 4001；满 500 → FAVORITE_LIMIT */
export async function plazaAddFavorite(templateId: number) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockAddFavorite(templateId)
  return postQuiet<{ templateId: number; favorited: boolean }>(`/api/v1/plaza/favorites/${encodeURIComponent(String(templateId))}`, {})
}

/** 取消收藏（幂等；模板已下线也能取消） */
export async function plazaRemoveFavorite(templateId: number) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockRemoveFavorite(templateId)
  return delQuiet<{ templateId: number; favorited: boolean }>(`/api/v1/plaza/favorites/${encodeURIComponent(String(templateId))}`)
}

export async function plazaMyTemplates(p: IIndustryScope) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockMyTemplates(p)
  return getQuiet<IPlazaMyTemplateList>('/api/v1/plaza/my-templates', { industry: p.industry, subIndustry: p.subIndustry || undefined })
}

export async function plazaCreateMyTemplate(body: IPlazaMyTemplateBody) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockCreateMyTemplate(body)
  return postQuiet<IPlazaMyTemplate>('/api/v1/plaza/my-templates', body)
}

/** 改名称 / 入参 / 版数 / 文字（给了才改） */
export async function plazaUpdateMyTemplate(id: number, patch: Partial<Pick<IPlazaMyTemplateBody, 'name' | 'inputs' | 'variants' | 'resolution' | 'text'>>) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockUpdateMyTemplate(id, patch)
  return putQuiet<IPlazaMyTemplate>(`/api/v1/plaza/my-templates/${encodeURIComponent(String(id))}`, patch)
}

export async function plazaDeleteMyTemplate(id: number) {
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockDeleteMyTemplate(id)
  return delQuiet<{ deleted: boolean }>(`/api/v1/plaza/my-templates/${encodeURIComponent(String(id))}`)
}

/** 营销节点推荐（公开）：窗口内（节点前 14 天起）、该行业有可用模板的节点，日期升序、≤3 个 */
export async function plazaNodes(p: IIndustryScope) {
  requireIndustry(p.industry)
  if (isMock('plaza')) return (await import('./plaza-mock.ts')).mockNodes(p)
  return getQuiet<{ items: IPlazaNode[] }>('/api/v1/plaza/nodes', { industry: p.industry, subIndustry: p.subIndustry || undefined })
}

export interface IOverlayIntentReq {
  /** 本轮 /agent/stream 的 X-Request-Id（8~60 位 [A-Za-z0-9_-]） */
  requestId: string
  templateId: number
  /** false = 明确「本次不加字」，此时不传 values */
  enabled: boolean
  /** 文字位 key → 文字（只含带版式且有值的 text 位） */
  values?: Record<string, string>
}

export interface IOverlayIntent {
  id: number | string
  requestId: string
  templateId: number
  enabled: boolean
  values: Record<string, string>
  createdAt: string
}

/**
 * 自动叠字意图登记：POST /api/v1/plaza/overlay-intents，须在发 /agent/stream 之前调用。
 * 同（用户, requestId）先到先得，重发原样返回。不收费。
 * 失败（含 7003 PLAZA_OVERLAY_AUTO_OFF / NOT_READY、4002 限频）一律不阻断生成：静默 console.warn，返回 null，前端照旧逐张 POST /overlays。
 */
export async function registerOverlayIntent(body: IOverlayIntentReq): Promise<IOverlayIntent | null> {
  try {
    if (isMock('plaza')) {
      return {
        id: Date.now(),
        requestId: body.requestId,
        templateId: body.templateId,
        enabled: body.enabled,
        values: body.enabled ? (body.values ?? {}) : {},
        createdAt: new Date().toISOString(),
      }
    }
    const res = await postQuiet<IOverlayIntent>('/api/v1/plaza/overlay-intents', body)
    return res?.data ?? null
  } catch (err) {
    console.warn('[plaza] overlay-intents 登记失败，不影响生成', err)
    return null
  }
}
