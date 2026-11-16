/**
 * 视频做同款（Go 原生，/api/v1/replicate/**）。
 *
 * 契约：fusion_aigc_go/docs/api/api-replicate.md，字段名以 app/replicate/core 里 View 结构的 json tag 为准（camelCase）。
 * 路由全部挂登录；信封是 Go 默认信封 `{code, reason?, msg, data}`（不是 plaza 的 v1wire 信封），业务错误 HTTP 200 + 非 0 code
 * （参数错 / 缺项也是 HTTP 200，与 /api/v1/plaza/* 的 HTTP 400 不同）；jsoncase 对 replicate 不放行，响应里会多出 snake_case 别名，这里只读 camelCase。
 *
 * 写接口（POST / PUT）必须带 `Idempotency-Key`（≤64 字符、同用户唯一）；confirm / continue / redo 缺键 → 1002「缺少请求标识」。
 * 同一动作重试（网络失败 / 409 IN_PROGRESS）要复用同一个键，否则可能重复预留点数：见 {@link idemKey}，成功后才换新键。
 * 点数、「已退回」等字样全部由后端字段驱动，页面不拼接、不写死。
 *
 * 示例 / 我的方案 / 改标注见契约 §10：GET /samples、POST /samples/{id}/try（不花点数、不计限频）、GET /plans/{no}、
 * PATCH /plans/{no}/annotations（每次编辑出新方案，旧方案变 STALE）、POST /plans/{no}/save、GET|DELETE /saved-plans、POST /saved-plans/{id}/reuse。
 * 模型选择：GET /models（名称、特点、单价/秒、是否支持时长与画幅；默认推荐 defaultModel），换模型走 PATCH 出新方案再确认。
 * 不做剩下的段：POST /jobs/{id}/cancel-rest（只取消没开始的段，在途段做完；预览见 JobView.cancelRest）。Go 没有「取消整条」接口。
 * 源视频与 refImages 传本站存储的 http(s) URL（服务端校验归属后转 rid），不合规回 1003 + 可读原因；
 * 成片 / 每段给现签的 videoUrl / coverUrl（有效期见 urlExpiresAt，过期重拉 job）；历史是 GET /jobs。
 *
 * 后端未就绪时用 mock 开关（`?mock=replicate`，见 mock-switch.ts）；mock 的响应形状与 Go 真实输出一致。
 */
import { del, getQuiet, patch, postQuiet, put, toApiError } from './index.ts'
import { isMock } from './mock-switch.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import type { VideoCloneDimKey } from './video-clone.ts'

export type { VideoCloneDimKey } from './video-clone.ts'

// ---------------- 类型（对照 Go 的 View 结构） ----------------

/** GET /limits：所有数值口径的唯一来源（Go `LimitsView`），页面文案不写死 80 秒 / 3 段 / 0.4 秒 */
export interface ReplicateLimits {
  /** 单段生成上限（秒） */
  segCapSec: number
  /** 单段生成下限（秒，网关规格最短） */
  specMinSec: number
  /** 拼接处多生成的时长（秒） */
  overlapSec: number
  /** 非末段最短时间轴长度 */
  minSegSec: number
  /** 末段最短时间轴长度 */
  minTailSec: number
  maxSegments: number
  /** 源视频最短 / 最长（秒） */
  minDurationSec: number
  maxDurationSec: number
  segTargetSec: number
  /** false = 多段（超过单段上限）还没开放：超过 segCapSec 的视频会得到 7003 */
  longformEnabled: boolean
  maxInFlight: number
  /** 决策卡等多少小时不继续就自动结束 */
  continueHours: number
  redoMaxPerSegment: number
  /** 推荐模型（模型详情 / 单价走 GET /models） */
  defaultModel?: string
  /** 开放的模型组码 */
  models?: string[]
  /** 确认后由写手逐段改写提示词（失败回落方案里的模板稿） */
  writerEnabled?: boolean
  /** 单次确认总价超过它（点数）须二次确认；对齐后端 replicate.confirm_threshold_points，缺省用前端兜底 {@link CONFIRM_THRESHOLD_POINTS} */
  confirmThresholdPoints?: number
}

/** 二次确认阈值的前端兜底（点数）；limits 下发 confirmThresholdPoints 时优先用后端的 */
export const CONFIRM_THRESHOLD_POINTS = 3000

