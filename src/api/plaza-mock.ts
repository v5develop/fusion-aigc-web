/**
 * 行业版模板广场的本地 mock（`?mock=plaza` 打开，见 mock-switch.ts）：只在后端 /api/v1/plaza/* 未就绪时用。
 * 形状与错误码对齐 Go 实际输出（fusion_aigc_go/docs/api/api-plaza.md + plaza.go）：industry 必填、行业内搜索、
 * 分页信封 current/pages/total/data、INDUSTRY_NOT_FOUND = 4001、模板下架 = 4001 RESOURCE_NOT_FOUND、
 * usageCount 次数不够时为 null、industries[].parentCode 一级行业没有该键、头条 kind 为 HEAT / NEW；
 * 数据全是占位（SVG 渐变图），不含真实素材。
 */
import { ApiError } from './index.ts'
import { buildInputs, parseSlots, validateSlots, defaultValues } from '@/views/agent/slots/slotTypes.ts'
import type {
  IIndustry,
  IIndustryCatalog,
  IIndustryPreference,
  IIndustryScope,
  IPlazaCounts,
  IPlazaFavoriteList,
  IPlazaMyTemplate,
  IPlazaMyTemplateBody,
  IPlazaMyTemplateList,
  IPlazaNode,
  IPlazaHeadline,
  IPlazaHeadlineList,
  IPlazaPage,
  IPlazaQuote,
  IPlazaQuoteParams,
  IPlazaRecent,
  IPlazaSample,
  IPlazaSamplesParams,
  IPlazaTemplate,
  IPlazaTemplatesParams,
} from './plaza.ts'

type Resp<T> = { code: number; msg: string; data: T }
const ok = <T,>(data: T): Resp<T> => ({ code: 0, msg: 'ok', data })
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms))

const INDUSTRIES: IIndustry[] = [
  {
    id: 3,
    code: 'foot_bath',
    name: '足浴',
    hint: '按摩 / 泡脚门店',
    audienceName: '足浴人',
    examples: ['做一张今日团购海报'],
    children: [
      { id: 8, code: 'foot_bath_bluev', name: '蓝V号' },
      { id: 9, code: 'foot_bath_creator', name: '达人号' },
    ],
  },
  { id: 4, code: 'spa', name: 'SPA 养生', hint: '氛围图 / 项目海报', audienceName: '养生人', children: [] },
  {
    id: 5,
    code: 'food',
    name: '美食餐饮',
    hint: '火锅 / 日料 / 小吃',
    audienceName: '餐饮人',
    children: [
      { id: 10, code: 'food_hotpot', name: '火锅' },
      { id: 11, code: 'food_jp', name: '日料' },
    ],
  },
  { id: 6, code: 'home', name: '家居装修', hint: '样板间 / 软装', audienceName: '家居人', children: [] },
  { id: 7, code: 'other', name: '其他', hint: '通用门店', audienceName: '门店老板', children: [] },
]

