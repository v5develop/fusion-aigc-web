/**
 * 全案设计（/local-life 入口页）的状态与接口编排。
 *
 * <p>数据源：品牌档案按 api/localLifeFull.ts 的 LL_PROFILE_SOURCE（默认 Java brand-profiles）；
 * 模板 = 官方 local-life-templates（按档案行业过滤）+ 我的 user-local-life-templates；
 * 提交 = POST /api/v1/workflows/local-life（官方模板 official / 自建模板 custom），
 * 续跑 = POST /api/v1/workflows/local-life/continue（workflowHistoryId）。
 *
 * <p>轮询复用商拍工作室的 useStudioPolling（可见 3s、隐藏降频、失败退避、连续 3 次网络失败暂停 offline），
 * 间隔与工作流页 useWorkflowHistory 一致取 3s。到终态后从 /brand-profiles/{id}/assets 取按图种分好的产物。
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import {
  BIZ_TYPE_TO_KIND,
  LL_PROFILE_SOURCE,
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
} from '@/api/localLifeFull.ts'
import { useIdempotentSubmit, useStudioPolling, type PollRoundResult } from '@/views/studio/hooks.ts'
import { useUserInfoStore } from '@/stores/userInfo.ts'
import { BILLING_BLOCK_CODES, emitBillingBlock } from '@/utils/billingGuide'

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

  async function selectProfile(item: LLProfileItem) {
    if (item.source === 'go') {
      // Go 店铺档案没有图片、id 也不是 Java 档案 id：只记名字，提交会被禁用
      profile.value = { id: item.id, title: item.title, logoUrl: '', category: '', images: [] }
      return
    }
    profileLoading.value = true
    try {
      const res = await brandProfileDetail(item.id)
      if (!res.data) return
      const prevCategory = profile.value?.category
      profile.value = toBrandProfileView(res.data)
      // 素材必须来自当前档案：换档案后清空已选素材
      for (const s of SECTIONS) for (const it of sections[s.key].items) it.images = []
      continueFrom.value = null
      if (prevCategory !== profile.value.category && template.value?.source === 'system') template.value = null
      void loadTemplates()
      void loadHistory()
    } finally {
      profileLoading.value = false
    }
  }

  // ---------------- 设计模板 ----------------
  const systemTemplates = ref<TemplateCard[]>([])
  const userTemplates = ref<TemplateCard[]>([])
  const templatesLoading = ref(false)
  const templatesError = ref(false)
  const template = ref<TemplateCard | null>(null)

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
      }))
      userTemplates.value = (mine.data?.data ?? []).map((t) => ({
        source: 'user',
        id: t.userLocalLifeTemplateId,
        title: t.title,
        cover: overviewUrl(t.data?.overviewImage ?? t.data?.overview_image),
        data: t.data,
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

  /** 版数：官方模板 1 个模板 = 1 版；自建模板（custom）= 各图种模板图数的最大值 */
  const versions = computed(() => {
    const t = template.value
    if (!t || t.source === 'system') return 1
    return Math.max(
      1,
      ...SECTIONS.filter((s) => sections[s.key].selected).map((s) => userTemplateUrls(t.data, s.key).length),
    )
  })

  /** 每个选中图种的张数估算 = 单价 × 组数 × 版数；某图种报不出价返回 null（保持原文案） */
  const costLines = computed(() =>
    SECTIONS.filter((s) => sections[s.key].selected).map((s) => {
      const groups = s.multiItem ? sections[s.key].items.length : 1
      const unit = prices.value[s.key]
      return { key: s.key, title: s.title, unit, count: groups * versions.value }
    }),
  )
  const estimatedCost = computed<number | null>(() => {
    if (!costLines.value.length || costLines.value.some((l) => l.unit == null)) return null
    return costLines.value.reduce((sum, l) => sum + (l.unit ?? 0) * l.count, 0)
  })

  // ---------------- 历史（该档案的全案产物） ----------------
  const history = ref<BrandProfileAssetRow[]>([])
  const historyLoading = ref(false)
  const historyError = ref(false)

  async function loadHistory() {
    if (!profile.value || profileSource !== 'java') return
    const id = profile.value.id
    historyLoading.value = true
    historyError.value = false
    try {
      const res = await brandProfileAssets(id, 1, 20)
      if (profile.value?.id === id) history.value = res.data?.data ?? []
    } catch {
      historyError.value = true
    } finally {
      historyLoading.value = false
    }
  }

  // ---------------- 提交与轮询 ----------------
  const submitting = ref(false)
  /** 当前这次生成：历史 id、状态、按图种的产物 */
  const run = ref<{ historyId: number; status: string; error?: string; results: KindResults } | null>(null)
  const idem = useIdempotentSubmit()
  idem.bindForm(sections, template, profile, continueFrom)

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
    if (!h || run.value?.historyId !== current.historyId) return { done: true }
    current.status = h.status
    if (!isLLTerminal(h.status)) return { done: false }
    current.error = h.data?.result?.error ?? undefined
    if (profile.value) {
      try {
        const res = await brandProfileAssets(profile.value.id, 1, 20)
        history.value = res.data?.data ?? []
        current.results = rowResults(history.value.find((r) => r.workflowHistoryId === current.historyId))
      } catch {
        // 产物取不到不影响终态判定；历史页签可手动刷新
      }
    }
    // 到终态（扣点 / 退点）刷一次积分
    updateUserInfo()
    return { done: true }
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

  /** 提交前校验；返回第一条问题（文案沿用页面与后端已有用语） */
  function validate(): string | null {
    if (!profile.value) return '点击选择品牌档案'
    if (profileSource !== 'java') return '全案生成需要使用品牌档案'
    if (!continueFrom.value && !template.value) return '选择设计模板'
    if (!selectedCount.value) return '选择本次需要制作的内容'
    for (const s of SECTIONS) {
      const st = sections[s.key]
      if (!st.selected) continue
      const missing = st.items.findIndex((it) => !it.images.length)
      if (missing >= 0) return `${s.title} ${missing + 1}：设计素材不能为空`
      if (s.key === 'closeupImage') {
        const features = new Set(profile.value.images.filter((i) => i.role === 'feature').map((i) => i.url))
        if (!st.items[0]!.images.some((u) => features.has(u))) return '推荐菜至少需要一张特色菜图片'
      }
    }
    return null
  }

  function buildBody(): LocalLifeSubmitBody {
    const body: LocalLifeSubmitBody = {}
    const t = template.value
    const cont = continueFrom.value
    const custom = cont ? cont.mode === 'custom' : t?.source === 'user'
    const templateUrlsOf = (key: LLKindKey): string[] | undefined => {
      if (!custom) return undefined
      // 续跑：每个自定义图种只能给一张模板图（沿用上一轮的第一张）
      if (cont) return cont.templateUrls[key]?.slice(0, 1)
      return userTemplateUrls(t?.data, key).slice(0, 9)
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
      if (t?.source === 'user') body.mode = 'custom'
      else if (t) {
        body.mode = 'official'
        body.templateIds = [t.id]
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
      run.value = { historyId, status: 'PENDING', results: {} }
      poller.retry()
    } catch (err) {
      idem.fail(err)
      const e = toApiError(err)
      // 点数不足 / 权益过期：弹与创作页同一个引导购买框（请求层已对非白名单接口 toast 了后端 msg）
      if (e && BILLING_BLOCK_CODES.has(e.code)) emitBillingBlock(e.code)
    } finally {
      submitting.value = false
    }
  }

  // 档案切换时，当前生成的预览不再属于它
  watch(
    () => profile.value?.id,
    () => {
      if (run.value && isLLTerminal(run.value.status)) run.value = null
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
    template,
    sections,
    selectedCount,
    continueFrom,
    startContinue,
    prices,
    costLines,
    estimatedCost,
    history,
    historyLoading,
    historyError,
    loadHistory,
    submitting,
    running,
    run,
    retrying: idem.retrying,
    submit,
    offline,
    retryPolling: poller.retry,
  }
}