/** GET /models 的一项（Go `ModelView`） */
export interface ReplicateModel {
  modelGroup: string
  name: string
  features: string[]
  recommended: boolean
  dialect: string
  resolutions: string[]
  aspectRatios: string[]
  defaultResolution: string
  minDurationSec: number
  maxDurationSec: number
  /** 单价按哪个清晰度算的 */
  resolution: string
  pointsPerSecond: number
  /** 「10 点/秒（720p）」 */
  priceText?: string
  /** 带了视频时：按分段的合计点数 */
  estimatedPoints?: number
  supportsDuration: boolean
  supportsAspect: boolean
  supportsResolution: boolean
  /** false = 不可选（未配价 / 时长或画幅不支持），原因见 unavailableText */
  available: boolean
  unavailableText?: string
}

export interface ReplicateModelList {
  defaultModel: string
  items: ReplicateModel[]
}

export type ReplicateAnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type ReplicateStageKey = 'read' | 'frames' | 'lines' | 'understand'

export interface ReplicateStage {
  key: ReplicateStageKey
  /** 用户口径文案，如「正在读取视频…」 */
  label: string
  /** skipped = 无声，跳过台词 */
  status: 'done' | 'active' | 'pending' | 'skipped'
}

export interface ReplicateDim {
  /** false = 画面里没有这一项：置灰，提交时不能改它（DIM_ABSENT） */
  present: boolean
  desc: string
  risk: string
  occurrences?: { t0: number; t1: number; desc: string; subject?: string }[]
}

/** 解析结果（Go `AnalysisResult`）：没有 meta / frames / transcript，时长在 durationS */
export interface ReplicateAnalysisResult {
  promptVersion: string
  durationS: number
  width: number
  height: number
  hasAudio: boolean
  type: string
  purpose: string
  audioKind: string
  audioNote: string
  dims: Partial<Record<VideoCloneDimKey, ReplicateDim>>
  dimOrder: string[]
  subjects: { id: string; name: string; nameEn?: string; desc: string }[]
  sections: { index: number; t0: number; t1: number; desc: string; action?: string; camera?: string }[]
  onScreenText: { t0: number; t1: number; text: string; kind: string }[]
  lines: unknown[]
  summary: string
  warnings?: string[]
}

/** POST /analyses、GET /analyses/{no}（Go `AnalysisView`） */
export interface ReplicateAnalysis {
  analysisNo: string
  status: ReplicateAnalysisStatus
  stages: ReplicateStage[]
  /** true = 命中这条原片之前的解析 */
  cached: boolean
  cachedText?: string
  /** 「分析免费，不扣点数；…」 */
  freeText: string
  /** failed 时给用户看的原因 */
  error?: string
  result?: ReplicateAnalysisResult
  warnings?: string[]
  elapsedS: number
}

export type ReplicateDimMode = 'keep' | 'replace' | 'describe'

export interface ReplicateDimEdit {
  mode: ReplicateDimMode
  /** ≤200 字；describe 必填 */
  note?: string
  /** 参考图序号（1 起），对应请求 refImages 的顺序；replace 必填 */
  refs?: number[]
}

/** 生成后由系统叠加的文字（店名 / 价格 / 标题）：≤4 处、每处 ≤30 字 */
export interface ReplicateTextOverlay {
  text: string
  kind?: 'shop_name' | 'price' | 'title' | 'other'
  box?: { x: number; y: number; w: number; h: number }
  t0?: number
  t1?: number
  /** #RRGGBB */
  color?: string
}

export type ReplicateAudio = 'regenerate' | 'keep' | 'mute'

export interface ReplicateAnnotations {
  dims: Partial<Record<VideoCloneDimKey, ReplicateDimEdit>>
  /** 默认 regenerate（重新配乐） */
  audio?: ReplicateAudio
  texts?: ReplicateTextOverlay[]
}

/** 拉不到模型列表时的兜底默认（以 GET /models 的 defaultModel 为准） */
export const REPLICATE_DEFAULT_MODEL_GROUP = 'vid.seedance-2.5'

export interface ReplicatePlanRequest {
  /** 与 sampleId 二选一：自己上传的原片的分析编号 */
  analysisNo?: string
  /** 与 analysisNo 二选一：用示例的共享分析出你自己的方案（参考图是你的素材，正常计费） */
  sampleId?: number
  annotations: ReplicateAnnotations
  /** 参考图：本站存储的 http(s) 地址或 `mr://rid`（服务端校验归属后转 rid；不合规 1003 + 原因） */
  refImages: string[]
  modelGroup: string
  resolution?: string
  aspectRatio?: string
}

/** PATCH /plans/{no}/annotations：refImages 不传 = 沿用原方案的图（传了就整体替换），其余不传 = 沿用 */
export interface ReplicatePatchAnnotationsRequest {
  annotations: ReplicateAnnotations
  refImages?: string[]
  modelGroup?: string
  resolution?: string
  aspectRatio?: string
}