const HUES = [28, 200, 340, 150, 260, 12, 190, 300, 90]
function art(seed: number): string {
  const h = HUES[seed % HUES.length]!
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 45% 62%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 40% 30%)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="${120 + (seed % 5) * 40}" cy="120" r="70" fill="rgba(255,255,255,.18)"/><rect x="60" y="190" width="280" height="40" rx="20" fill="rgba(255,255,255,.14)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// [行业 code, 二级 code（空 = 一级自身）, 类型, 标题, 说明, 种子, 次数, 增幅%, 标记 h/n, 槽位, 渠道]
type Raw = [string, string, 'image' | 'video', string, string, number, number, number, string, string]
const RAW: Raw[] = [
  ['foot_bath', 'foot_bath_bluev', 'image', '足浴店环境氛围图', '灯光、木质、热气氛围，按爆款构图换成你的门店', 0, 1240, 86, 'h', '门头照片'],
  ['foot_bath', 'foot_bath_creator', 'image', '达人探店封面图', '第一眼就想点开的探店封面，换成你的包间', 1, 860, 41, 'h', '包间照片'],
  ['foot_bath', 'foot_bath_bluev', 'image', '团购套餐海报', '套餐名和价格位清楚，下单更直接', 2, 702, 12, '', '门头照片'],
  ['foot_bath', 'foot_bath_bluev', 'image', '技师形象图', '干净专业的技师形象图', 3, 330, 5, '', '技师照片'],
  ['foot_bath', '', 'image', '节日活动主图', '节日氛围加优惠位', 4, 150, 0, '', '门头照片'],
  ['foot_bath', '', 'image', '开业公告图', '简洁的开业通知', 5, 12, 0, 'n', '门头照片'],
  ['foot_bath', 'foot_bath_creator', 'video', '门店一分钟探店', '从门头到包间，一镜到底的探店短片', 6, 520, 33, 'h', '门头照片'],
  ['foot_bath', 'foot_bath_bluev', 'video', '技师手法展示', '手法特写加解说', 7, 140, 9, '', '技师照片'],
  ['foot_bath', '', 'video', '到店流程短片', '预约到离店的流程', 8, 30, 0, 'n', '门头照片'],
  ['spa', '', 'image', '养生馆氛围图', '柔和灯光的氛围大图', 1, 410, 20, 'h', '环境照片'],
  ['spa', '', 'image', '项目价目海报', '价目清晰的项目海报', 2, 120, 3, '', '环境照片'],
  ['spa', '', 'video', '精油 SPA 短片', '精油与手法的特写', 3, 88, 6, '', '环境照片'],
  ['food', 'food_hotpot', 'image', '外卖主图', '白底清爽，适合外卖平台', 5, 980, 52, 'h', '菜品照片'],
  ['food', 'food_hotpot', 'video', '出锅瞬间', '热气腾腾的出锅特写', 6, 892, 58, 'h', '菜品照片'],
  ['food', 'food_jp', 'video', '一人食探店', '一个人的安静用餐短片', 8, 37, 0, 'n', '菜品照片'],
  ['food', '', 'image', '招牌菜海报', '招牌菜加价格', 7, 260, 8, '', '菜品照片'],
  ['home', '', 'image', '样板间主图', '明亮、整洁的样板间大图', 0, 1760, 44, 'h', '房间照片'],
  ['home', '', 'image', '前后对比图', '改造前后同一机位对比', 1, 1390, 36, 'h', '房间照片'],
  ['home', '', 'video', '一镜到底看新家', '从玄关走到阳台的一镜到底', 6, 418, 31, 'h', '房间照片'],
  ['other', '', 'image', '门店主图', '正面门头加店名，清爽大方', 0, 520, 22, '', '门头照片'],
  ['other', '', 'image', '新玩法演示', '需要新版本才能使用的模板（演示降级）', 4, 5, 0, 'n', '照片'],
  ['other', '', 'video', '店铺介绍', '一分钟认识我们', 7, 210, 12, '', '门头照片'],
]

