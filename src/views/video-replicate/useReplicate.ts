/**
 * 视频做同款页的状态与动作：上传 → 解析（轮询）→ 方案（首张 POST /plans，之后每次编辑 PATCH /plans/{no}/annotations 出新方案）→ 确认（先做第 1 段 / 全部）→ 生成（轮询）→ 结果。
 * 另有两条入口：示例（GET /samples → try，0 点看懂 + 示例成片，再用 sampleId 出你自己的方案）、我的方案（保存 / 列表 / 用它做一条 = reuse）。
 * 页面组件只读状态、调动作；接口与 mock 都在 api/replicate.ts（契约：fusion_aigc_go/docs/api/api-replicate.md）。
 * 点数、文案、状态全部取后端字段，不在这里拼接或估算。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { toApiError } from '@/api/index.ts'
import { getPointsBalance } from '@/api/points.ts'
import { isMock } from '@/api/mock-switch.ts'
import { upload } from '@/api/oss-upload.ts'
import { goUploadImage } from '@/api/go-upload.ts'
import { useIndustry } from '@/views/agent/industry/useIndustry.ts'
import {
  REPLICATE_DEFAULT_MODEL_GROUP,
  replicateConfirm,
  replicateContinue,
  replicateCreatePlan,
  replicateErrorText,
  replicateGaps,
  replicateGetAnalysis,
  replicateGetJob,
  replicateGetPlan,
  replicateLimits,
  replicateListSamples,
  replicateNotReady,
  replicatePatchAnnotations,
  replicatePutPref,
  replicateQuote,
  replicateRedoSegment,
  replicateReuseSavedPlan,
  replicateSavePlan,
  replicateSourceGone,
  replicateStartAnalysis,
  replicateStop,
  replicateCancelRest,
  replicateModels,
  type ReplicateContinuity,
  type ReplicateModel,
  replicateTrySample,
  urlExpiringSoon,
  type ReplicateAnalysis,
  type ReplicateAnnotations,
  type ReplicateAudio,
  type ReplicateDimEdit,
  type ReplicateGap,
  type ReplicateJob,
  type ReplicateLimits,
  type ReplicatePatchAnnotationsRequest,
  type ReplicatePlan,
  type ReplicateSample,
  type ReplicateSampleTry,
  type ReplicateSavedPlan,
  type ReplicateTextOverlay,
  type VideoCloneDimKey,
  REPLICATE_OFF_TEXT,
  REPLICATE_PAUSED_TEXT,
} from '@/api/replicate.ts'
import { DIM_LABEL, DIM_SLOT, INTENTS, MISSING_SLOT_TEXT, SLOTS, type SlotKey } from './constants.ts'

export type Step = 'start' | 'analyzing' | 'plan' | 'job'
export type Tab = 'new' | 'hist' | 'saved'
export type DimMode = 'keep' | 'replace' | 'describe'

const POLL_ANALYSIS = 2500
const POLL_JOB = 3000
const VIDEO_EXT = /\.(mp4|mov|webm)$/i
/** Go 没有给出源视频大小上限（limits 里没有）：沿用体验文档的 300MB */
const MAX_SIZE_MB = 300
/** 没有选任何要换的地方时的提示（同 Go 的 NOTHING_CHANGED 文案；本地短路，不白跑一次请求） */
const NOTHING_CHANGED_TEXT = '勾出你想换的地方，没勾的保持原样'

export interface SlotImage {
  /** 显示用地址（保存的方案里是现签地址） */
  url: string
  name: string
  /** 从保存的方案带回的图：提交时传 `mr://rid`（现签地址不能当输入） */
  rid?: string
}