/** 方案 / 保存的方案里的参考图（序号从 1 起，对应标注里的 refs）；保存的方案带现签的 url */
export interface ReplicatePlanRef {
  index: number
  rid: string
  url?: string
}

export interface ReplicateDimLine {
  key: string
  label: string
  mode: ReplicateDimMode
  modeLabel: string
  /** 「视频里现在是：…」 */
  current: string
  note?: string
  refs?: number[]
  risk?: 'high' | 'mid' | 'low' | string
}

export interface ReplicateTimelineSegment {
  index: number
  t0: number
  t1: number
  genDuration: number
  /** cut 镜头切换处 / pause 说话停顿处 / even 按时长拆分处 / end 结尾 */
  cutReason: 'cut' | 'pause' | 'even' | 'end' | string
  cutLabel?: string
  points: number
}

export interface ReplicateEtaRange {
  lowSec: number
  highSec: number
  /** 「预计 4–6 分钟」 */
  text: string
}

export interface ReplicateCost {
  lines: { index: number; seconds: number; points: number }[]
  first: number
  rest: number
  total: number
  restSegments: number
  totalSeconds: number
  /** 报价有效期（ISO，现在 +10 分钟） */
  validUntil: string
  /** 多段默认 first；单段、或用户勾了「以后直接全部做」为 all */
  defaultStage: 'first' | 'all'
  firstText?: string
  restText?: string
  totalText: string
  explain: string
  overlapText?: string
  holdText: string
}

/** POST /plans、POST /plans/{no}/quote、GET /plans/{no}、PATCH /plans/{no}/annotations、POST /saved-plans/{id}/reuse（Go `PlanView`） */
export interface ReplicatePlan {
  planNo: string
  planHash: string
  /** STALE = 已被改过的新方案取代（supersededBy），再确认回 409 PLAN_STALE */
  status: 'READY' | 'CONFIRMED' | 'STALE' | 'EXPIRED'
  /** 被哪张新方案取代 */
  supersededBy?: string
  /** 由哪张方案改来 */
  parentPlanNo?: string
  /** 用示例出的方案：示例 id（0 / 缺省 = 自己的原片） */
  sampleId?: number
  /** 规范化后的标注 */
  annotations?: ReplicateAnnotations
  refImages?: ReplicatePlanRef[]
  resolution?: string
  aspectRatio?: string
  title: string
  overview: string
  changes: ReplicateDimLine[]
  kept: ReplicateDimLine[]
  risks: string[]
  timeline: {
    title: string
    explain: string
    single: boolean
    seamTip?: string
    segments: ReplicateTimelineSegment[]
  }
  modelGroup: string
  /** 段提示词按哪家方言写的 */
  dialect?: string
  cost: ReplicateCost
  stageQuotes: { first: number; rest: number; total: number }
  eta: { first?: ReplicateEtaRange; rest?: ReplicateEtaRange; total: ReplicateEtaRange; prior: boolean }
  /** 成片规则（付费前必须展示）；后端没承诺的「AI 生成」角标不展示 */
  policy: { watermark: boolean; removableBy?: string; text: string }
  /** 主按钮文案，如「先做第 1 段（120 点）」 */
  confirmButton: string
  copyright: string
  prompts: string[]
  expiresAt: string
  jobId?: number
  analysis?: { summary: string; durationS: number }
}

/** 方案缺项（code=1003 时 data.gaps） */
export type ReplicateGapCode =
  | 'MODEL_UNKNOWN'
  | 'REF_TOO_MANY'
  | 'REF_EMPTY'
  | 'REF_MISSING'
  | 'REF_UNKNOWN'
  | 'DIM_UNKNOWN'
  | 'DIM_ABSENT'
  | 'DIM_MODE'
  | 'NOTE_MISSING'
  | 'NOTE_TOO_LONG'
  | 'AUDIO_MODE'
  | 'NOTHING_CHANGED'
  | 'REF_NOT_OWNED'
  | 'REF_UNREADABLE'
  | 'REF_UNAVAILABLE'
  | 'RESOLUTION_UNSUPPORTED'
  | 'ASPECT_UNSUPPORTED'
  | 'DURATION_UNSUPPORTED'
  | 'TEXT_TOO_MANY'
  | 'TEXT_EMPTY'
  | 'TEXT_TOO_LONG'
  | 'TEXT_BOX'
  | 'TEXT_TIME'
  | 'TEXT_COLOR'

export interface ReplicateGap {
  code: ReplicateGapCode | string
  /** 如 `dims.product`、`refImages[1]`、`texts[0].text` */
  field: string
  /** 用户口径中文，可直接展示 */
  message: string
}