// ---- 模板入参（slots）演示数据：按标题给不同入参，覆盖 5 个行业 ----
/** 示例图要 http(s)（槽位只收可被服务端核验的地址），mock 用公共占位图服务 */
const sampleImg = (h: number) => `https://placehold.co/300x400/${['875f9a', '34795a', '94651f'][h % 3]}/ffffff/png?text=Example`
const SLOTS_BY_TITLE: Record<string, unknown> = {
  // 只要 1 张门头照 + 店名
  足浴店环境氛围图: {
    schemaVersion: 1,
    items: [
      { key: 'shop', type: 'image', label: '门头照片', required: true, order: 1, minCount: 1, maxCount: 1, guidance: '正面拍，把招牌拍全', exampleUrl: sampleImg(3), acceptRatio: '3:4' },
      { key: 'shopName', type: 'text', label: '店名', required: true, order: 2, maxLength: 12, placeholder: '例如：老刘足浴' },
    ],
  },
  // 1–3 张商品图 + 价格 + select 风格
  外卖主图: {
    schemaVersion: 1,
    items: [
      { key: 'products', type: 'image', label: '菜品照片', required: true, order: 1, minCount: 1, maxCount: 3, guidance: '放 1–3 张，越清晰越好', exampleUrl: sampleImg(5) },
      { key: 'price', type: 'price', label: '价格', required: true, order: 2, min: 1, max: 9999, step: 0.01, unit: '元' },
      { key: 'style', type: 'select', label: '风格', required: true, order: 3, default: 'fresh', options: [{ value: 'fresh', label: '清爽' }, { value: 'rich', label: '浓郁' }, { value: 'retro', label: '复古' }] },
    ],
  },
  // switch + visibleWhen
  达人探店封面图: {
    schemaVersion: 1,
    items: [
      { key: 'room', type: 'image', label: '包间照片', required: true, order: 1, minCount: 1, maxCount: 2, guidance: '放 1–2 张包间照片' },
      { key: 'showPromo', type: 'switch', label: '加一句活动文案', order: 2, group: '活动', default: false, help: '打开后可以写一句优惠或活动' },
      { key: 'promoText', type: 'text', label: '活动文案', required: true, order: 3, group: '活动', maxLength: 16, placeholder: '例如：双人套餐 99 元', visibleWhen: { key: 'showPromo', equals: true } },
    ],
  },
  养生馆氛围图: {
    schemaVersion: 1,
    items: [
      { key: 'env', type: 'image', label: '环境照片', required: true, order: 1, maxCount: 1 },
      { key: 'project', type: 'text', label: '主打项目', order: 2, maxLength: 10, placeholder: '例如：精油 SPA' },
      { key: 'color', type: 'color', label: '主色', order: 3, default: '#875f9a', help: '海报的主色调' },
    ],
  },
  样板间主图: {
    schemaVersion: 1,
    items: [
      { key: 'rooms', type: 'image', label: '房间照片', required: true, order: 1, minCount: 1, maxCount: 3 },
      { key: 'area', type: 'number', label: '面积', order: 2, group: '户型信息', min: 10, max: 500, step: 1, unit: '㎡' },
      { key: 'styles', type: 'multiselect', label: '风格', order: 3, group: '户型信息', options: [{ value: 'modern', label: '现代' }, { value: 'nordic', label: '北欧' }, { value: 'cream', label: '奶油' }] },
      { key: 'note', type: 'textarea', label: '想强调的亮点', order: 4, maxLength: 60, placeholder: '一句话说清楚，不填也可以' },
    ],
  },
  门店主图: {
    schemaVersion: 1,
    items: [
      { key: 'front', type: 'image', label: '门头照片', required: true, order: 1 },
      { key: 'shopName', type: 'text', label: '店名', required: true, order: 2, maxLength: 12 },
    ],
  },
  门店一分钟探店: {
    schemaVersion: 1,
    items: [
      { key: 'clips', type: 'video', label: '店内素材', required: true, order: 1, minCount: 1, maxCount: 2, maxDurationSec: 30, guidance: '放 1–2 段，每段不超过 30 秒' },
      { key: 'shopName', type: 'text', label: '店名', order: 2, maxLength: 12 },
    ],
  },
  // 演示降级：schemaVersion 比前端认识的高
  新玩法演示: { schemaVersion: 2, items: [{ key: 'x', type: 'hologram', label: '全息' }] },
}

const NOW = Date.now()
const ALL: IPlazaTemplate[] = RAW.map((r, i) => {
  const [ind, sub, media, title, desc, seed, uses, , mark, slot] = r
  const parent = INDUSTRIES.find((x) => x.code === ind)!
  const child = sub ? parent.children?.find((c) => c.code === sub) : undefined
  const poster = art(seed + i)
  return {
    plazaTemplateId: 1000 + i,
    title,
    agentSkillId: null,
    tags: [parent.name, ...(child ? [child.name] : [])],
    payload: {
      result: [poster],
      description: desc,
      guidance: `照这张的风格，换成你的${slot}，放一张就能发`,
    },
    authorName: '官方',
    // Go：次数不够展示（<20）时不下发具体数字（null）
    usageCount: uses >= 20 ? uses : null,
    usageVisible: uses >= 20,
    mediaType: media,
    videoUrl: null,
    posterUrl: media === 'video' ? poster : null,
    coverThumbUrl: poster,
    isNew: mark.includes('n'),
    createdAt: new Date(NOW - (mark.includes('n') ? 2 : 20 + i) * 86400000).toISOString().slice(0, 19),
    needsProductImage: true,
    slots: SLOTS_BY_TITLE[title],
    targetChannels:
      media === 'image'
        ? [{ code: 'meituan_head', name: '美团头图', width: 1200, height: 800, ratio: '3:2' }]
        : [{ code: 'douyin', name: '抖音', width: 1080, height: 1920, ratio: '9:16' }],
    industries: [
      child
        ? { id: child.id, code: child.code, name: child.name, parentCode: parent.code }
        : { id: parent.id, code: parent.code, name: parent.name },
    ],
  }
})
/** 列表 / 头条不下发 slots（只有详情有） */
function noSlots(t: IPlazaTemplate): IPlazaTemplate {
  const c = { ...t }
  delete c.slots
  return c
}
const META = new Map(RAW.map((r, i) => [1000 + i, { ind: r[0], sub: r[1], delta: r[7], hot: r[8].includes('h') }]))

