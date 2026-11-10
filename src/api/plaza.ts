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

const FIND_PAGE_SIZE = 100
const FIND_MAX_PAGES = 20

/** 卡片 → 智能体页的模板暂存键（sessionStorage，会话级） */
const HANDOFF_KEY = 'fusion:plaza-template'

/**
 * 点卡片跳 /agent?plazaTemplateId= 前把手上已有的整条模板暂存（会话级、按 id 取用一次），
 * 智能体页优先用它，省掉逐页扫列表；没有暂存（直接打开链接、刷新）才回退 findPlazaTemplate。
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
 * 按 id 找一条已上架模板（/plaza-templates/list 是 creaft v1 兼容口，没有详情接口）：逐页扫列表，
 * 找不到（下架 / 不存在）返回 null。后端分页在内存里切，100 条一页最多扫 20 页。
 * 先用卡片跳转时的暂存；接口失败会抛错（调用方据此区分「加载失败」与「找不到」）。
 */
export async function findPlazaTemplate(id: number): Promise<IPlazaTemplate | null> {
  const stashed = takeStashedPlazaTemplate(id)
  if (stashed) return stashed
  for (let page = 1; page <= FIND_MAX_PAGES; page++) {
    const res = await plazaTemplateList({ page, size: FIND_PAGE_SIZE })
    const d = res.data
    const hit = d?.data?.find((t) => t.plazaTemplateId === id)
    if (hit) return hit
    if (!d?.data?.length || (d.current ?? page) >= (d.pages ?? 0)) return null
  }
  return null
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
  headlineId: number
  /** 过滤后的名次，从 1 开始 */
  rank: number
  /** 一句推荐语（≤60 字） */
  why: string
  /** 近 7 天用该模板做同款的智能体轮次数 */
  uses: number
  /** 再往前 7 天的轮次数 */
  previousUses: number
  /** (uses − previousUses) / max(previousUses, 1) 取整百分比，可为负；previousUses = 0 时为 null（显示「新上榜」） */
  trend: number | null
  isNew: boolean
  startDate: string
  endDate: string
}

export interface IPlazaHeadlineList {
  /** 统计窗口（yyyy-MM-dd，近 7 天） */
  statsFrom: string
  statsTo: string
  items: IPlazaHeadline[]
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