/** 任务状态：submitting（逐段预留）queued running waiting（第 1 段好了，等继续）continuing（预留其余段）succeeded partial failed canceled */
export type ReplicateJobStatus =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'continuing'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'canceled'

/** 段状态：not_started（等继续）queued retrying（自动重试中，不多收）running succeeded failed canceled */
export type ReplicateSegState = 'not_started' | 'queued' | 'retrying' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface ReplicateJobSegment {
  index: number
  state: ReplicateSegState
  stateLabel: string
  /** 失败 / 重试时的用户口径说明 */
  text?: string
  /** 「已退回 80 点」（退回真正成功才有）或「退点正在处理中，一般 5 分钟内到账」 */
  moneyText?: string
  points: number
  /** 段视频的媒体 rid */
  videoRid?: string
  /** 现签的播放 / 下载地址（有效期见 JobView.urlExpiresAt；没配媒体服务或签名失败时没有） */
  videoUrl?: string
  coverRid?: string
  coverUrl?: string
  redoable: boolean
  /** 「重做这一段（80 点）」 */
  redoLabel?: string
  redos: number
}

export interface ReplicateDecisionOption {
  action: 'continue' | 'adjust' | 'stop' | 'redo'
  label: string
  points?: number
  /** redo 才有 */
  segIndex?: number
}

export interface ReplicateDecision {
  kind: 'continue' | 'redo'
  title: string
  options: ReplicateDecisionOption[]
  autoContinueLabel?: string
  expiresAt?: string
  /** 「还剩 24 小时」 */
  remainingText?: string
}

/** 整条成片（Go `ResultView`）：只有 rid */
export interface ReplicateJobResult {
  status: 'ready' | 'retry' | 'failed' | 'unavailable'
  /** full 整条 / preview 含失败段占位的预览版（不能下载）/ partial 用户没继续的部分成片 */
  kind?: 'full' | 'preview' | 'partial'
  videoRid?: string
  videoUrl?: string
  coverRid?: string
  coverUrl?: string
  /** 占位的段号 */
  missing?: number[]
  text?: string
}

/** confirm / continue / stop / redo / GET /jobs/{id}（Go `JobView`） */
export interface ReplicateJob {
  jobId: number
  taskId: string
  planNo: string
  planHash: string
  status: ReplicateJobStatus
  /** 「第 1 段做好了」等状态文案 */
  statusLabel: string
  staged: boolean
  segTotal: number
  segDone: number
  segFailed: number
  /** 「已完成 1/3 段」 */
  overview: string
  segments: ReplicateJobSegment[]
  money: { held: number; confirmed: number; refunded: number; refundPending: number; text?: string }
  decision?: ReplicateDecision
  /** 到期 / 不继续等结局说明 */
  message?: string
  error?: string
  /** 「最多同时做 3 段，其余排队」 */
  concurrencyText?: string
  result?: ReplicateJobResult
  /** videoUrl / coverUrl 的到期时间（ISO）；临近或已过时先重拉 job 再播放 / 下载 */
  urlExpiresAt?: string
  /** 「不做剩下的段」预览（排队中 / 生成中才有） */
  cancelRest?: { available: boolean; segments: number; points: number; running: number; text?: string }
}

/** 历史列表的一行（Go `JobSummary`） */
export interface ReplicateJobSummary {
  jobId: number
  taskId: string
  planNo: string
  status: ReplicateJobStatus
  statusLabel: string
  /** 确认时冻结的一句话概述，没有时是「视频做同款」 */
  title: string
  segTotal: number
  segDone: number
  /** 合计点数：已扣除 + 预留中 + 扣费确认中（已退回不算） */
  points: number
  sourceThumbRid?: string
  sourceThumbUrl?: string
  coverRid?: string
  coverUrl?: string
  createdAt: string
}

export interface ReplicateJobList {
  items: ReplicateJobSummary[]
  total: number
  page: number
  size: number
  urlExpiresAt?: string
}

/** 示例列表的一项（Go `SampleList.items[]`） */
export interface ReplicateSample {
  id: number
  title: string
  /** 行业 code；空 = 通用 */
  industry: string
  coverRid?: string
  /** 现签封面地址（有效期见 urlExpiresAt） */
  coverUrl?: string
  durationS: number
  summary: string
  /** 有没有预计算的示例成片 */
  hasResult: boolean
}

export interface ReplicateSampleList {
  items: ReplicateSample[]
  urlExpiresAt?: string
}