function findScope(p: IIndustryScope): { ind: IIndustry; sub: string } {
  const ind = INDUSTRIES.find((x) => x.code === p.industry)
  const sub = p.subIndustry ?? ''
  if (!ind || (sub && !ind.children?.some((c) => c.code === sub))) {
    throw new ApiError('这个行业已调整，请重新选择', { code: 4001, reason: 'INDUSTRY_NOT_FOUND' })
  }
  return { ind, sub }
}

function scoped(p: IIndustryScope): IPlazaTemplate[] {
  const { ind, sub } = findScope(p)
  return ALL.filter((t) => {
    const m = META.get(t.plazaTemplateId)!
    if (m.ind !== ind.code) return false
    return sub ? m.sub === sub : true
  })
}

export async function mockIndustries(): Promise<Resp<IIndustryCatalog>> {
  await wait()
  return ok({ gateEnabled: true, industries: INDUSTRIES })
}

export async function mockCounts(p: IIndustryScope): Promise<Resp<IPlazaCounts>> {
  await wait(120)
  const l = scoped(p)
  return ok({
    scope: p.subIndustry || p.industry,
    image: l.filter((t) => t.mediaType === 'image').length,
    video: l.filter((t) => t.mediaType === 'video').length,
    newCount7d: l.filter((t) => t.isNew).length,
  })
}

export async function mockTemplates(p: IPlazaTemplatesParams): Promise<Resp<IPlazaPage<IPlazaTemplate>>> {
  await wait()
  let l = scoped(p)
  if (p.mediaType) l = l.filter((t) => t.mediaType === p.mediaType)
  const kw = p.keyword?.trim().toLowerCase()
  if (kw) l = l.filter((t) => [t.title, t.payload.description, ...t.tags].join(' ').toLowerCase().includes(kw))
  const size = Math.min(p.size ?? 24, 100)
  const page = p.page ?? 1
  return ok({
    current: page,
    pages: Math.max(1, Math.ceil(l.length / size)),
    total: l.length,
    data: l.slice((page - 1) * size, page * size).map(noSlots),
  })
}