export function useReplicate() {
  const step = ref<Step>('start')
  /** 页头二级导航：新建 / 历史 / 我的方案 */
  const tab = ref<Tab>('new')
  const limits = ref<ReplicateLimits | null>(null)
  /** 不接新提交：总开关关着（limits.enabled=false）或模块没装配（limits 也回 7003）。页头提示、禁用提交入口 */
  const notReady = ref(false)
  /** 页头那句：总开关关着 = 暂停新提交（历史照常）；模块没装配 = 暂未开放 */
  const notReadyText = ref(REPLICATE_PAUSED_TEXT)

  // ---- 1 原视频与素材 ----
  const source = reactive({
    name: '',
    url: '',
    durationSec: 0,
    sizeMb: 0,
    uploading: false,
    /** 上传进度 0~1（仅大文件分片上传有细粒度值，0 = 未知，界面用不确定动画） */
    progress: 0,
    error: '',
    notice: '',
  })
  const slots = reactive<Record<SlotKey, SlotImage | null>>({ person: null, product: null, garment: null, scene: null })
  const slotBusy = reactive<Record<SlotKey, boolean>>({ person: false, product: false, garment: false, scene: false })
  const slotError = reactive<Record<SlotKey, string>>({ person: '', product: '', garment: '', scene: '' })
  const text = reactive({ shopName: '', phone: '' })

  async function loadLimits() {
    try {
      const res = await replicateLimits()
      limits.value = res.data ?? null
      notReady.value = res.data?.enabled === false
      notReadyText.value = REPLICATE_PAUSED_TEXT
    } catch (err) {
      limits.value = null
      notReady.value = replicateNotReady(err)
      notReadyText.value = REPLICATE_OFF_TEXT
    }
  }

  function readVideoMetaUrl(url: string): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => resolve(v.duration || 0)
      v.onerror = () => resolve(0)
      v.src = url
    })
  }

  function readVideoMeta(file: File): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video')
      const u = URL.createObjectURL(file)
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(u)
        resolve(v.duration || 0)
      }
      v.onerror = () => {
        URL.revokeObjectURL(u)
        resolve(0)
      }
      v.src = u
    })
  }

  /** 选了视频：本地校验（格式 / 大小 / 时长，文案取自上传校验表），通过后上传 */
  async function pickVideo(file: File) {
    source.error = ''
    source.notice = ''
    const maxMb = MAX_SIZE_MB
    const maxSec = limits.value?.maxDurationSec ?? 80
    if (!VIDEO_EXT.test(file.name) && !/^video\/(mp4|quicktime|webm)$/.test(file.type)) {
      source.error = '这个文件格式暂时不支持，请用 MP4、MOV 或 WebM'
      return
    }
    const mb = file.size / 1024 / 1024
    if (mb > maxMb) {
      source.error = `这个视频有 ${Math.round(mb)}MB，超过了 ${maxMb}MB。可以在手机相册里选「较小尺寸」导出，或用剪辑软件压缩后再传`
      return
    }
    const dur = await readVideoMeta(file)
    if (dur > maxSec) {
      const m = Math.floor(dur / 60)
      const s = Math.round(dur % 60)
      source.error = `这条视频有 ${m ? `${m} 分 ` : ''}${s} 秒，单次最长支持 ${maxSec} 秒。可以先剪出最精彩的一段（比如开头 ${maxSec} 秒内），再上传`
      return
    }
    const minGen = limits.value?.specMinSec ?? 4
    if (dur > 0 && dur < minGen) {
      source.notice = `原视频只有 ${Math.round(dur)} 秒，生成最短按 ${minGen} 秒计，会比原片多 ${Math.round(minGen - dur)} 秒`
    }
    source.name = file.name
    source.durationSec = dur
    source.sizeMb = Math.round(mb)
    source.uploading = true
    source.progress = 0
    try {
      if (isMock('replicate')) {
        await new Promise((r) => setTimeout(r, 900))
        source.url = URL.createObjectURL(file)
      } else {
        const urls = await upload([file], undefined, { compress: false, onProgress: (f) => (source.progress = f) })
        source.url = String(urls[0] ?? '')
        if (!source.url) throw new Error('empty')
      }
    } catch {
      source.url = ''
      source.error = '上传中断了（网络不稳）。点「重试」从刚才的位置继续'
    } finally {
      source.uploading = false
    }
  }

  /** 从资产库选视频：时长用 metadata 读（资产没有时长字段），其余校验与上传路径一致；不再上传，地址直接用资产的 */
  async function pickSourceAsset(url: string, name: string) {
    source.error = ''
    source.notice = ''
    const dur = await readVideoMetaUrl(url)
    const maxSec = limits.value?.maxDurationSec ?? 80
    if (dur > maxSec) {
      const m = Math.floor(dur / 60)
      const s = Math.round(dur % 60)
      source.error = `这条视频有 ${m ? `${m} 分 ` : ''}${s} 秒，单次最长支持 ${maxSec} 秒。可以换一段更短的视频`
      return
    }
    const minGen = limits.value?.specMinSec ?? 4
    if (dur > 0 && dur < minGen) {
      source.notice = `原视频只有 ${Math.round(dur)} 秒，生成最短按 ${minGen} 秒计，会比原片多 ${Math.round(minGen - dur)} 秒`
    }
    source.name = name
    source.durationSec = dur
    source.sizeMb = 0
    source.url = url
  }

  function clearSource() {
    source.name = ''
    source.url = ''
    source.error = ''
    source.notice = ''
    source.durationSec = 0
  }

  async function pickSlotImage(k: SlotKey, file: File) {
    slotError[k] = ''
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      slotError[k] = '支持 JPG、PNG、WebP 格式的图片'
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      slotError[k] = '图片超过 10MB，换一张小一点的'
      return
    }
    slotBusy[k] = true
    try {
      const url = isMock('replicate') ? URL.createObjectURL(file) : await goUploadImage(file)
      slots[k] = { url, name: file.name }
    } catch {
      slotError[k] = '图片没传上去，请重新上传'
    } finally {
      slotBusy[k] = false
    }
  }

  /** 从资产库选图：资产地址直接作为参考图（不重新上传） */
  function pickSlotAsset(k: SlotKey, url: string, name: string) {
    slotError[k] = ''
    slots[k] = { url, name }
  }

  function clearSlot(k: SlotKey) {
    slots[k] = null
  }

  // ---- 1b 示例（GET /samples → POST /samples/{id}/try：不花点数、不计限频） ----
  const industry = useIndustry()
  const samples = ref<ReplicateSample[]>([])
  const samplesLoading = ref(false)
  const sampleTry = ref<ReplicateSampleTry | null>(null)
  /** 正在载入的示例 id */
  const sampleTryBusy = ref<number | null>(null)
  const sampleError = ref('')
  /** 当前方案用的是哪个示例（null = 你自己的原片） */
  const sampleId = ref<number | null>(null)
  const sampleTitle = ref('')
  let samplesSeq = 0

  /** 按当前行业取示例；取不到（失败 / 没有）就不显示这一块，不编造 */
  async function loadSamples() {
    const s = ++samplesSeq
    samplesLoading.value = true
    try {
      const code = industry.current.value?.code
      const res = await replicateListSamples(code ? { industry: code } : {})
      if (s === samplesSeq) samples.value = res.data?.items ?? []
    } catch {
      if (s === samplesSeq) samples.value = []
    } finally {
      if (s === samplesSeq) samplesLoading.value = false
    }
  }

  /** 进页：先拿当前行业（取不到就不传 industry），再取示例；行业变了重取 */
  async function initSamples() {
    try {
      await industry.load()
    } catch {
      // 行业取不到：不传 industry，取全部示例
    }
    await loadSamples()
  }
  watch(
    () => industry.current.value?.code,
    (c, old) => {
      if (c !== old && !industry.loading.value) void loadSamples()
    },
  )

  async function trySample(id: number) {
    if (sampleTryBusy.value != null) return
    sampleTryBusy.value = id
    sampleError.value = ''
    try {
      const res = await replicateTrySample(id)
      sampleTry.value = res.data ?? null
      if (!res.data) sampleError.value = '示例没打开，再点一次试试'
    } catch (err) {
      sampleError.value = toApiError(err)?.isNetwork
        ? '网络不稳，示例没打开，再点一次试试'
        : replicateErrorText(err, { fallback: '示例没打开，再点一次试试' })
    } finally {
      sampleTryBusy.value = null
    }
  }

  function closeSample() {
    sampleTry.value = null
    sampleError.value = ''
  }

  // ---- 2 解析 ----
  const analysis = ref<ReplicateAnalysis | null>(null)
  const analysisError = ref('')
  const analysisRetryable = ref(false)
  let anaTimer: ReturnType<typeof setTimeout> | undefined
  let anaSeq = 0

  const canAnalyze = computed(() => !source.uploading && !!source.url && !notReady.value)
  /** 已用时：后端给 elapsedS，页面只显示 */
  const analysisElapsed = computed(() => analysis.value?.elapsedS ?? 0)

  function stopAnalysisTimers() {
    clearTimeout(anaTimer)
  }

  async function startAnalysis() {
    if (!canAnalyze.value) return
    const s = ++anaSeq
    analysis.value = null
    analysisError.value = ''
    analysisRetryable.value = false
    step.value = 'analyzing'
    stopAnalysisTimers()
    try {
      const res = await replicateStartAnalysis({ sourceUrl: source.url })
      if (s !== anaSeq) return
      handleAnalysis(res.data, s)
    } catch (err) {
      if (s !== anaSeq) return
      failAnalysis(replicateErrorText(err, { write: true, fallback: '服务暂时忙，没有扣点数。请稍后重试' }), true)
    }
  }

  function failAnalysis(msg: string, retryable: boolean) {
    stopAnalysisTimers()
    analysisError.value = msg || '分析没成功，重新试一次通常能解决'
    analysisRetryable.value = retryable
  }

  function handleAnalysis(a: ReplicateAnalysis | null | undefined, s: number) {
    if (!a) return failAnalysis('', true)
    analysis.value = a
    if (a.status === 'succeeded') {
      stopAnalysisTimers()
      if (pendingReuse.value) void reuseWithAnalysis(a.analysisNo)
      else void enterPlan()
      return
    }
    // 失败：error 是可直接给用户看的原因；同一原片再 POST 一次会原地重启（Go：失败的重新开始）
    if (a.status === 'failed') return failAnalysis(a.error || '', true)
    anaTimer = setTimeout(async () => {
      try {
        const res = await replicateGetAnalysis(a.analysisNo)
        if (s === anaSeq) handleAnalysis(res.data, s)
      } catch (err) {
        // 轮询偶发失败不打断：下一轮再试；业务级失败（不属于本人 / 不存在）才停
        if (s !== anaSeq) return
        if (toApiError(err)?.isNetwork) anaTimer = setTimeout(() => handleAnalysis(a, s), POLL_ANALYSIS)
        else failAnalysis(replicateErrorText(err), false)
      }
    }, POLL_ANALYSIS)
  }

  function cancelAnalysis() {
    anaSeq++
    stopAnalysisTimers()
    analysis.value = null
    analysisError.value = ''
    step.value = 'start'
  }

  // ---- 3 方案 ----
  const marks = reactive<Partial<Record<VideoCloneDimKey, { mode: DimMode; note: string }>>>({})
  // revoice（换声音）只在对话里设置音色 / 台词；独立页能显示和保留它，但不提供编辑（选项里只在当前就是 revoice 时出现）
  const audio = ref<ReplicateAudio>('regenerate')
  const consent = ref(false)
  const stage = ref<'first' | 'all'>('first')
  const plan = ref<ReplicatePlan | null>(null)
  const planBusy = ref(false)
  const planError = ref('')
  /** 服务端校验没通过的缺项（code=1003 + data.gaps）：不生成方案，不占次数 */
  const planGaps = ref<ReplicateGap[]>([])
  const balance = ref<number | null>(null)
  const submitting = ref(false)
  const submitError = ref('')

  /** 从保存的方案直接用（没有分析结果）时，「视频里的这些地方」取方案里的改什么 / 不改什么 */
  const planDims = ref<{ key: VideoCloneDimKey; label: string; present: boolean; now: string }[]>([])
  /** 「看懂了」那句：分析结果优先，没有时用方案里带的概述 */
  const planSummary = ref('')
  const summaryText = computed(() => analysis.value?.result?.summary || planSummary.value)

  /** 解析里的各项，按 dimOrder 排；画面里没有的置灰不给改 */
  const dims = computed(() => {
    const r = analysis.value?.result
    if (!r?.dims) return planDims.value
    const order = (r.dimOrder?.length ? r.dimOrder : Object.keys(r.dims)) as VideoCloneDimKey[]
    return order
      .filter((k) => DIM_LABEL[k] && r.dims[k])
      .map((k) => ({ key: k, label: DIM_LABEL[k], present: !!r.dims[k]!.present, now: r.dims[k]!.desc ?? '' }))
  })
  const intentOn = (i: (typeof INTENTS)[number]) => i.dims.every((k) => marks[k]?.mode === 'replace')
  const dimPresent = (k: VideoCloneDimKey) => dims.value.some((d) => d.key === k && d.present)
  const changedCount = computed(() => Object.values(marks).filter((m) => m && m.mode !== 'keep').length)
  const markOf = (k: VideoCloneDimKey) => marks[k] ?? { mode: 'keep' as DimMode, note: '' }

  function setMode(k: VideoCloneDimKey, mode: DimMode) {
    marks[k] = { mode, note: marks[k]?.note ?? '' }
  }
  function setNote(k: VideoCloneDimKey, note: string) {
    marks[k] = { mode: marks[k]?.mode ?? 'describe', note }
  }
  function toggleIntent(i: (typeof INTENTS)[number]) {
    const on = intentOn(i)
    for (const k of i.dims) {
      if (!dimPresent(k)) continue
      setMode(k, on ? 'keep' : 'replace')
    }
  }
  function resetMarks() {
    for (const k of Object.keys(marks) as VideoCloneDimKey[]) delete marks[k]
    audio.value = 'regenerate'
  }

  /** 参考图（顺序 = 标注里 refs 的序号）：新传的图给地址，从保存的方案带回的图给 `mr://rid` */
  const refList = computed(() =>
    (['person', 'product', 'garment', 'scene'] as SlotKey[])
      .filter((k) => slots[k])
      .map((k) => ({ slot: k, url: slots[k]!.url, ref: slots[k]!.rid ? `mr://${slots[k]!.rid}` : slots[k]!.url })),
  )

  /** 叠加文字：店名 → shop_name；电话 / 地址 → other（Go：≤4 处、每处 ≤30 字） */
  function buildTexts(): ReplicateTextOverlay[] {
    const out: ReplicateTextOverlay[] = []
    if (text.shopName.trim()) out.push({ text: text.shopName.trim().slice(0, 30), kind: 'shop_name' })
    if (text.phone.trim()) out.push({ text: text.phone.trim().slice(0, 30), kind: 'other' })
    return out
  }

  function buildAnnotations(): ReplicateAnnotations {
    const out: ReplicateAnnotations = { audio: audio.value, dims: {} }
    for (const [key, m] of Object.entries(marks) as [VideoCloneDimKey, { mode: DimMode; note: string }][]) {
      if (!m || m.mode === 'keep') continue
      const mark: ReplicateDimEdit = { mode: m.mode }
      if (m.note.trim()) mark.note = m.note.trim()
      if (m.mode === 'replace') {
        const slot = DIM_SLOT[key]
        const idx = slot ? refList.value.findIndex((r) => r.slot === slot) : -1
        if (idx >= 0) mark.refs = [idx + 1]
      }
      out.dims[key] = mark
    }
    const texts = buildTexts()
    if (texts.length) out.texts = texts
    return out
  }

  /** 本地能判断的缺项（不用白跑一次请求）：换成我的图没放图 / 按我写的改没写话 */
  const localGaps = computed(() => {
    const out: string[] = []
    for (const [key, m] of Object.entries(marks) as [VideoCloneDimKey, { mode: DimMode; note: string }][]) {
      if (!m) continue
      const slot = DIM_SLOT[key]
      if (m.mode === 'replace' && slot && !slots[slot]) out.push(MISSING_SLOT_TEXT[slot])
      if (m.mode === 'describe' && !m.note.trim()) out.push(`写一句话再继续（${DIM_LABEL[key]}）`)
    }
    return [...new Set(out)]
  })
  const nothingChanged = computed(() => changedCount.value === 0 && buildTexts().length === 0)

  /** 缺项（「还差：…」）：本地缺项 + 服务端 gaps + 肖像授权；只列第一条给按钮旁，全部给无障碍 */
  const missing = computed(() => {
    const out: string[] = [...localGaps.value]
    if (!localGaps.value.length) for (const g of planGaps.value) out.push(g.message)
    if (nothingChanged.value) out.push(NOTHING_CHANGED_TEXT)
    if (slots.person && !consent.value) out.push('确认已获得人物同意')
    return [...new Set(out)]
  })

  async function ensureBalance() {
    try {
      const res = await getPointsBalance()
      balance.value = res.data?.balance ?? null
    } catch {
      balance.value = null
    }
  }

  let stageTouched = false

  // 方案链：首张 POST /plans，之后每次编辑 PATCH 最新那张（旧方案变 STALE）。basePlanNo 永远指向后端链上最新的一张，
  // 哪怕那次响应已经被更新的编辑盖过、没显示在页面上——否则下一次 PATCH 打在旧方案上会 409。
  let basePlanNo = ''
  /** 当前方案对应的输入（标注 + 参考图）；输入改回这一份时直接用回这张方案，不白出一张 */
  let appliedKey = ''
  let latestPlan: ReplicatePlan | null = null
  /** 恢复保存的方案 / 示例改法时整批写入 marks，不触发防抖出方案 */
  let suppressWatch = false

  function resetPlanChain() {
    basePlanNo = ''
    appliedKey = ''
    latestPlan = null
    clearTimeout(planTimer)
    planDirty.value = false
    planQueued = false
    submittedKey = ''
    planDims.value = []
    planSummary.value = ''
  }

  async function enterPlan() {
    step.value = 'plan'
    void loadModels()
    resetMarks()
    plan.value = null
    planGaps.value = []
    planError.value = ''
    stageTouched = false
    consent.value = false
    submitError.value = ''
    resetPlanChain()
    void ensureBalance()
  }

  const planInputKey = () => JSON.stringify([buildAnnotations(), refList.value.map((r) => r.ref)])

  /** 出方案的请求串行执行（每次都在上一张的结果上 PATCH）；排队里只有最新的一次真正发出 */
  let planSeq = 0
  let planChain: Promise<void> = Promise.resolve()
  function enqueuePlan(fn: (s: number) => Promise<void>): Promise<void> {
    const s = ++planSeq
    const run = planChain.then(() => fn(s)).catch(() => undefined)
    planChain = run
    return run
  }

  /** 顺着 supersededBy 找到最新那张方案 */
  async function followLatest(no: string): Promise<ReplicatePlan | null> {
    let cur = no
    for (let i = 0; i < 6; i++) {
      const res = await replicateGetPlan(cur)
      const p = res.data
      if (!p) return null
      if (p.status === 'STALE' && p.supersededBy) {
        cur = p.supersededBy
        continue
      }
      return p
    }
    return null
  }

  /** PATCH 改标注；基准方案已被取代（409 PLAN_STALE）时找到最新那张再改一次 */
  async function patchLatest(no: string, body: ReplicatePatchAnnotationsRequest): Promise<ReplicatePlan | null> {
    try {
      return (await replicatePatchAnnotations(no, body)).data ?? null
    } catch (err) {
      if (toApiError(err)?.reason !== 'PLAN_STALE') throw err
      const latest = await followLatest(no)
      if (!latest || latest.planNo === no) throw err
      basePlanNo = latest.planNo
      return (await replicatePatchAnnotations(latest.planNo, body)).data ?? null
    }
  }

  function createPlan() {
    return enqueuePlan(doCreatePlan)
  }

  // ---- 模型选择（GET /models）：默认推荐，用户可换；换模型 = 立即出新方案（走「先更新报价」门槛：提交中不能确认） ----
  const modelGroup = ref(REPLICATE_DEFAULT_MODEL_GROUP)
  const models = ref<ReplicateModel[]>([])
  const modelsLoading = ref(false)
  /** 用户手动选过模型：之后拉列表不再用推荐值覆盖 */
  let modelTouched = false
  const currentModel = computed(() => models.value.find((m) => m.modelGroup === modelGroup.value) ?? null)

  async function loadModels() {
    const a = analysis.value
    const q = a?.analysisNo ? { analysisNo: a.analysisNo } : sampleId.value ? { sampleId: sampleId.value } : {}
    modelsLoading.value = true
    try {
      const res = await replicateModels(q)
      const list = res.data
      if (!list) return
      models.value = list.items ?? []
      if (!modelTouched && !plan.value && list.defaultModel) modelGroup.value = list.defaultModel
    } catch {
      // 拉不到列表：只用默认模型，不挡出方案
    } finally {
      modelsLoading.value = false
    }
  }

  /** 换模型：本地先切，再立即提交出新方案（新报价）；不可选的模型忽略 */
  function setModel(g: string) {
    const m = models.value.find((x) => x.modelGroup === g)
    if (!m || !m.available || g === modelGroup.value) return
    modelTouched = true
    modelGroup.value = g
    planDirty.value = true
    void submitPlan()
  }

  // ---- 画面连贯度（§Y）：默认 fast；只有多段方案有意义，切换 = 立即出新方案（新 ETA） ----
  const continuity = ref<ReplicateContinuity>('fast')
  function setContinuity(v: ReplicateContinuity) {
    if (v === continuity.value) return
    continuity.value = v
    planDirty.value = true
    void submitPlan()
  }

  async function doCreatePlan(s: number) {
    if (s !== planSeq) return
    if (nothingChanged.value || localGaps.value.length) {
      plan.value = null
      planGaps.value = []
      planError.value = ''
      planBusy.value = false
      return
    }
    const a = analysis.value
    const origin = a?.analysisNo ? { analysisNo: a.analysisNo } : sampleId.value ? { sampleId: sampleId.value } : null
    if (!basePlanNo && !origin) return
    const annotations = buildAnnotations()
    const refImages = refList.value.map((r) => r.ref)
    const key = planInputKey()
    planBusy.value = true
    planError.value = ''
    try {
      const p = basePlanNo
        ? await patchLatest(basePlanNo, { annotations, refImages, modelGroup: modelGroup.value, continuity: continuity.value })
        : (await replicateCreatePlan({ ...origin, annotations, refImages, modelGroup: modelGroup.value, continuity: continuity.value })).data
      if (p) basePlanNo = p.planNo
      if (s !== planSeq) return
      planGaps.value = []
      if (p) appliedKey = key
      applyPlan(p)
    } catch (err) {
      if (s !== planSeq) return
      const gaps = replicateGaps(err)
      plan.value = null
      if (gaps) planGaps.value = gaps
      else planError.value = replicateErrorText(err, { fallback: '方案生成出了点问题，没有扣点数。请重试' })
    } finally {
      if (s === planSeq) planBusy.value = false
    }
  }

  function applyPlan(p: ReplicatePlan | null | undefined) {
    if (!p) return
    plan.value = p
    if (p.modelGroup) modelGroup.value = p.modelGroup
    continuity.value = p.continuity === 'smooth' ? 'smooth' : 'fast'
    latestPlan = p
    if (!planSummary.value && p.analysis?.summary) planSummary.value = p.analysis.summary
    const multi = p.timeline.segments.length > 1
    if (!multi) stage.value = 'all'
    else if (!stageTouched) stage.value = p.cost.defaultStage
  }

  function setStage(s: 'first' | 'all') {
    stageTouched = true
    stage.value = s
  }

  // 改标注 / 换图 / 叠字 / 声音：先只改本地（planDirty），停止编辑 1.5 秒或点「更新报价」才提交一次
  // （首张 POST /plans，之后 PATCH 出新方案、旧方案变 STALE）；提交中又改了 → 排队，本次回来后合并成下一次提交。
  // 报价区只在提交期间显示「正在更新报价」；有没提交的修改时不能确认（旧报价不代表新改法）。
  const PLAN_IDLE_MS = 1500
  let planTimer: ReturnType<typeof setTimeout> | undefined
  /** 有本地修改还没提交 */
  const planDirty = ref(false)
  let planInFlight = false
  let planQueued = false
  /** 最近一次提交时的输入：之后输入再变才算「有没提交的修改」 */
  let submittedKey = ''

  /** 立即提交本地修改（「更新报价」按钮 / 停手 1.5 秒）；提交中则排队，等这次回来再合并提交一次 */
  async function submitPlan(): Promise<void> {
    clearTimeout(planTimer)
    if (step.value !== 'plan') return
    if (planInFlight) {
      planQueued = true
      return
    }
    planInFlight = true
    submittedKey = planInputKey()
    planDirty.value = false
    try {
      await createPlan()
    } finally {
      planInFlight = false
      planDirty.value = step.value === 'plan' && planInputKey() !== submittedKey
      if (planQueued) {
        planQueued = false
        if (planDirty.value) void submitPlan()
      }
    }
  }

  watch(planInputKey, (key) => {
    if (step.value !== 'plan' || suppressWatch) return
    clearTimeout(planTimer)
    if (!planInFlight && key === appliedKey && latestPlan && latestPlan.planNo === basePlanNo) {
      // 改回了当前方案的输入：直接用回它（它没被取代，价格仍然有效），不用提交
      planDirty.value = false
      submittedKey = key
      plan.value = latestPlan
      return
    }
    planDirty.value = key !== submittedKey || !plan.value
    if (!planDirty.value) return
    planTimer = setTimeout(() => void submitPlan(), PLAN_IDLE_MS)
  })

  /** 标注 + 参考图的可比较形式（只比用户能改的：各项改法 / 说明 / 用到的图 rid、声音、叠字）；本地还没拉入的 http 图只比「有没有图」 */
  function inputCanon(ann: ReplicateAnnotations | null | undefined, refRids: string[]): string {
    const dims: Record<string, [string, string, string]> = {}
    for (const [k, e] of Object.entries(ann?.dims ?? {})) {
      if (!e || e.mode === 'keep') continue
      const first = e.mode === 'replace' ? e.refs?.[0] : undefined
      const rid = first ? (refRids[first - 1] ?? '') : ''
      dims[k] = [e.mode, (e.note ?? '').trim(), rid.startsWith('http') ? '*' : rid]
    }
    const texts = (ann?.texts ?? []).map((t) => [t.kind ?? '', t.text.trim()])
    return JSON.stringify([
      ann?.audio || 'regenerate',
      Object.keys(dims)
        .sort()
        .map((k) => [k, dims[k]]),
      texts,
    ])
  }

  /**
   * 确认时方案已被取代（409 PLAN_STALE）：拉最新那张方案和最新报价，让你再看一眼价格。
   * 最新方案的改法与页面上的不一致（别的标签页 / 设备改过）→ 把最新方案回填到页面并提示，不能把它当成页面当前输入。
   */
  async function refreshStalePlan(no: string) {
    try {
      const latest = await followLatest(no)
      if (!latest) return
      basePlanNo = latest.planNo
      const localRids = refList.value.map((r) => (r.ref.startsWith('mr://') ? r.ref.slice(5) : r.ref))
      const latestRids = (latest.refImages ?? []).map((r) => r.rid)
      const differs = inputCanon(buildAnnotations(), localRids) !== inputCanon(latest.annotations, latestRids)
      if (differs && latest.annotations) {
        suppressWatch = true
        const keep = new Map(
          Object.entries(slots)
            .filter(([, v]) => v?.rid)
            .map(([k, v]) => [v!.rid, { k, url: v!.url }]),
        )
        for (const k of Object.keys(slots) as SlotKey[]) slots[k] = null
        restoreMarks(
          latest.annotations,
          (latest.refImages ?? []).map((r) => ({ index: r.index, rid: r.rid, url: keep.get(r.rid)?.url ?? '' })),
        )
        await nextTick()
        suppressWatch = false
        submitError.value = '方案已在别处更新，已换成最新的方案，请再看一眼改法和价格'
      }
      clearTimeout(planTimer)
      appliedKey = planInputKey()
      submittedKey = appliedKey
      planDirty.value = false
      applyPlan(latest)
      await refreshQuote()
    } catch {
      // 拉不到就保持提示，你可以改一下再出方案
    }
  }

  /** 刷新报价（POST /plans/{no}/quote）：返回完整方案，价格与有效期以它为准 */
  async function refreshQuote() {
    const p = plan.value
    if (!p) return
    try {
      const res = await replicateQuote(p.planNo)
      applyPlan(res.data)
      void ensureBalance()
    } catch {
      // 保持旧价并让用户看到「报价已过期」，不拿前端估算顶上
    }
  }

  // ---- 3b 保存为我的方案（POST /plans/{no}/save） ----
  const savedPlan = ref<ReplicateSavedPlan | null>(null)
  const saveBusy = ref(false)
  const saveError = ref('')
  /** 满 50 个：给「去我的方案」入口 */
  const saveLimit = ref(false)
  /** 当前这张方案是否已经保存过（改过标注就是新方案，要重新保存） */
  const planSaved = computed(() => !!savedPlan.value && !!plan.value && savedPlan.value.planNo === plan.value.planNo)

  async function savePlan(name?: string) {
    const p = plan.value
    if (!p || saveBusy.value) return
    saveBusy.value = true
    saveError.value = ''
    saveLimit.value = false
    try {
      const n = name?.trim()
      const res = await replicateSavePlan(p.planNo, n ? { name: n.slice(0, 40) } : {})
      if (res.data) savedPlan.value = res.data
    } catch (err) {
      const e = toApiError(err)
      saveLimit.value = e?.reason === 'SAVED_PLAN_LIMIT'
      saveError.value = e?.isNetwork
        ? '网络不稳，没保存上，再点一次'
        : replicateErrorText(err, { fallback: '没保存上，再点一次' })
    } finally {
      saveBusy.value = false
    }
  }
  watch(
    () => plan.value?.planNo,
    () => {
      saveError.value = ''
      saveLimit.value = false
    },
  )

  // ---- 3c 用示例 / 保存的方案开始 ----

  /** 把一组标注（示例的改法 / 保存的改法）写回编辑区；参考图只在保存的方案里带回（示例要放你自己的图） */
  function restoreMarks(ann: ReplicateAnnotations | null | undefined, refs?: ReplicateSavedPlan['refImages']) {
    resetMarks()
    if (!ann) return
    audio.value = ann.audio ?? 'regenerate'
    for (const [k, e] of Object.entries(ann.dims ?? {}) as [VideoCloneDimKey, ReplicateDimEdit | undefined][]) {
      if (!e || e.mode === 'keep' || !DIM_LABEL[k]) continue
      marks[k] = { mode: e.mode, note: e.note ?? '' }
      const slot = DIM_SLOT[k]
      const ref = slot && refs && e.refs?.length ? refs.find((r) => r.index === e.refs![0]) : undefined
      if (slot && ref && !slots[slot]) slots[slot] = { url: ref.url ?? '', name: '', rid: ref.rid }
    }
    if (refs) {
      for (const t of ann.texts ?? []) {
        if (t.kind === 'shop_name' && !text.shopName) text.shopName = t.text
        else if (t.kind !== 'shop_name' && !text.phone) text.phone = t.text
      }
    }
  }

  /** 示例 →「换成我的素材做同款」：用示例的共享分析出你自己的方案（sampleId），示例改法作为初始改法，图要你自己放 */
  async function useSample() {
    const t = sampleTry.value
    if (!t) return
    restart()
    sampleId.value = t.sample.id
    sampleTitle.value = t.sample.title
    analysis.value = {
      analysisNo: '',
      status: 'succeeded',
      stages: [],
      cached: false,
      freeText: t.freeText,
      result: t.analysis,
      elapsedS: 0,
    }
    sampleTry.value = null
    await enterPlan()
    restoreMarks(t.annotations)
  }

  /** 原片不在了：等你重新上传原片，分析好后带 analysisNo 再用这个方案（方案设置保留） */
  const pendingReuse = ref<ReplicateSavedPlan | null>(null)
  /** 正在「用它做一条」的方案 id */
  const reuseBusy = ref<number | null>(null)

  function startReuseWithNewSource(sp: ReplicateSavedPlan) {
    restart()
    pendingReuse.value = sp
    tab.value = 'new'
  }

  function cancelPendingReuse() {
    pendingReuse.value = null
  }

  /** 进入方案编辑并恢复保存的改法（整批写入，不触发防抖） */
  async function restoreSaved(sp: ReplicateSavedPlan) {
    suppressWatch = true
    restoreMarks(sp.annotations, sp.refImages)
    await nextTick()
    suppressWatch = false
  }

  /**
   * 我的方案 →「用它做一条」：默认用保存时的原片和图（POST /saved-plans/{id}/reuse）。
   * 原片已不在（sourceAvailable=false 或 404 SOURCE_GONE）→ 回到上传，重新放原片后再用。返回要在列表上显示的错误（没有则 ''）。
   */
  async function reuseSaved(sp: ReplicateSavedPlan): Promise<string> {
    if (!sp.sourceAvailable) {
      startReuseWithNewSource(sp)
      return ''
    }
    if (reuseBusy.value != null) return ''
    reuseBusy.value = sp.id
    try {
      const res = await replicateReuseSavedPlan(sp.id)
      const p = res.data
      if (!p) return '没打开这个方案，再点一次'
      restart()
      tab.value = 'new'
      step.value = 'plan'
      sampleId.value = p.sampleId || null
      void ensureBalance()
      await restoreSaved(sp)
      // 没有分析结果：「视频里的这些地方」用方案里列出的项
      const order = Object.keys(DIM_LABEL)
      planDims.value = [...p.changes, ...p.kept]
        .filter((l) => DIM_LABEL[l.key as VideoCloneDimKey])
        .sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key))
        .map((l) => ({
          key: l.key as VideoCloneDimKey,
          label: DIM_LABEL[l.key as VideoCloneDimKey],
          present: true,
          now: l.current,
        }))
      planSummary.value = p.analysis?.summary || sp.title
      basePlanNo = p.planNo
      appliedKey = planInputKey()
      applyPlan(p)
      return ''
    } catch (err) {
      if (replicateSourceGone(err)) {
        startReuseWithNewSource(sp)
        return ''
      }
      if (toApiError(err)?.isNetwork) return '网络不稳，没打开这个方案，再点一次'
      return replicateGaps(err)?.[0]?.message ?? replicateErrorText(err, { fallback: '没打开这个方案，再点一次' })
    } finally {
      reuseBusy.value = null
    }
  }

  /**
   * 对话里的方案 → `?plan=<planNo>` 深链：GET 方案后进入方案步骤，标注 / 参考图预填（与「用它做一条」同一套恢复路径）。
   * 只认 READY 的方案；过期 / 已被改过 / 找不到 → 返回提示语，页面照常从头开始（不改状态）。成功返回 ''。
   */
  async function openPlan(no: string): Promise<string> {
    try {
      const res = await replicateGetPlan(no)
      const p = res.data
      if (!p) return '没找到这个方案，可以重新上传视频开始'
      if (p.status === 'EXPIRED') return '这个方案已过期，可以重新上传视频开始'
      if (p.status === 'STALE') return '这个方案已经被改过，请回到对话里打开最新的方案'
      if (p.status === 'CONFIRMED') return '这个方案已经开始做了，可以在「历史」里查看'
      restart()
      tab.value = 'new'
      step.value = 'plan'
      sampleId.value = p.sampleId || null
      void loadModels()
      void ensureBalance()
      suppressWatch = true
      restoreMarks(p.annotations, p.refImages)
      await nextTick()
      suppressWatch = false
      const order = Object.keys(DIM_LABEL)
      planDims.value = [...p.changes, ...p.kept]
        .filter((l) => DIM_LABEL[l.key as VideoCloneDimKey])
        .sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key))
        .map((l) => ({
          key: l.key as VideoCloneDimKey,
          label: DIM_LABEL[l.key as VideoCloneDimKey],
          present: true,
          now: l.current,
        }))
      planSummary.value = p.analysis?.summary || p.title
      basePlanNo = p.planNo
      appliedKey = planInputKey()
      applyPlan(p)
      return ''
    } catch (err) {
      return replicateErrorText(err, { fallback: '没打开这个方案，可以重新上传视频开始' })
    }
  }

  /** 重新上传的原片分析好了：带 analysisNo 用保存的方案出新方案；新视频里没有的项按缺项提示 */
  async function reuseWithAnalysis(analysisNo: string) {
    const sp = pendingReuse.value
    if (!sp) return
    pendingReuse.value = null
    suppressWatch = true
    await enterPlan()
    restoreMarks(sp.annotations, sp.refImages)
    await nextTick()
    suppressWatch = false
    clearTimeout(planTimer)
    planBusy.value = true
    await enqueuePlan(async (s) => {
      try {
        const res = await replicateReuseSavedPlan(sp.id, { analysisNo })
        const p = res.data
        if (p) basePlanNo = p.planNo
        if (s !== planSeq) return
        if (p) appliedKey = planInputKey()
        applyPlan(p)
      } catch (err) {
        if (s !== planSeq) return
        const gaps = replicateGaps(err)
        if (gaps) planGaps.value = gaps
        else planError.value = replicateErrorText(err, { fallback: '方案生成出了点问题，没有扣点数。请重试' })
      } finally {
        if (s === planSeq) planBusy.value = false
      }
    })
  }

  const needPoints = computed(() => {
    const p = plan.value
    if (!p) return 0
    // 与 StepPlan 的 staged 同口径：只有多段且选了「先做第 1 段」才按第 1 段报价
    return stage.value === 'first' && multiSegment.value ? p.stageQuotes.first : p.stageQuotes.total
  })
  const shortfall = computed(() =>
    balance.value != null && needPoints.value > balance.value ? needPoints.value - balance.value : 0,
  )
  const multiSegment = computed(() => (plan.value?.timeline.segments.length ?? 0) > 1)
  const canConfirm = computed(
    () =>
      !!plan.value &&
      plan.value.status === 'READY' &&
      !planBusy.value &&
      !planDirty.value &&
      !missing.value.length &&
      !submitting.value,
  )

  async function confirm() {
    const p = plan.value
    if (!p || !canConfirm.value) return
    if (shortfall.value > 0) return
    if (needPoints.value <= 0) {
      submitError.value = '价格还没出来，稍等一下'
      return
    }
    submitting.value = true
    submitError.value = ''
    try {
      const res = await replicateConfirm(p.planNo, {
        planHash: p.planHash,
        stage: stage.value,
        expectedPoints: needPoints.value,
      })
      if (!res.data) throw new Error('empty')
      enterJob(res.data)
    } catch (err) {
      submitError.value = replicateErrorText(err, { write: true, fallback: '没成功，没有扣点数。请重试' })
      const e = toApiError(err)
      // 方案已更新 / 已过期：重新出方案；价变：只刷新报价，让用户按新价格再确认；点数不足：刷新余额
      if (e?.reason === 'PLAN_STALE') await refreshStalePlan(p.planNo)
      else if (e?.reason === 'PLAN_EXPIRED') await createPlan()
      else if (e?.reason === 'QUOTE_CHANGED') await refreshQuote()
      else if (e?.code === 3003) void ensureBalance()
    } finally {
      submitting.value = false
    }
  }

  // ---- 4 生成 ----
  const job = ref<ReplicateJob | null>(null)
  const jobBusy = ref(false)
  const jobError = ref('')
  let jobTimer: ReturnType<typeof setTimeout> | undefined
  let jobSeq = 0

  const jobRunning = computed(
    () => !!job.value && ['submitting', 'queued', 'running', 'continuing'].includes(job.value.status),
  )

  function enterJob(j: ReplicateJob) {
    step.value = 'job'
    job.value = j
    pollJob(j.jobId)
  }

  /** 从历史 / 深链进入某个任务 */
  async function openJob(id: number | string) {
    step.value = 'job'
    jobError.value = ''
    try {
      const res = await replicateGetJob(id)
      if (res.data) {
        job.value = res.data
        pollJob(res.data.jobId)
      }
    } catch (err) {
      jobError.value = replicateErrorText(err)
    }
  }

  function pollJob(id: number) {
    const s = ++jobSeq
    clearTimeout(jobTimer)
    const tick = async () => {
      try {
        const res = await replicateGetJob(id)
        if (s !== jobSeq) return
        if (res.data) job.value = res.data
        jobError.value = ''
      } catch (err) {
        // 网络异常只影响页面显示，生成仍在进行
        if (s === jobSeq) jobError.value = replicateErrorText(err)
      }
      if (s !== jobSeq) return
      const j = job.value
      if (!j) return
      // 在途（含逐段预留 / 预留其余段）、有段在跑或自动重试、整条成片还在合成（result.status=retry）时继续轮询；等你确认（waiting）/ 终态停
      const anyActive =
        j.status !== 'waiting' && j.segments.some((x) => ['queued', 'running', 'retrying'].includes(x.state))
      const composing = ['succeeded', 'partial'].includes(j.status) && j.result?.status === 'retry'
      if (['submitting', 'queued', 'running', 'continuing'].includes(j.status) || anyActive || composing)
        jobTimer = setTimeout(tick, POLL_JOB)
      else scheduleUrlRefresh()
    }
    jobTimer = setTimeout(tick, 600)
  }

  /** 签名地址（videoUrl / coverUrl）临近到期时静默重拉 job，页面上的播放器和下载始终拿到新地址 */
  let urlTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleUrlRefresh() {
    clearTimeout(urlTimer)
    const exp = job.value?.urlExpiresAt
    if (!exp || !job.value) return
    const ms = Math.max(5000, new Date(exp).getTime() - Date.now() - 60_000)
    urlTimer = setTimeout(() => void ensureFreshUrls(true), ms)
  }
  /** 播放 / 下载前调用：地址临近或已过 urlExpiresAt（或 force，如播放出错）先重拉 job */
  async function ensureFreshUrls(force = false) {
    const j = job.value
    if (!j || (!force && !urlExpiringSoon(j.urlExpiresAt))) return
    try {
      const res = await replicateGetJob(j.jobId)
      if (res.data && job.value?.jobId === j.jobId) job.value = res.data
      scheduleUrlRefresh()
    } catch (err) {
      jobError.value = replicateErrorText(err)
    }
  }

  async function jobAction(fn: () => Promise<{ data?: ReplicateJob | null }>) {
    if (jobBusy.value) return
    jobBusy.value = true
    jobError.value = ''
    try {
      const res = await fn()
      if (res.data) {
        job.value = res.data
        pollJob(res.data.jobId)
      }
    } catch (err) {
      jobError.value = replicateErrorText(err, { write: true })
    } finally {
      jobBusy.value = false
    }
  }

  const continuePoints = computed(() => job.value?.decision?.options.find((o) => o.action === 'continue')?.points ?? 0)
  /** 价格没出来（点数缺失或 ≤0）时后端会拒（1002），按钮置灰、函数直接返回 */
  const PRICE_PENDING_TEXT = '价格还没出来，稍等一下'
  const continueReady = computed(() => continuePoints.value > 0)
  const redoPointsOf = (k: number) => job.value?.segments.find((x) => x.index === k)?.points ?? 0
  const redoReady = (k: number) => redoPointsOf(k) > 0
  const continueRest = () => {
    if (!job.value) return
    if (!continueReady.value) {
      jobError.value = PRICE_PENDING_TEXT
      return
    }
    return jobAction(() =>
      replicateContinue(job.value!.jobId, { planHash: job.value!.planHash, expectedPoints: continuePoints.value }),
    )
  }
  const redoSegment = (k: number) => {
    if (!job.value) return
    const points = redoPointsOf(k)
    if (points <= 0) {
      jobError.value = PRICE_PENDING_TEXT
      return
    }
    return jobAction(() => replicateRedoSegment(job.value!.jobId, k, { expectedPoints: points }))
  }
  /** 「不做剩下的段」：只取消没开始的段（退点），在途段做完；二次确认在页面里做 */
  const cancelRestPoints = computed(() => job.value?.cancelRest?.points ?? 0)
  const canCancelRest = computed(() => !!job.value?.cancelRest?.available)
  const cancelRest = () => job.value && jobAction(() => replicateCancelRest(job.value!.jobId))
  /** 「不继续了」：只交付第 1 段（Go 没有取消整条的接口） */
  const stopJob = () => job.value && jobAction(() => replicateStop(job.value!.jobId))
  const setAutoContinue = (v: boolean) => void replicatePutPref({ autoContinue: v }).catch(() => undefined)

  /** 回到方案（调整后重做 / 换商品再做）：保留素材与标注，重新出方案（不改动在途任务，超时未继续的会自动结束） */
  async function backToPlan() {
    jobSeq++
    clearTimeout(jobTimer)
    job.value = null
    stageTouched = false
    plan.value = null
    step.value = 'plan'
    await createPlan()
  }

  function restart() {
    jobSeq++
    clearTimeout(jobTimer)
    clearTimeout(planTimer)
    anaSeq++
    stopAnalysisTimers()
    job.value = null
    plan.value = null
    planGaps.value = []
    planError.value = ''
    submitError.value = ''
    analysis.value = null
    stageTouched = false
    planSeq++
    planBusy.value = false
    resetPlanChain()
    sampleId.value = null
    sampleTitle.value = ''
    pendingReuse.value = null
    savedPlan.value = null
    clearSource()
    for (const k of SLOTS.map((x) => x.key)) slots[k] = null
    text.shopName = ''
    text.phone = ''
    resetMarks()
    step.value = 'start'
  }

  onBeforeUnmount(() => {
    anaSeq++
    jobSeq++
    stopAnalysisTimers()
    clearTimeout(jobTimer)
    clearTimeout(urlTimer)
    clearTimeout(planTimer)
  })

  return {
    tab,
    industry,
    samples,
    samplesLoading,
    sampleTry,
    sampleTryBusy,
    sampleError,
    sampleId,
    sampleTitle,
    initSamples,
    loadSamples,
    trySample,
    closeSample,
    useSample,
    savedPlan,
    saveBusy,
    saveError,
    saveLimit,
    planSaved,
    savePlan,
    pendingReuse,
    reuseBusy,
    reuseSaved,
    openPlan,
    cancelPendingReuse,
    summaryText,
    step,
    limits,
    notReady,
    notReadyText,
    source,
    slots,
    slotBusy,
    slotError,
    text,
    loadLimits,
    pickVideo,
    clearSource,
    pickSlotImage,
    pickSlotAsset,
    pickSourceAsset,
    clearSlot,
    analysis,
    analysisError,
    analysisRetryable,
    analysisElapsed,
    canAnalyze,
    startAnalysis,
    cancelAnalysis,
    marks,
    audio,
    consent,
    stage,
    plan,
    planBusy,
    planDirty,
    submitPlan,
    planError,
    planGaps,
    balance,
    submitting,
    submitError,
    dims,
    intentOn,
    changedCount,
    markOf,
    setMode,
    setNote,
    toggleIntent,
    resetMarks,
    refList,
    missing,
    nothingChanged,
    needPoints,
    shortfall,
    multiSegment,
    canConfirm,
    setStage,
    createPlan,
    refreshQuote,
    confirm,
    job,
    jobBusy,
    jobError,
    jobRunning,
    openJob,
    ensureFreshUrls,
    continueRest,
    redoSegment,
    stopJob,
    setAutoContinue,
    continuePoints,
    continueReady,
    redoReady,
    redoPointsOf,
    PRICE_PENDING_TEXT,
    modelGroup,
    models,
    modelsLoading,
    currentModel,
    loadModels,
    setModel,
    continuity,
    setContinuity,
    cancelRest,
    cancelRestPoints,
    canCancelRest,
    backToPlan,
    restart,
  }
}