/** POST /samples/{id}/try：共享分析 + 示例原片 + 预计算示例成片（不花点数、不计限频、不建任务） */
export interface ReplicateSampleTry {
  sample: ReplicateSample
  sourceRid?: string
  sourceUrl?: string
  resultRid?: string
  resultUrl?: string
  /** 与 AnalysisView.result 同结构 */
  analysis: ReplicateAnalysisResult
  /** 示例的改法（可作为你的初始改法），可能为 null */
  annotations: ReplicateAnnotations | null
  /** 「这是示例效果，用的是平台自有素材，不花点数；…」 */
  freeText: string
  /** 「换成你的素材，按这个改法做同款」 */
  nextText: string
  urlExpiresAt?: string
}

/** 我的方案（Go `SavedPlanView`） */
export interface ReplicateSavedPlan {
  id: number
  name: string
  planNo: string
  title: string
  /** 「换商品」「重新配乐」等标签 */
  labels: string[]
  modelGroup: string
  resolution?: string
  aspectRatio?: string
  annotations: ReplicateAnnotations
  refImages: ReplicatePlanRef[]
  sourceThumbRid?: string
  sourceThumbUrl?: string
  /** false = 原片已不在：「用它做」要先重新上传原片 */
  sourceAvailable: boolean
  sampleId?: number
  useCount: number
  lastUsedAt?: string
  createdAt: string
  /** false = 这张方案已经保存过，这次只更新了名字 */
  created?: boolean
}

export interface ReplicateSavedPlanList {
  items: ReplicateSavedPlan[]
  total: number
  page: number
  size: number
  /** 每人最多保存多少个（50） */
  limit: number
  urlExpiresAt?: string
}

/** POST /saved-plans/{id}/reuse：不传源视频 = 用保存时的原片；refImages 不传 = 沿用保存时的图 */
export interface ReplicateReuseRequest {
  analysisNo?: string
  sampleId?: number
  refImages?: string[]
  modelGroup?: string
  resolution?: string
  aspectRatio?: string
}

// ---------------- 幂等键 ----------------

const idemKeys = new Map<string, string>()

/**
 * 同一动作（scope）重试复用同一个 Idempotency-Key，成功后丢弃（下一次同类动作换新键）。
 * scope 要包含能区分「这次动作」的全部输入（路径 + 关键参数），否则不同请求会撞同一个键。
 */
function idemKey(scope: string): { 'Idempotency-Key': string } {
  let k = idemKeys.get(scope)
  if (!k) {
    k = createSafeUuid() // 36 位，≤64
    idemKeys.set(scope, k)
  }
  return { 'Idempotency-Key': k }
}
const idemDone = (scope: string) => void idemKeys.delete(scope)

async function write<T>(scope: string, fn: (headers: { 'Idempotency-Key': string }) => Promise<T>): Promise<T> {
  const r = await fn(idemKey(scope))
  idemDone(scope)
  return r
}

const mock = async () => (await import('./replicate-mock.ts')).replicateMock
const enc = encodeURIComponent

// ---------------- 接口 ----------------

/** GET /limits（读接口：功能总开关关着时也能读；Replicate.Enabled=false 时回 7003） */
export async function replicateLimits() {
  if (isMock('replicate')) return (await mock()).limits()
  return getQuiet<ReplicateLimits>('/api/v1/replicate/limits')
}

/** POST /analyses：`sourceUrl` 是本站上传地址或 `mr://rid`（不收抖音 / 快手等平台链接）；同用户同视频幂等，命中缓存 `cached=true` */
export async function replicateStartAnalysis(p: { sourceUrl: string }) {
  if (isMock('replicate')) return (await mock()).startAnalysis()
  const body = { sourceUrl: p.sourceUrl }
  return write(`analysis:${p.sourceUrl}`, (h) => postQuiet<ReplicateAnalysis>('/api/v1/replicate/analyses', body, h))
}

export async function replicateGetAnalysis(no: string) {
  if (isMock('replicate')) return (await mock()).getAnalysis(no)
  return getQuiet<ReplicateAnalysis>(`/api/v1/replicate/analyses/${enc(no)}`)
}

/**
 * POST /plans：同输入同方案（按内容哈希去重）；缺项不生成方案，业务码 1003 + `data.gaps`（用 {@link replicateGaps} 取）。
 * 带 `analysisNo`（自己的原片）或 `sampleId`（示例）二选一；已有方案后改标注 / 换图走 {@link replicatePatchAnnotations}。
 */
export async function replicateCreatePlan(p: ReplicatePlanRequest) {
  if (isMock('replicate')) return (await mock()).createPlan(p)
  return write(`plan:${JSON.stringify(p)}`, (h) => postQuiet<ReplicatePlan>('/api/v1/replicate/plans', p, h))
}