export async function mockTemplateById(id: number): Promise<Resp<IPlazaTemplate>> {
  await wait(120)
  const t = ALL.find((x) => x.plazaTemplateId === id)
  if (!t) throw new ApiError('这个模板刚刚下架了，看看相似的吧', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
  return ok(t)
}

export async function mockHeadlines(p: IIndustryScope & { keyword?: string }): Promise<Resp<IPlazaHeadlineList>> {
  await wait()
  let l = scoped(p)
  const kw = p.keyword?.trim().toLowerCase()
  if (kw) l = l.filter((t) => [t.title, t.payload.description, ...t.tags].join(' ').toLowerCase().includes(kw))
  const hot = l.filter((t) => !t.isNew).sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
  const fresh = l.filter((t) => t.isNew)
  // Go 的头条条目只含：headlineId / rank / plazaTemplateId / title / agentSkillId / tags / payload / why / uses / previousUses / trend /
  // isNew / startDate / endDate / kind / usageVisible / mediaType / videoUrl / posterUrl / industries（没有 coverThumbUrl / authorName /
  // usageCount / needsProductImage / targetChannels / createdAt / slots）
  const items: IPlazaHeadline[] = [...hot, ...fresh].slice(0, 10).map((t, i) => {
    const m = META.get(t.plazaTemplateId)!
    const heat = !t.isNew
    const visible = !!t.usageVisible
    return {
      headlineId: i % 3 === 2 ? null : 5000 + t.plazaTemplateId, // 自动上榜的没有人工头条记录
      rank: i + 1,
      plazaTemplateId: t.plazaTemplateId,
      title: t.title,
      agentSkillId: t.agentSkillId,
      tags: t.tags,
      payload: t.payload,
      why: t.payload.description ?? '',
      // usageVisible=false 时 uses / previousUses / trend 置空（0 / 0 / null），页面只显示名次与「热」
      uses: visible && heat ? (t.usageCount ?? 0) : 0,
      previousUses: 0,
      trend: visible && heat && !t.isNew ? m.delta : null,
      isNew: !!t.isNew,
      startDate: null,
      endDate: null,
      kind: heat ? 'HEAT' : 'NEW',
      usageVisible: visible,
      mediaType: t.mediaType,
      videoUrl: t.videoUrl ?? null,
      posterUrl: t.posterUrl ?? null,
      industries: t.industries,
    }
  })
  const to = new Date()
  const from = new Date(NOW - 6 * 86400000)
  const d = (x: Date) => x.toISOString().slice(0, 10)
  return ok({
    statsFrom: d(from),
    statsTo: d(to),
    items,
    scope: p.subIndustry || p.industry,
    version: 1,
    // Go 是无时区的东八区时间（见 parsePlazaTime）
    computedAt: new Date(NOW - 3 * 60000 + 8 * 3600000).toISOString().slice(0, 19),
  })
}

const PREF_KEY = 'fusion:mock:plaza:pref'
export async function mockGetPreference(): Promise<Resp<IIndustryPreference>> {
  await wait(120)
  let id: number | null = null
  try {
    id = Number(localStorage.getItem(PREF_KEY)) || null
  } catch {
    // ignore
  }
  const flat = INDUSTRIES.flatMap((i) => [
    { id: i.id, code: i.code, name: i.name } as { id: number; code: string; name: string; parentCode?: string },
    ...(i.children ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name, parentCode: i.code })),
  ])
  const primary = flat.find((x) => x.id === id) ?? null
  return ok({ industryIds: primary ? [primary.id] : [], primaryIndustryId: primary?.id ?? null, primary, stale: false })
}

export async function mockPutPreference(industryId: number): Promise<Resp<IIndustryPreference>> {
  await wait(120)
  try {
    localStorage.setItem(PREF_KEY, String(industryId))
  } catch {
    // ignore
  }
  return mockGetPreference()
}

/**
 * 做同款准备：按模板 slots 校验并规整（文本去空格、color 大写、丢弃不可见项）。
 * 校验失败示例：店名 / 活动文案里含「违禁」→ 1003 + data.errors[inputs.<key>]；其余规则同 validateSlots。
 */
