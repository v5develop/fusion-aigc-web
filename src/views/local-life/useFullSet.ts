/**
 * 全案设计（/local-life 入口页）的状态与接口编排。
 *
 * <p>数据源：品牌档案按 api/localLifeFull.ts 的 LL_PROFILE_SOURCE（默认 Java brand-profiles）；
 * 模板 = 官方 local-life-templates（按档案行业过滤）+ 我的 user-local-life-templates；
 * 提交 = POST /api/v1/workflows/local-life（官方模板 official / 自建模板 custom），
 * 续跑 = POST /api/v1/workflows/local-life/continue（workflowHistoryId）。
 * 整体设计要求：总需求 → 提交体 content、风格需求 → style（v1 线上字段，各 ≤2000；Java 把总需求拼进每张图的提示词，
 * 风格需求做一道风格转换）。续跑沿用上一轮的需求，不再上行。
 * 模板可多选（官方 templateIds 多个 = 多版；自定义模板按图种合并模板图），官方与自定义不可混选（Java 同样拒收）。
 *
 * <p>轮询复用商拍工作室的 useStudioPolling（可见 3s、隐藏降频、失败退避、连续 3 次网络失败暂停 offline），
 * 间隔与工作流页 useWorkflowHistory 一致取 3s。到终态后从 /brand-profiles/{id}/assets 取按图种分好的产物
 * （按提交时记下的档案 id 取；产物行没出来或取失败退避重试 3 次，仍没有就提示「结果稍后出现，可在历史里刷新」）。
 * 历史里有生成中的行时用 usePollingWhile 每 5s 刷新历史直到全部终态；打开档案时若没有当前生成、历史里有生成中的行，
 * 就把最新那条接成当前 run（禁止重复提交、预览跟着它）。
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import {
  BIZ_TYPE_TO_KIND,
  LL_PROFILE_SOURCE,
  deleteLocalLifeHistories,
  bizPoints,
  brandProfileAssets,
  brandProfileDetail,
  continueLocalLife,
  loadProfileList,
  localLifeHistory,
  localLifeTemplates,
  overviewUrl,
  submitLocalLife,
  toBrandProfileView,
  userLocalLifeTemplates,
  userTemplateUrls,
  type BrandProfileAssetRow,
  type BrandProfileView,
  type LLKindKey,
  type LLProfileItem,
  type LocalLifeHistory,
  type LocalLifeSubmitBody,
} from '@/api/local-life-full.ts'
import { useIdempotentSubmit, useStudioPolling, type PollRoundResult } from '@/views/studio/hooks.ts'
import { usePollingWhile } from './hooks.ts'
import { useUserInfoStore } from '@/stores/user-info.ts'
import { BILLING_BLOCK_CODES, emitBillingBlock } from '@/utils/billing-guide'

export interface SectionDef {
  key: LLKindKey
  title: string
  multiItem: boolean
  maxImages: number
}

/** 五类图种（原型 CONTENT_SECTIONS 的标题 / 多条 / 素材上限），key 即提交体字段名 */
export const SECTIONS: SectionDef[] = [
  { key: 'fivePanel', title: '五连图', multiItem: true, maxImages: 4 },
  { key: 'entryImage', title: '入口图', multiItem: true, maxImages: 4 },
  { key: 'twoPanel', title: '套餐二连图', multiItem: true, maxImages: 4 },
  { key: 'setMealImage', title: '套餐图', multiItem: true, maxImages: 4 },
  { key: 'closeupImage', title: '推荐菜', multiItem: false, maxImages: 4 },
]
export const ITEM_MAX_LENGTH = 200
/** 整体设计要求两项的上限（Java content / style 各 2000） */
export const REQUIREMENT_MAX_LENGTH = 2000
/** 自定义模式每个图种最多 9 张模板图（Java templateUrls @Size(max=9)） */
const CUSTOM_TEMPLATE_MAX = 9

export interface SectionItem {
  content: string
  images: string[]
}
export interface SectionState {
  selected: boolean
  items: SectionItem[]
}