/** GET /plans/{no}：报价是方案里的快照（要最新价调 quote）；STALE 的方案带 supersededBy */
export async function replicateGetPlan(no: string) {
  if (isMock('replicate')) return (await mock()).getPlan(no)
  return getQuiet<ReplicatePlan>(`/api/v1/replicate/plans/${enc(no)}`)
}

/**
 * PATCH /plans/{no}/annotations：在同一份分析上用新标注出新方案（新 planNo / planHash / 报价 / 内容检查），原方案变 STALE。
 * 已 STALE 的方案：同样的改动（重试）回当初那张新方案，不同的改动 409 PLAN_STALE；缺项照常 1003 + gaps，原方案不动。
 */
export async function replicatePatchAnnotations(no: string, p: ReplicatePatchAnnotationsRequest) {
  if (isMock('replicate')) return (await mock()).patchAnnotations(no, p)
  return write(`patch:${no}:${JSON.stringify(p)}`, (h) =>
    patch<ReplicatePlan>(`/api/v1/replicate/plans/${enc(no)}/annotations`, p, h),
  )
}

/** POST /plans/{no}/save：保存为我的方案（name ≤40 字，不传由后端生成）；同一张方案只存一份，再存只改名（created=false） */
export async function replicateSavePlan(no: string, p: { name?: string } = {}) {
  if (isMock('replicate')) return (await mock()).savePlan(no, p)
  return write(`save:${no}:${p.name ?? ''}`, (h) =>
    postQuiet<ReplicateSavedPlan>(`/api/v1/replicate/plans/${enc(no)}/save`, p, h),
  )
}

/** GET /saved-plans?page=&size=：我的方案（page 从 1 起，size 默认 20、最大 50；limit = 每人上限） */
export async function replicateListSavedPlans(p: { page: number; size: number }) {
  if (isMock('replicate')) return (await mock()).listSavedPlans(p)
  return getQuiet<ReplicateSavedPlanList>('/api/v1/replicate/saved-plans', { page: p.page, size: Math.min(p.size, 50) })
}

/** DELETE /saved-plans/{id} */
export async function replicateDeleteSavedPlan(id: number) {
  if (isMock('replicate')) return (await mock()).deleteSavedPlan(id)
  return del<{ id: number }>(`/api/v1/replicate/saved-plans/${id}`)
}

/**
 * POST /saved-plans/{id}/reuse：用它再做一条 → 新方案（同一 Idempotency-Key 重放得到同一张）。
 * 原片不在且没传新视频 → 404 SOURCE_GONE（见 {@link replicateSourceGone}）；用新视频时旧改法里没有的项按缺项返回。
 */
export async function replicateReuseSavedPlan(id: number, p: ReplicateReuseRequest = {}) {
  if (isMock('replicate')) return (await mock()).reuseSavedPlan(id, p)
  return write(`reuse:${id}:${JSON.stringify(p)}`, (h) =>
    postQuiet<ReplicatePlan>(`/api/v1/replicate/saved-plans/${id}/reuse`, p, h),
  )
}

/** GET /samples?industry=：示例列表（industry 为行业 code，空 = 全部；非空返回该行业 + 通用示例） */
export async function replicateListSamples(p: { industry?: string } = {}) {
  if (isMock('replicate')) return (await mock()).listSamples(p)
  return getQuiet<ReplicateSampleList>('/api/v1/replicate/samples', p.industry ? { industry: p.industry } : undefined)
}

/** POST /samples/{id}/try：用示例体验（不花点数、不计限频、不建任务） */
export async function replicateTrySample(id: number) {
  if (isMock('replicate')) return (await mock()).trySample(id)
  return write(`try:${id}`, (h) => postQuiet<ReplicateSampleTry>(`/api/v1/replicate/samples/${id}/try`, {}, h))
}

/** POST /plans/{no}/quote：重算价格，`cost.validUntil` = 现在 +10 分钟；返回完整方案 */
export async function replicateQuote(no: string) {
  if (isMock('replicate')) return (await mock()).quote(no)
  return write(`quote:${no}`, (h) => postQuiet<ReplicatePlan>(`/api/v1/replicate/plans/${enc(no)}/quote`, {}, h))
}

/**
 * POST /plans/{no}/confirm：唯一出片入口，返回 JobView（不是 `{job}`）。
 * `expectedPoints` = 页面上展示的本次预留点数；与后端重算不一致 → 409 QUOTE_CHANGED（不动钱）。
 */
export async function replicateConfirm(
  no: string,
  p: { planHash: string; stage: 'first' | 'all'; expectedPoints: number },
) {
  if (isMock('replicate')) return (await mock()).confirm(no, p)
  return write(`confirm:${no}:${p.planHash}:${p.stage}`, (h) =>
    postQuiet<ReplicateJob>(`/api/v1/replicate/plans/${enc(no)}/confirm`, p, h),
  )
}