export async function mockPrepare(id: number, inputs: Record<string, unknown>): Promise<Resp<{ inputs: Record<string, unknown> }>> {
  await wait(300)
  const t = ALL.find((x) => x.plazaTemplateId === id)
  if (!t) throw new ApiError('这个模板刚刚下架了，看看相似的吧', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
  const p = parseSlots(t.slots)
  if (p.status !== 'ok') return ok({ inputs: {} })
  const values = { ...defaultValues(p.items), ...inputs }
  const errs = validateSlots(p.items, values)
  for (const s of p.items) {
    const v = values[s.key]
    if ((s.type === 'text' || s.type === 'textarea') && typeof v === 'string' && v.includes('违禁')) {
      errs[s.key] = `${s.label}里有不能使用的内容，请改一改`
    }
  }
  const keys = Object.keys(errs)
  if (keys.length) {
    throw new ApiError('入参不合法', {
      code: 1003,
      reason: 'PARAM_INVALID',
      data: {
        field: `inputs.${keys[0]}`,
        errors: keys.slice(0, 5).map((k) => ({ field: `inputs.${k}`, rule: 'mock', message: errs[k]! })),
      },
    })
  }
  const out = buildInputs(p.items, values)
  for (const s of p.items) {
    if (s.type === 'color' && typeof out[s.key] === 'string') out[s.key] = (out[s.key] as string).toUpperCase()
  }
  return ok({ inputs: out })
}

// ---------------- 示例效果 / 报价 / 最近用过 ----------------

/**
 * 示例：foot_bath 全部有（模板级 3 条 + 行业级补足）；food 只有行业级；其余没有（演示「没有示例就不显示该区块」）。
 * 仿真 Go：模板级在前、行业级在后、最多 6 条；thumbUrl 缺时回填 url。
 */
export async function mockSamples(p: IPlazaSamplesParams): Promise<Resp<{ samples: IPlazaSample[] }>> {
  await wait(160)
  findScope(p)
  const mk = (id: number, scope: 'TEMPLATE' | 'INDUSTRY', title: string, role: 'INPUT' | 'OUTPUT' = 'OUTPUT'): IPlazaSample => {
    const url = art(id)
    return { id, kind: 'image', url, thumbUrl: url, title, scope, role }
  }
  const out: IPlazaSample[] = []
  if (p.industry === 'foot_bath') {
    if (p.templateId) {
      // 两组「放进去的 → 做出来的」配对 + 一张只有成品的
      out.push(mk(7050, 'TEMPLATE', '门头原图 1', 'INPUT'), mk(7051, 'TEMPLATE', '门头原图 2', 'INPUT'))
      for (let i = 0; i < 3; i++) out.push(mk(7000 + i, 'TEMPLATE', `示例成品 ${i + 1}`))
    }
    out.push(mk(7100, 'INDUSTRY', '足浴门店示例'))
  } else if (p.industry === 'food') {
    out.push(mk(7200, 'INDUSTRY', '餐饮示例'), mk(7201, 'INDUSTRY', '火锅示例'))
  }
  return ok({ samples: out.slice(0, 6) })
}

/**
 * 报价：匿名 = 标价（listPrice，不含轮次费）；登录（本地有 fusion_accessToken）= 个性化（含 totalPoints / balance）。
 * 模板 id 为 1003 的演示「报价源不可用」（QUOTE_UNAVAILABLE），1004 演示 5xx 式失败。
 */
export async function mockQuote(p: IPlazaQuoteParams): Promise<Resp<IPlazaQuote>> {
  await wait(260)
  findScope(p)
  if (p.templateId === 1003) throw new ApiError('登录后查看报价', { code: 6001, reason: 'QUOTE_UNAVAILABLE' })
  if (p.templateId === 1004) throw new ApiError('服务暂时有点忙', { code: -1, httpStatus: 503 })
  const variants = Math.min(Math.max(p.variants ?? 1, 1), 4)
  let logged = false
  try {
    logged = !!localStorage.getItem('fusion_accessToken')
  } catch {
    // ignore
  }
  const unit = 8
  const base = {
    templateId: p.templateId,
    mediaType: 'image' as const,
    maxVariants: 4,
    variants,
    resolution: '1k',
    referenceCount: 1,
    unitPoints: unit,
    imagePoints: unit * variants,
    etaSeconds: p.templateId % 2 ? { p50: 28, p80: 45, samples: 120 } : null,
    stale: false,
  }
  return ok(
    logged
      ? { ...base, turnPoints: 2, turnFeeIncluded: true, listPrice: false, personalized: true, totalPoints: unit * variants + 2, balance: 120, sufficient: true }
      : { ...base, turnPoints: null, turnFeeIncluded: false, listPrice: true, personalized: false },
  )
}

/** 最近用过：同行业前 4 个图片模板（首页行业内「接着做」条演示） */
export async function mockRecent(p: IIndustryScope & { mediaType?: 'image' | 'video'; limit?: number }): Promise<Resp<{ items: IPlazaRecent[] }>> {
  await wait(160)
  let l = scoped(p)
  if (p.mediaType) l = l.filter((t) => t.mediaType === p.mediaType)
  const items = l.slice(0, Math.min(p.limit ?? 12, 12, 4)).map((t, i) => ({
    ...noSlots(t),
    lastUsedAt: `2026-11-1${3 - Math.min(i, 2)}T10:${10 + i}:00`,
    useCount: i + 1,
    channels: [],
    subIndustryCodes: [],
  }))
  return ok({ items })
}

// ---------------- 收藏 / 我的模板 / 节点（形状与 Go 对齐；存在 localStorage，刷新还在） ----------------

const FAV_KEY = 'fusion:mock:plaza:favorites'
const MY_KEY = 'fusion:mock:plaza:my-templates'
const FAV_LIMIT = 500
const MY_LIMIT = 100

function readJson<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : def
  } catch {
    return def
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // ignore
  }
}
const nowText = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19)
function needLogin() {
  let logged = false
  try {
    logged = !!localStorage.getItem('fusion_accessToken')
  } catch {
    // ignore
  }
  if (!logged) throw new ApiError('请先登录', { code: 2001, reason: 'UNAUTHORIZED', httpStatus: 401 })
}
function goneError() {
  return new ApiError('这个模板刚刚下架了，看看相似的吧', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
}
/** 收藏 / 我的模板的行业过滤：选了二级仍看整个行业（只用一级 code） */
function inIndustry(p: IIndustryScope, templateId: number): boolean {
  const m = META.get(templateId)
  return !!m && m.ind === p.industry
}

export async function mockFavorites(p: IIndustryScope): Promise<Resp<IPlazaFavoriteList>> {
  await wait(140)
  needLogin()
  findScope(p)
  const rows = readJson<{ id: number; at: string }[]>(FAV_KEY, [])
  const items = rows
    .slice()
    .reverse()
    .filter((r) => inIndustry(p, r.id))
    .map((r) => ({ ...noSlots(ALL.find((t) => t.plazaTemplateId === r.id)!), favoritedAt: r.at }))
  return ok({ items, total: items.length, limit: FAV_LIMIT })
}

export async function mockAddFavorite(templateId: number): Promise<Resp<{ templateId: number; favorited: boolean }>> {
  await wait(120)
  needLogin()
  if (!ALL.some((t) => t.plazaTemplateId === templateId)) throw goneError()
  const rows = readJson<{ id: number; at: string }[]>(FAV_KEY, [])
  if (!rows.some((r) => r.id === templateId)) {
    if (rows.length >= FAV_LIMIT) throw new ApiError('收藏已满，取消一些再收藏', { code: 4002, reason: 'FAVORITE_LIMIT' })
    rows.push({ id: templateId, at: nowText() })
    writeJson(FAV_KEY, rows)
  }
  return ok({ templateId, favorited: true })
}

export async function mockRemoveFavorite(templateId: number): Promise<Resp<{ templateId: number; favorited: boolean }>> {
  await wait(100)
  needLogin()
  writeJson(FAV_KEY, readJson<{ id: number; at: string }[]>(FAV_KEY, []).filter((r) => r.id !== templateId))
  return ok({ templateId, favorited: false })
}

interface MyRow {
  id: number
  name: string
  templateId: number
  industry: string
  inputs: Record<string, unknown>
  variants: number
  resolution?: '1k' | '2k' | '4k'
  text: string
  createdAt: string
  updatedAt: string
}

function viewMy(r: MyRow): IPlazaMyTemplate {
  const t = ALL.find((x) => x.plazaTemplateId === r.templateId) ?? null
  const slots = t ? parseSlots(t.slots) : null
  // 与 Go 一致：键已不在 schema 的入参算失效（mock 只做这一条）
  const keys = slots && slots.status === 'ok' ? new Set(slots.items.map((i) => i.key)) : new Set<string>()
  const staleKeys = t ? Object.keys(r.inputs).filter((k) => !keys.has(k)).sort() : []
  const inputs = Object.fromEntries(Object.entries(r.inputs).filter(([k]) => !staleKeys.includes(k)))
  return {
    id: r.id,
    name: r.name,
    templateId: r.templateId,
    industry: r.industry,
    inputs,
    variants: r.variants,
    resolution: r.resolution ?? '1k',
    text: r.text,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    templateAvailable: !!t,
    template: t,
    stale: staleKeys.length > 0,
    staleKeys,
    ...(staleKeys.length ? { staleHint: '部分设置已失效' } : {}),
  }
}

export async function mockMyTemplates(p: IIndustryScope): Promise<Resp<IPlazaMyTemplateList>> {
  await wait(140)
  needLogin()
  findScope(p)
  const items = readJson<MyRow[]>(MY_KEY, [])
    .slice()
    .reverse()
    .filter((r) => r.industry === p.industry || inIndustry(p, r.templateId))
    .map(viewMy)
  return ok({ items, total: items.length, limit: MY_LIMIT })
}

export async function mockCreateMyTemplate(b: IPlazaMyTemplateBody): Promise<Resp<IPlazaMyTemplate>> {
  await wait(160)
  needLogin()
  const name = b.name.trim()
  if (!name || [...name].length > 40) throw new ApiError('name 需要 1 到 40 个字', { code: 1003, reason: 'PARAM_INVALID', httpStatus: 400 })
  if (!ALL.some((t) => t.plazaTemplateId === b.templateId)) throw goneError()
  const rows = readJson<MyRow[]>(MY_KEY, [])
  if (rows.length >= MY_LIMIT) throw new ApiError('我的模板已满（最多 100 个），删除一些再保存', { code: 4002, reason: 'MY_TEMPLATE_LIMIT' })
  const row: MyRow = {
    id: Math.max(0, ...rows.map((r) => r.id)) + 1,
    name,
    templateId: b.templateId,
    industry: b.industry ?? META.get(b.templateId)?.ind ?? '',
    inputs: b.inputs ?? {},
    variants: Math.min(Math.max(b.variants ?? 1, 1), 4),
    resolution: b.resolution ?? '1k',
    text: (b.text ?? '').trim(),
    createdAt: nowText(),
    updatedAt: nowText(),
  }
  rows.push(row)
  writeJson(MY_KEY, rows)
  return ok(viewMy(row))
}

export async function mockUpdateMyTemplate(
  id: number,
  patch: Partial<Pick<IPlazaMyTemplateBody, 'name' | 'inputs' | 'variants' | 'resolution' | 'text'>>,
): Promise<Resp<IPlazaMyTemplate>> {
  await wait(140)
  needLogin()
  const rows = readJson<MyRow[]>(MY_KEY, [])
  const r = rows.find((x) => x.id === id)
  if (!r) throw new ApiError('这个模板不存在或已被删除', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
  if (patch.name != null) {
    const name = patch.name.trim()
    if (!name || [...name].length > 40) throw new ApiError('name 需要 1 到 40 个字', { code: 1003, reason: 'PARAM_INVALID', httpStatus: 400 })
    r.name = name
  }
  if (patch.inputs) r.inputs = patch.inputs
  if (patch.resolution != null) r.resolution = patch.resolution
  if (patch.variants != null) r.variants = Math.min(Math.max(patch.variants, 1), 4)
  if (patch.text != null) r.text = patch.text.trim()
  r.updatedAt = nowText()
  writeJson(MY_KEY, rows)
  return ok(viewMy(r))
}

export async function mockDeleteMyTemplate(id: number): Promise<Resp<{ deleted: boolean }>> {
  await wait(100)
  needLogin()
  writeJson(MY_KEY, readJson<MyRow[]>(MY_KEY, []).filter((r) => r.id !== id))
  return ok({ deleted: true })
}

/** 节点：演示用，固定「距今 6 天」的一个节点，挂当前行业前 4 个模板；`?mock=plaza` 下 foot_bath / spa 之外的行业也有 */
export async function mockNodes(p: IIndustryScope): Promise<Resp<{ items: IPlazaNode[] }>> {
  await wait(160)
  findScope(p)
  const templates = scoped(p).slice(0, 4).map(noSlots)
  if (!templates.length) return ok({ items: [] })
  const d = new Date(Date.now() + 6 * 86400000)
  const eventDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return ok({
    items: [
      { code: 'mock_node', name: '年货节', why: '年货节海报和短视频，现在就能做', eventDate, daysLeft: 6, templateCount: templates.length, templates },
    ],
  })
}