export interface TemplateCard {
  source: 'system' | 'user'
  id: number
  title: string
  cover: string
  data?: Record<string, unknown> | null
  /** 覆盖的图种（有模板图）；官方取 Java coverage，自建按 data 里各图种的模板图算。null = 后端没给（不判） */
  coverage: LLKindKey[] | null
}

/** 「覆盖 5 种图」/「覆盖套餐图、推荐菜」；不知道覆盖范围返回空串 */
export function coverageText(coverage: LLKindKey[] | null): string {
  if (!coverage) return ''
  if (!coverage.length) return '未包含模板图'
  if (coverage.length === SECTIONS.length) return `覆盖 ${SECTIONS.length} 种图`
  return `覆盖${SECTIONS.filter((s) => coverage.includes(s.key))
    .map((s) => s.title)
    .join('、')}`
}

/** 终态（Java CompatV1TaskStatus.TERMINAL + 组提交聚合态 PARTIAL_SUCCEED） */
const TERMINAL = new Set(['SUCCEED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'PARTIAL_SUCCEED'])
export const isLLTerminal = (s?: string | null) => !!s && TERMINAL.has(s)

export const STATUS_LABEL: Record<string, string> = {
  PENDING: '生成中',
  RUNNING: '生成中',
  WAITING_MANUAL_PROCESS: '生成中',
  SUCCEED: '已完成',
  PARTIAL_SUCCEED: '已完成',
  FAILED: '失败',
  TIMEOUT: '失败',
  CANCELLED: '失败',
}

/** 按图种归好的产物地址 */
export type KindResults = Partial<Record<LLKindKey, string[]>>

/**
 * 推荐菜产物各张的 groupIndex（与 rowResults().closeupImage 同序）；没有 groupIndex 的位为 undefined。
 * 推荐菜按所选特色菜图拆组（每张特色菜图一组，组号 = 该图在所选特色菜图里的序号）。
 */
export function rowCloseupGroups(row: BrandProfileAssetRow | undefined | null): (number | undefined)[] {
  const out: (number | undefined)[] = []
  for (const b of row?.businesses ?? []) {
    if (BIZ_TYPE_TO_KIND[b.bizType] !== 'closeupImage') continue
    for (const r of b.results ?? []) if (r.url) out.push(typeof r.groupIndex === 'number' ? r.groupIndex : undefined)
  }
  return out
}

/** 当前这次生成 */
export interface LLRun {
  historyId: number
  /** 提交时的档案：轮询取产物用它，不随页面上切换档案而变 */
  profileId: number
  status: string
  error?: string
  results: KindResults
  /** 推荐菜各张产物的组号（与 results.closeupImage 同序） */
  closeupGroups?: (number | undefined)[]
  /** 提交时所选特色菜图对应的菜名（按组号）；接管的历史行不知道，为 undefined */
  closeupNames?: (string | undefined)[]
  /** 到终态后产物仍取不到时的提示 */
  notice?: string
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** 终态后取产物的退避（共 3 次重试） */
const RESULT_RETRY_DELAYS = [1000, 2000, 4000]
export const RESULT_LATE_NOTICE = '结果稍后出现，可在历史里刷新'

export function rowResults(row: BrandProfileAssetRow | undefined | null): KindResults {
  const out: KindResults = {}
  for (const b of row?.businesses ?? []) {
    const kind = BIZ_TYPE_TO_KIND[b.bizType]
    if (!kind) continue
    const urls = (b.results ?? []).map((r) => r.url ?? '').filter(Boolean)
    if (urls.length) out[kind] = urls
  }
  return out
}

function emptySections(): Record<LLKindKey, SectionState> {
  const out = {} as Record<LLKindKey, SectionState>
  for (const s of SECTIONS) out[s.key] = { selected: false, items: [{ content: '', images: [] }] }
  return out
}

export function useFullSet() {
  const message = useMessage()
  const { updateUserInfo } = useUserInfoStore()

  // ---------------- 品牌档案 ----------------
  const profileSource = LL_PROFILE_SOURCE
  const profiles = ref<LLProfileItem[]>([])
  const profilesLoading = ref(false)
  const profilesError = ref(false)
  const profile = ref<BrandProfileView | null>(null)
  const profileLoading = ref(false)

  async function loadProfiles() {
    profilesLoading.value = true
    profilesError.value = false
    try {
      profiles.value = await loadProfileList(profileSource)
    } catch {
      profilesError.value = true
    } finally {
      profilesLoading.value = false
    }
  }

  /** 选档案的请求序号：连点两个档案时只认最后一次的详情 */
  let profileSeq = 0

  async function selectProfile(item: LLProfileItem) {
    const seq = ++profileSeq
    if (item.source === 'go') {
      // Go 店铺档案没有图片、id 也不是 Java 档案 id：只记名字，提交会被禁用
      profile.value = { id: item.id, title: item.title, logoUrl: '', category: '', images: [] }
      profileLoading.value = false
      return
    }
    profileLoading.value = true
    try {
      const res = await brandProfileDetail(item.id)
      if (seq !== profileSeq || !res.data) return
      const prev = profile.value
      const sameProfile = prev?.id === item.id
      profile.value = toBrandProfileView(res.data)
      if (sameProfile) {
        // 同一档案（重选 / 编辑后刷新）：保留已选素材与续跑，只去掉已不在档案里的图
        const urls = new Set(profile.value.images.map((i) => i.url))
        for (const s of SECTIONS) {
          for (const it of sections[s.key].items) {
            if (it.images.some((u) => !urls.has(u))) it.images = it.images.filter((u) => urls.has(u))
          }
        }
      } else {
        // 素材必须来自当前档案：换档案后清空已选素材
        for (const s of SECTIONS) for (const it of sections[s.key].items) it.images = []
        continueFrom.value = null
      }
      // 官方模板只接受与档案同行业：行业变了清掉已选官方模板
      if (prev?.category !== profile.value.category && templates.value[0]?.source === 'system') templates.value = []
      void loadTemplates()
      void loadHistory()
    } catch (err) {
      if (seq !== profileSeq) return
      // 业务失败请求层已 toast 后端文案；传输层失败这里补一条
      const e = toApiError(err)
      if (!e || e.code === -1) message.error('档案加载失败，请重试')
    } finally {
      if (seq === profileSeq) profileLoading.value = false
    }
  }

  // ---------------- 设计模板 ----------------
  const systemTemplates = ref<TemplateCard[]>([])
  const userTemplates = ref<TemplateCard[]>([])
  const templatesLoading = ref(false)
  const templatesError = ref(false)
  /** 已选模板（同一来源；官方 = 多版，自建 = 按图种合并模板图） */
  const templates = ref<TemplateCard[]>([])
  const templateSource = computed<'system' | 'user' | null>(() => templates.value[0]?.source ?? null)

  async function loadTemplates() {
    templatesLoading.value = true
    templatesError.value = false
    try {
      const [sys, mine] = await Promise.all([
        localLifeTemplates({ category: profile.value?.category ?? '' }),
        userLocalLifeTemplates(),
      ])
      systemTemplates.value = (sys.data?.data ?? []).map((t) => ({
        source: 'system',
        id: t.localLifeTemplateId,
        title: t.title,
        cover: overviewUrl(t.payload?.overviewImage),
        coverage: Array.isArray(t.coverage)
          ? t.coverage.map((k) => BIZ_TYPE_TO_KIND[k]).filter((k): k is LLKindKey => !!k)
          : null,
      }))
      userTemplates.value = (mine.data?.data ?? []).map((t) => ({
        source: 'user',
        id: t.userLocalLifeTemplateId,
        title: t.title,
        cover:
          overviewUrl(t.data?.overviewImage ?? t.data?.overview_image) ||
          (SECTIONS.map((s) => userTemplateUrls(t.data, s.key)[0]).find(Boolean) ?? ''),
        data: t.data,
        coverage: SECTIONS.filter((s) => userTemplateUrls(t.data, s.key).length > 0).map((s) => s.key),
      }))
    } catch {
      templatesError.value = true
    } finally {
      templatesLoading.value = false
    }
  }

  // ---------------- 五类图种 ----------------
  const sections = reactive(emptySections())
  const selectedCount = computed(() => SECTIONS.filter((s) => sections[s.key].selected).length)

  // ---------------- 续跑 ----------------
  /** 续跑来源：已成功的历史 id + 它的模式与各图种模板图（自定义模式续跑每图种要带一张） */
  const continueFrom = ref<{ historyId: number; mode: string; templateUrls: KindResults } | null>(null)

  async function startContinue(historyId: number) {
    const res = await localLifeHistory(historyId)
    const payload = res.data?.data?.payload
    continueFrom.value = {
      historyId,
      mode: payload?.mode || 'official',
      templateUrls: (payload?.templateUrls ?? {}) as KindResults,
    }
  }

  // ---------------- 价目 ----------------
  const prices = ref<Partial<Record<LLKindKey, number>>>({})

  async function loadPrices() {
    try {
      const res = await bizPoints()
      const ll = res.data?.localLife ?? {}
      const out: Partial<Record<LLKindKey, number>> = {}
      for (const s of SECTIONS) {
        const p = ll[s.key]?.points
        if (typeof p === 'number') out[s.key] = p
      }
      prices.value = out
    } catch {
      prices.value = {}
    }
  }

  /** 自建模板（custom）某图种上行的模板图：多个自建模板按选择顺序合并、去重，最多 9 张 */
  function customTemplateUrls(kind: LLKindKey): string[] {
    const out: string[] = []
    for (const t of templates.value) {
      for (const url of userTemplateUrls(t.data, kind)) if (!out.includes(url)) out.push(url)
    }
    return out.slice(0, CUSTOM_TEMPLATE_MAX)
  }

  /**
   * 某图种的版数（与 Java CompatV1PricingFactsResolver 同口径）：官方 = 所选模板数；自建 = 该图种模板图数；
   * 续跑 = 上一轮出过的版数（前端不知道，按 1 估）。
   */
  function versionsOf(kind: LLKindKey): number {
    // 续跑：版数沿用上一轮，前端不知道，按 1 估（costLines 标 approx，界面显示「起」）
    if (continueFrom.value) return 1
    if (templateSource.value === 'system') return templates.value.length
    if (templateSource.value === 'user') return customTemplateUrls(kind).length
    return 1
  }

  /**
   * 本地生活按实际资产数计价（与 Java CreaftV1PricingRules.localLifeKey / CompatV1PricingFactsResolver.localLife +
   * V1.0.214 §8 定价行逐项一致）：五连图每张跑完整流水线（ll-five / 带风格 ll-five-style）；其它图种每版第 1 组是锚点
   * （ll-anchor / 带风格 ll-anchor-style），同版其余各组是替换（ll-replace，不分风格）。下表是未打用户等级折扣的原价；
   * 接口 biz-points 报的是打过折的「五连图 / 锚点、不带风格」价，按它与原价的比例折算其余各档（只用于预估，
   * 实扣以提交时后端报价为准）。改价时与迁移一起改。
   */
  const LL_FIVE = 424
  const LL_FIVE_STYLE = 466
  const LL_ANCHOR = 190
  const LL_ANCHOR_STYLE = 232
  const LL_REPLACE = 68

  /** 某图种每版（groupsPerVersion 组）的原价合计：五连图每张同价；其它图种 = 锚点 + (组数 − 1) × 替换。 */
  function listVersionTotalOf(kind: LLKindKey, groupsPerVersion: number, style: boolean): number {
    const g = Math.max(1, groupsPerVersion)
    if (kind === 'fivePanel') return (style ? LL_FIVE_STYLE : LL_FIVE) * g
    return (style ? LL_ANCHOR_STYLE : LL_ANCHOR) + (g - 1) * LL_REPLACE
  }

  /**
   * 每个选中图种的估算 = 每版合计 × 版数（unit 为每张均价，count 为张数，unit × count 即该图种合计）；
   * 推荐菜按所选特色菜图拆组（Java closeupGroups：每张特色菜图一组，没有则整体一组）。
   * 按 biz-points 的折扣比例折算。某图种报不出价 unit 为 undefined。
   */
  const costLines = computed(() =>
    SECTIONS.filter((s) => sections[s.key].selected).map((s) => {
      let groups = s.multiItem ? sections[s.key].items.length : 1
      if (s.key === 'closeupImage') {
        const features = new Set((profile.value?.images ?? []).filter((i) => i.role === 'feature').map((i) => i.url))
        groups = Math.max(1, sections.closeupImage.items[0]?.images.filter((u) => features.has(u)).length ?? 0)
      }
      const quoted = prices.value[s.key]
      const style = !!styleRequirement.value.trim()
      // biz-points 报的是该图种「每版 1 组、不带风格」的价（已含用户等级折扣）：按折扣比例折算实际分档
      const base = listVersionTotalOf(s.key, 1, false)
      const count = groups * Math.max(1, versionsOf(s.key))
      const unit =
        quoted == null ? undefined : Math.ceil((quoted * listVersionTotalOf(s.key, groups, style)) / base / groups)
      return {
        key: s.key,
        title: s.title,
        unit,
        count,
        /** 续跑时版数未知、按 1 版估：实际可能更多 */
        approx: !!continueFrom.value,
      }
    }),
  )
  /** 预计消耗是否只是下限（续跑：版数沿用上一轮，前端不知道） */
  const estimateIsMinimum = computed(() => costLines.value.some((l) => l.approx))
  const estimatedCost = computed<number | null>(() => {
    if (!costLines.value.length || costLines.value.some((l) => l.unit == null)) return null
    return costLines.value.reduce((sum, l) => sum + (l.unit ?? 0) * l.count, 0)
  })

  // ---------------- 历史（该档案的全案产物） ----------------
  const history = ref<BrandProfileAssetRow[]>([])
  /** 该档案的历史总数（页签角标用；列表只取前 20 条） */
  const historyTotal = ref(0)
  const historyLoading = ref(false)
  const historyError = ref(false)
  const deletingHistoryId = ref<number | null>(null)

  /** 写入某档案的历史（只在它仍是当前档案时）；有生成中的行就开始轮询历史，并尝试接管为当前 run */
  function applyHistory(profileId: number, rows: BrandProfileAssetRow[], total?: number) {
    if (profile.value?.id !== profileId) return
    history.value = rows
    historyTotal.value = total ?? rows.length
    adoptRunningRow(profileId, rows)
    if (rows.some((r) => !isLLTerminal(r.status))) startHistoryPoll(profileId)
  }

  /**
   * 加载历史。silent：不转圈、失败不进错误态（删除后静默对齐、轮询用）。
   */
  async function loadHistory(opts: { silent?: boolean } = {}) {
    if (!profile.value || profileSource !== 'java') return
    const id = profile.value.id
    if (!opts.silent) {
      historyLoading.value = true
      historyError.value = false
    }
    try {
      const res = await brandProfileAssets(id, 1, 20)
      applyHistory(id, res.data?.data ?? [], res.data?.total)
    } catch {
      if (!opts.silent && profile.value?.id === id) historyError.value = true
    } finally {
      if (!opts.silent) historyLoading.value = false
    }
  }

  // 历史里有生成中的行：每 5s 刷新历史，全部终态 / 换档案 / 卸载即停
  let historyPollProfileId: number | null = null
  const historyPoll = usePollingWhile(
    () => brandProfileAssets(historyPollProfileId as number, 1, 20),
    (page) => {
      const id = historyPollProfileId
      if (id == null || profile.value?.id !== id) return false
      const rows = page?.data ?? []
      history.value = rows
      historyTotal.value = page?.total ?? rows.length
      const keep = rows.some((r) => !isLLTerminal(r.status))
      if (!keep) historyPollProfileId = null
      return keep
    },
    5000,
  )
  function startHistoryPoll(profileId: number) {
    if (historyPollProfileId !== profileId) {
      historyPoll.stop()
      historyPollProfileId = profileId
    }
    historyPoll.start()
  }
  function stopHistoryPoll() {
    historyPoll.stop()
    historyPollProfileId = null
  }

  /** 删除一条历史：Java 校验归属，仍在生成中会拒绝（deleteWithBody 不自动 toast，这里提示） */
  async function deleteHistory(historyId: number): Promise<boolean> {
    if (deletingHistoryId.value != null) return false
    deletingHistoryId.value = historyId
    try {
      await deleteLocalLifeHistories([historyId])
      history.value = history.value.filter((r) => r.workflowHistoryId !== historyId)
      historyTotal.value = Math.max(0, historyTotal.value - 1)
      if (continueFrom.value?.historyId === historyId) continueFrom.value = null
      message.success('已删除')
      // 乐观移除后静默对齐（补上第 21 条、校正总数）
      void loadHistory({ silent: true })
      return true
    } catch (err) {
      message.error(toApiError(err)?.message || '删除失败，请重试')
      return false
    } finally {
      deletingHistoryId.value = null
    }
  }

  // ---------------- 整体设计要求 ----------------
  const requirement = ref('')
  const styleRequirement = ref('')

  // ---------------- 提交与轮询 ----------------
  const submitting = ref(false)
  /** 当前这次生成：历史 id、状态、按图种的产物 */
  const run = ref<LLRun | null>(null)
  const idem = useIdempotentSubmit()
  idem.bindForm(sections, templates, profile, continueFrom, requirement, styleRequirement)

  /** 到终态后按提交时的档案取产物：行没出来或请求失败退避重试，仍没有就挂提示 */
  async function fetchRunResults(current: LLRun) {
    for (let attempt = 0; attempt <= RESULT_RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) await sleep(RESULT_RETRY_DELAYS[attempt - 1]!)
      if (run.value !== current) return
      try {
        const res = await brandProfileAssets(current.profileId, 1, 20)
        if (run.value !== current) return
        const rows = res.data?.data ?? []
        // 历史只在仍是同一档案时写回
        if (profile.value?.id === current.profileId) {
          history.value = rows
          historyTotal.value = res.data?.total ?? rows.length
        }
        const row = rows.find((r) => r.workflowHistoryId === current.historyId)
        if (row) {
          current.results = rowResults(row)
          current.closeupGroups = rowCloseupGroups(row)
          current.notice = undefined
          return
        }
      } catch {
        // 退避后再试
      }
    }
    if (run.value === current) current.notice = RESULT_LATE_NOTICE
  }

  async function pollRound(): Promise<PollRoundResult> {
    const current = run.value
    if (!current) return { done: true }
    let h: LocalLifeHistory | undefined
    try {
      h = (await localLifeHistory(current.historyId)).data
    } catch (err) {
      const e = toApiError(err)
      return { done: false, failure: !e || e.isNetwork ? 'network' : 'system' }
    }
    if (!h || run.value !== current) return { done: true }
    current.status = h.status
    if (!isLLTerminal(h.status)) return { done: false }
    current.error = h.data?.result?.error ?? undefined
    // 到终态（扣点 / 退点）刷一次点数
    updateUserInfo()
    await fetchRunResults(current)
    return { done: true }
  }

  /**
   * 打开档案时：没有进行中的 run、历史里有生成中的行，就把最新那条接成当前 run
   * （刷新页面后也能禁止重复提交、预览跟着它）。菜名映射不知道，不配。
   */
  function adoptRunningRow(profileId: number, rows: BrandProfileAssetRow[]) {
    if (run.value && !isLLTerminal(run.value.status)) return
    const row = rows.find((r) => !isLLTerminal(r.status))
    if (!row) return
    run.value = { historyId: row.workflowHistoryId, profileId, status: row.status, results: {} }
    poller.retry()
  }

  const poller = useStudioPolling(pollRound, { interval: 3000 })

  // 浏览器离线 或 轮询连续网络失败暂停：显示「网络异常，已暂停轮询」
  const browserOffline = ref(false)
  const syncOnline = () => {
    browserOffline.value = navigator.onLine === false
  }
  onMounted(() => {
    syncOnline()
    window.addEventListener('online', syncOnline)
    window.addEventListener('offline', syncOnline)
  })
  onUnmounted(() => {
    window.removeEventListener('online', syncOnline)
    window.removeEventListener('offline', syncOnline)
  })
  const offline = computed(() => !!run.value && (browserOffline.value || poller.offline.value))

  const running = computed(() => !!run.value && !isLLTerminal(run.value.status))
  const runNotice = computed(() => run.value?.notice ?? '')

  /** 某条是否填了东西（设计要求或素材） */
  const itemFilled = (it: SectionItem) => !!it.content.trim() || it.images.length > 0

  /**
   * 提交前校验；返回第一条问题（原型闸门顺序：档案 → 模板 → 图种 → 内容条目，再补 Java 会拒的素材 / 模板覆盖 / 推荐菜规则）。
   * 底栏按钮不置灰，点了 toast 这条；计费 ⓘ 里也红字显示它。
   */
  function validate(): string | null {
    if (!profile.value) return '请先选择品牌档案'
    if (profileSource !== 'java') return '全案生成需要使用品牌档案（当前档案来源不支持全案提交）'
    if (!continueFrom.value && !templates.value.length) return '请先选择设计模板'
    return validateContent()
  }

  /** 「配置全案需求」这一步的问题（四步条第 3 步以它为准，与提交校验同一套规则） */
  function validateContent(): string | null {
    if (!selectedCount.value) return '请至少勾选一种图片类型'
    for (const s of SECTIONS) {
      const st = sections[s.key]
      if (st.selected && !st.items.some(itemFilled)) return '请给已选类型添加内容条目'
    }
    for (const s of SECTIONS) {
      const st = sections[s.key]
      if (!st.selected) continue
      const missing = st.items.findIndex((it) => !it.images.length)
      if (missing >= 0) return `${s.title} ${missing + 1}：设计素材不能为空`
      if (s.key === 'closeupImage') {
        const features = new Set((profile.value?.images ?? []).filter((i) => i.role === 'feature').map((i) => i.url))
        if (!st.items[0]!.images.some((u) => features.has(u))) return '推荐菜至少需要一张特色菜图片'
      }
      const cont = continueFrom.value
      if (cont) {
        // 自定义模式续跑：每个图种要沿用上一轮的模板图，上一轮没有的图种 Java 会拒
        if (cont.mode === 'custom' && !cont.templateUrls[s.key]?.length) {
          return `上一轮没有${s.title}的模板图，继续生成时请取消勾选${s.title}`
        }
        continue
      }
      // 模板覆盖：官方模板缺该图种模板图 / 自建模板该图种没有模板图，Java 都会拒
      if (templateSource.value === 'system') {
        const lacking = templates.value.find((t) => t.coverage && !t.coverage.includes(s.key))
        if (lacking) return `模板「${lacking.title}」不含${s.title}，请换模板或取消勾选${s.title}`
      } else if (templateSource.value === 'user' && !customTemplateUrls(s.key).length) {
        return `所选自定义模板没有${s.title}的模板图，请换模板或取消勾选${s.title}`
      }
    }
    return null
  }
  const blockReason = computed(() => validate())
  const contentBlockReason = computed(() => validateContent())

  function buildBody(): LocalLifeSubmitBody {
    const body: LocalLifeSubmitBody = {}
    const cont = continueFrom.value
    const custom = cont ? cont.mode === 'custom' : templateSource.value === 'user'
    const templateUrlsOf = (key: LLKindKey): string[] | undefined => {
      if (!custom) return undefined
      // 续跑：每个自定义图种只能给一张模板图（沿用上一轮的第一张）
      if (cont) return cont.templateUrls[key]?.slice(0, 1)
      return customTemplateUrls(key)
    }
    for (const s of SECTIONS) {
      const st = sections[s.key]
      if (!st.selected) continue
      if (s.key === 'closeupImage') {
        const it = st.items[0]!
        body.closeupImage = {
          content: it.content.trim() || undefined,
          imageUrls: [...it.images],
          templateUrls: templateUrlsOf(s.key),
        }
      } else {
        body[s.key as Exclude<LLKindKey, 'closeupImage'>] = {
          templateUrls: templateUrlsOf(s.key),
          groups: st.items.map((it, index) => ({
            content: it.content.trim() || undefined,
            imageUrls: [...it.images],
            index,
          })),
        }
      }
    }
    if (cont) {
      body.workflowHistoryId = cont.historyId
    } else {
      body.brandProfileId = profile.value!.id
      const content = requirement.value.trim()
      const style = styleRequirement.value.trim()
      if (content) body.content = content.slice(0, REQUIREMENT_MAX_LENGTH)
      if (style) body.style = style.slice(0, REQUIREMENT_MAX_LENGTH)
      if (templateSource.value === 'user') body.mode = 'custom'
      else if (templateSource.value === 'system') {
        body.mode = 'official'
        body.templateIds = templates.value.map((t) => t.id).slice(0, 9)
      }
    }
    return body
  }

  async function submit() {
    if (submitting.value || running.value) return
    const problem = validate()
    if (problem) {
      message.warning(problem)
      return
    }
    submitting.value = true
    const key = idem.take()
    // 提交时记下档案与推荐菜组 → 菜名（组号 = 所选特色菜图的序号，与 Java closeupGroups 同口径）
    const submittedProfileId = profile.value!.id
    let closeupNames: (string | undefined)[] | undefined
    if (sections.closeupImage.selected) {
      const byUrl = new Map(
        (profile.value?.images ?? []).filter((i) => i.role === 'feature').map((i) => [i.url, i.name] as const),
      )
      closeupNames = (sections.closeupImage.items[0]?.images ?? []).filter((u) => byUrl.has(u)).map((u) => byUrl.get(u))
    }
    try {
      const body = buildBody()
      const res = continueFrom.value ? await continueLocalLife(body, key) : await submitLocalLife(body, key)
      idem.settle()
      const historyId = res.data?.workflowHistoryIds?.[0]
      updateUserInfo()
      if (!historyId) {
        void loadHistory()
        return
      }
      continueFrom.value = null
      run.value = { historyId, profileId: submittedProfileId, status: 'PENDING', results: {}, closeupNames }
      poller.retry()
      // 新记录立刻出现在历史里（生成中的行会带起历史轮询）
      void loadHistory({ silent: true })
    } catch (err) {
      idem.fail(err)
      const e = toApiError(err)
      // 点数不足 / 权益过期：弹与创作页同一个引导购买框（请求层已对非白名单接口 toast 了后端 msg）
      if (e && BILLING_BLOCK_CODES.has(e.code)) emitBillingBlock(e.code)
    } finally {
      submitting.value = false
    }
  }

  // 档案切换时，当前生成的预览不再属于它；历史轮询跟着停
  watch(
    () => profile.value?.id,
    (id) => {
      if (run.value && isLLTerminal(run.value.status) && run.value.profileId !== id) run.value = null
      if (historyPollProfileId != null && historyPollProfileId !== id) stopHistoryPoll()
    },
  )

  onMounted(() => {
    void loadProfiles()
    void loadTemplates()
    void loadPrices()
  })

  return {
    profileSource,
    profiles,
    profilesLoading,
    profilesError,
    loadProfiles,
    profile,
    profileLoading,
    selectProfile,
    systemTemplates,
    userTemplates,
    templatesLoading,
    templatesError,
    loadTemplates,
    templates,
    templateSource,
    sections,
    selectedCount,
    continueFrom,
    startContinue,
    prices,
    costLines,
    estimatedCost,
    estimateIsMinimum,
    history,
    historyTotal,
    deleteHistory,
    deletingHistoryId,
    requirement,
    styleRequirement,
    blockReason,
    contentBlockReason,
    historyLoading,
    historyError,
    loadHistory,
    submitting,
    running,
    run,
    runNotice,
    retrying: idem.retrying,
    submit,
    offline,
    retryPolling: poller.retry,
  }
}