export async function replicateGetJob(id: number | string) {
  if (isMock('replicate')) return (await mock()).getJob(String(id))
  return getQuiet<ReplicateJob>(`/api/v1/replicate/jobs/${enc(String(id))}`)
}

/** GET /jobs?page=&size=：本人历史（id 倒序；page 从 1 起，size 默认 20、最大 50） */
export async function replicateListJobs(p: { page: number; size: number }) {
  if (isMock('replicate')) return (await mock()).listJobs(p)
  return getQuiet<ReplicateJobList>('/api/v1/replicate/jobs', { page: p.page, size: Math.min(p.size, 50) })
}

/** POST /jobs/{id}/continue：第 1 段满意后做剩下的（同 planHash 幂等） */
export async function replicateContinue(id: number | string, p: { planHash: string; expectedPoints: number }) {
  if (isMock('replicate')) return (await mock()).continueJob(String(id))
  return write(`continue:${id}:${p.planHash}`, (h) =>
    postQuiet<ReplicateJob>(`/api/v1/replicate/jobs/${enc(String(id))}/continue`, p, h),
  )
}

/** POST /jobs/{id}/stop：不继续了，只交付第 1 段（没有「取消整条」接口） */
export async function replicateStop(id: number | string) {
  if (isMock('replicate')) return (await mock()).stop(String(id))
  return write(`stop:${id}`, (h) => postQuiet<ReplicateJob>(`/api/v1/replicate/jobs/${enc(String(id))}/stop`, {}, h))
}

/** GET /models：可选出片模型（带 analysisNo / sampleId 时按这条视频的分段判断时长并给预计点数） */
export async function replicateModels(
  p: { analysisNo?: string; sampleId?: number; resolution?: string; aspectRatio?: string } = {},
) {
  if (isMock('replicate')) return (await mock()).models()
  const q: Record<string, string | number> = {}
  if (p.analysisNo) q.analysisNo = p.analysisNo
  if (p.sampleId) q.sampleId = p.sampleId
  if (p.resolution) q.resolution = p.resolution
  if (p.aspectRatio) q.aspectRatio = p.aspectRatio
  return getQuiet<ReplicateModelList>('/api/v1/replicate/models', q)
}

/** POST /jobs/{id}/cancel-rest：不做剩下的段（没开始的段退点，在途段做完；幂等，返回新的 JobView） */
export async function replicateCancelRest(id: number | string) {
  if (isMock('replicate')) return (await mock()).cancelRest(String(id))
  return write(`cancel-rest:${id}`, (h) =>
    postQuiet<ReplicateJob>(`/api/v1/replicate/jobs/${enc(String(id))}/cancel-rest`, {}, h),
  )
}

/** POST /jobs/{id}/segments/{k}/redo：重做失败的一段（每段 3 次、每任务 10 次） */
export async function replicateRedoSegment(id: number | string, k: number, p: { expectedPoints: number }) {
  if (isMock('replicate')) return (await mock()).redo(String(id), k)
  return write(`redo:${id}:${k}`, (h) =>
    postQuiet<ReplicateJob>(`/api/v1/replicate/jobs/${enc(String(id))}/segments/${k}/redo`, p, h),
  )
}

/** PUT /pref：账户偏好「以后直接全部做」（缺 autoContinue → 1002） */
export async function replicatePutPref(p: { autoContinue: boolean }) {
  if (isMock('replicate')) return { code: 0, msg: 'ok', data: p }
  return write(`pref:${p.autoContinue}`, (h) => put<{ autoContinue: boolean }>('/api/v1/replicate/pref', p, h))
}

/** 签名地址是否临近或已过期（默认提前 60 秒）：是则先重拉 job 再播放 / 下载 */
export function urlExpiringSoon(expiresAt?: string, marginSec = 60): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() - Date.now() < marginSec * 1000
}

// ---------------- 错误 → 用户文案 ----------------

/** 方案缺项：业务码 1003 且 `data.gaps` 有内容；不是缺项返回 null */
export function replicateGaps(err: unknown): ReplicateGap[] | null {
  const e = toApiError(err)
  if (!e || e.code !== 1003) return null
  const gaps = (e.data as { gaps?: ReplicateGap[] } | undefined)?.gaps
  return Array.isArray(gaps) && gaps.length ? gaps : null
}

/** 409 类（code=4002）的 reason 兜底文案（video-replicate-agent/EXPERIENCE.md §4.5 / 4.6 / 4.7）；后端 msg 有具体数字的优先用 msg */
const REASON_TEXT: Record<string, string> = {
  PLAN_STALE: '方案刚更新了，请再看一眼价格',
  /** 原方案已确认 / 正在确认时改标注（PATCH /plans/{no}/annotations 409） */
  PLAN_CONFIRMING: '这条方案正在生成，生成完可以基于它再做一条',
  QUOTE_CHANGED: '价格有变化，确认后按新价格生成',
  PLAN_EXPIRED: '这个方案已过期。点「重新生成方案」，不用重新分析',
  IN_PROGRESS: '正在提交…',
  NOT_WAITING: '这一步已经处理过了',
  SEGMENT_OK: '这一段已经做好了',
  SEGMENT_BUSY: '这一段还在生成',
  REDO_LIMIT: '这一段已经重做过很多次了，换个模型或调整方案再试',
  NOT_REDOABLE: '这个任务现在不能重做',
  SAVED_PLAN_LIMIT: '方案满了（50 个），请删除不用的',
  SOURCE_GONE: '这个方案的原片已经不在了。需要重新上传原片（方案设置会保留）',
}

/** 这些 reason 的 msg 里带具体数字（价变 340 → 380 点、重做了 3 次）或有多种情形（SOURCE_GONE：原片不在 / 示例已下架），优先显示后端原话 */
const PREFER_MSG = new Set(['QUOTE_CHANGED', 'REDO_LIMIT', 'NOT_WAITING', 'SOURCE_GONE'])

export interface ReplicateErrorOpts {
  /** 写操作失败：网络 / 服务异常时说清「没有扣点数，可以直接再点一次」 */
  write?: boolean
  fallback?: string
}

/** 保存的方案原片已不在（404 SOURCE_GONE）：引导重新上传原片，再带 analysisNo 用它做 */
export function replicateSourceGone(err: unknown): boolean {
  return toApiError(err)?.reason === 'SOURCE_GONE'
}

/**
 * 整个功能没开（gateway 配置 Replicate.Enabled=false，模块未装配）时页面上的说法。
 * 区分依据：读接口（limits / 历史 / 我的方案）也回 7003 只可能是没装配——运行时总开关只拦写接口，那才是「维护中」。
 */
export const REPLICATE_OFF_TEXT = '视频做同款暂未开放，开放后即可使用'

/** 功能总开关没开（7003 且是 Go 的固定文案「功能暂未开放」） */
export function replicateNotReady(err: unknown): boolean {
  const e = toApiError(err)
  return !!e && e.code === 7003 && /暂未开放/.test(e.message)
}

/**
 * 任何 replicate 接口失败 → 用户文案。顺序：网络 → reason 表 → 业务码（3003 点数不足 / 5001 未配价 / 7003 / 1002 / 1003 / 4001）→ 兜底。
 * 不展示错误码、英文、堆栈。
 */
export function replicateErrorText(err: unknown, opts: ReplicateErrorOpts = {}): string {
  const e = toApiError(err)
  const net = opts.write
    ? '没提交成功，没有扣点数。可以直接再点一次，不会重复扣点'
    : '网络异常只影响页面显示，生成仍在进行'
  if (!e)
    return opts.fallback ?? (opts.write ? '没成功，没有多扣点数，可以再点一次' : '出了点问题，我们在处理。没有多扣点数')
  if (e.isNetwork) return net
  const r = e.reason ?? ''
  if (REASON_TEXT[r]) return PREFER_MSG.has(r) && e.message ? e.message : REASON_TEXT[r]!
  switch (e.code) {
    case 3003:
      return e.message || '点数不足' // 「点数不足，还差 N 点」
    case 5001:
      return e.message || '该功能暂未配置价格，请联系客服'
    case 7003:
      // 功能未开放（Go 固定文案）→ 维护文案；多段能力未开放时 msg 本身就是建议（「超过 N 秒的视频要拆成几段…」）
      return replicateNotReady(err) ? '视频做同款正在维护，暂时不能提交。已提交的任务不受影响' : e.message
    case 1002:
      return e.message || '缺少请求标识，请刷新页面后重试'
    case 1003:
      return e.message || '参数不对，请刷新页面后重试' // 含「时长不适合拆分，建议剪到 N 秒内再试」
    case 4001:
      return e.message || '找不到这个内容，可能已被删除'
    case 4002:
      return e.message || opts.fallback || '这一步现在不能做，请刷新后再试'
    default:
      break
  }
  if (e.httpStatus && e.httpStatus >= 500) return '服务暂时忙，没有扣点数。请稍后重试'
  return e.message || opts.fallback || '出了点问题，我们在处理。没有多扣点数'
}
