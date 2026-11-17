/**
 * 复刻智能体的对话卡片与同意卡（契约：fusion-aigc/.scratch/video-replicate-agent/CONTRACT.md §C / §D）。
 *
 * <p>卡片帧：PROCESSING `tool_result` 的 `result` = {resultType: replicate_card, isError, toolName, entity:{type,id}, view}，
 * view 是 Go 的 AnalysisView / PlanView / JobView 原样（camelCase）。同一 `entity.type + entity.id` 的新帧替换旧卡（原位更新）。
 * 签名播放地址会被事件清洗剔除，卡片自己经只读 GET 取现签地址（见 views/agent/replicate/useJobCard）。
 * 失败帧：isError=true，result.result（或 result 本身）= {errorCode, message, retryable}。
 *
 * <p>同意卡：budget_confirm 中断的 question 带 `replicate_consent`，渲染成同意卡，主按钮以 `continue`、「先不做」以 `cancel`
 * 回答同一个中断；卡片绝不直接调复刻 REST 的 confirm / continue / redo。
 *
 * <p>线上键名可能是 snake_case（契约原文）或被 Java 整体转成 lowerCamel，这里两种都认。
 */
import type {
  ReplicateAnalysis,
  ReplicateExport,
  ReplicateJob,
  ReplicatePlan,
  ReplicatePreview,
  ReplicatePublishCopy,
} from './replicate.ts'

export type ReplicateCardType = 'analysis' | 'plan' | 'job' | 'preview' | 'batch' | 'copy' | 'export'

export interface ReplicateCardError {
  code: string
  message: string
  retryable: boolean
}

export interface ReplicateCardFrame {
  /** entity.type + ':' + entity.id；错误帧没有 entity 时是一次性的 `err:<序号>` */
  key: string
  type: ReplicateCardType | null
  id: string
  toolName: string
  isError: boolean
  error?: ReplicateCardError
  view?: ReplicateAnalysis | ReplicatePlan | ReplicateJob | ReplicatePreview | ReplicateBatch | ReplicatePublishCopy | ReplicateExport
}

/** 批量卡里的一条任务摘要（Go JobSummary 的子集，只取卡片用到的字段） */
export interface ReplicateBatchJob {
  jobId: number
  status: ReplicateJob['status']
  statusLabel: string
  segDone: number
  segTotal: number
  money?: ReplicateJob['money']
}

/** Go BatchView（CONTRACT §M） */
export interface ReplicateBatch {
  batchId: string
  planNo: string
  jobs: ReplicateBatchJob[]
  total: number
  status: string
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown) => (v == null ? '' : String(v))
/** 同一字段的 camel / snake 两种写法，取先出现的 */
const pick = (o: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (o[n] !== undefined && o[n] !== null) return o[n]
  return undefined
}

export const REPLICATE_CARD_RESULT_TYPE = 'replicate_card'
const TYPES: readonly string[] = ['analysis', 'plan', 'job', 'preview', 'batch', 'copy', 'export']
let errSeq = 0

/** 解析一条 tool_result 的 payload；不是复刻卡片返回 null */
export function parseReplicateCard(payload: Record<string, unknown>): ReplicateCardFrame | null {
  const result = rec(payload.result)
  if (str(pick(result, 'resultType', 'result_type')) !== REPLICATE_CARD_RESULT_TYPE) return null
  const isError = pick(result, 'isError', 'is_error') === true
  const entity = rec(result.entity)
  const rawType = str(entity.type)
  const type = TYPES.includes(rawType) ? (rawType as ReplicateCardType) : null
  const id = str(entity.id)
  const toolName = str(pick(result, 'toolName', 'tool_name')) || str(pick(payload, 'toolName', 'tool_name'))
  if (isError) {
    const e = rec(result.result ?? result)
    return {
      key: type && id ? `${type}:${id}` : `err:${++errSeq}`,
      type,
      id,
      toolName,
      isError: true,
      error: {
        code: str(pick(e, 'errorCode', 'error_code')),
        message: str(e.message) || str(payload.message) || '这一步没有成功',
        retryable: e.retryable === true,
      },
    }
  }
  if (!type || !id) return null
  const view = rec(result.view)
  if (!Object.keys(view).length) return null
  return { key: `${type}:${id}`, type, id, toolName, isError: false, view: view as unknown as ReplicateCardFrame['view'] }
}

/** 同 key 原位替换，没有才追加（错误帧 key 唯一，永远追加）。返回新数组 */
export function upsertCard(list: ReplicateCardFrame[], next: ReplicateCardFrame): ReplicateCardFrame[] {
  const i = list.findIndex((c) => c.key === next.key)
  if (i < 0) return [...list, next]
  const out = list.slice()
  out[i] = next
  return out
}

/** 卡片在页面里的锚点属性（跨轮进度提示据此滚动到原卡片） */
export const CARD_ANCHOR_ATTR = 'data-rc-key'

/**
 * 跨轮进度提示的一行文案：任务取 statusLabel + 已完成段数，方案取标题；分析 / 错误帧不出提示（返回空串）。
 */
export function cardChipText(f: ReplicateCardFrame): string {
  if (f.isError || !f.view) return ''
  if (f.type === 'job') {
    const j = f.view as ReplicateJob
    const prog = j.segTotal > 1 ? `（${j.segDone}/${j.segTotal} 段）` : ''
    return `${j.statusLabel || '任务进行中'}${prog}`
  }
  if (f.type === 'batch') {
    const b = f.view as ReplicateBatch
    const jobs = b.jobs ?? []
    const done = jobs.filter((j) => ['succeeded', 'partial', 'failed', 'canceled'].includes(j.status)).length
    return `批量 ${b.total || jobs.length} 条（已结束 ${done} 条）`
  }
  if (f.type === 'plan') {
    const t = (f.view as ReplicatePlan).title
    return t ? `方案已更新：${t}` : '方案已更新'
  }
  return ''
}

// ---------------- 同意卡 ----------------

export interface ReplicateConsent {
  action: 'confirm' | 'continue' | 'redo' | 'refine' | 'stop' | 'cancel_rest' | 'batch'
  points: number
  restPoints: number
  etaText: string
  refundText: string
  aiMarkText: string
  watermarkText: string
  redoText: string
  needsPortraitConsent: boolean
  /** 后端按阈值判定的大额：金额标红 + 必须勾选确认 */
  largeAmount: boolean
  planNo: string
  jobId: string
  segIndex: number
  /** 终止卡（stop / cancel_rest）：退回多少点、取消几段、几段正在生成会做完 */
  refundPoints: number
  cancelSegments: number
  running: number
  /** 价格变了（涨价或复刻服务判价变）时的原价；0 = 没变 */
  priceChangedFrom: number
  /** 批量同意卡（action=batch）：每条的名称与点数；points 是合计 */
  rows: { label: string; points: number }[]
}

const CONSENT_ACTIONS = ['confirm', 'continue', 'redo', 'refine', 'stop', 'cancel_rest', 'batch'] as const
export const isCancelConsent = (c: ReplicateConsent) => c.action === 'stop' || c.action === 'cancel_rest'

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/** 读 question 里的 replicate_consent（缺失 / 空对象返回 null）；缺 points 视为无效，不渲染成同意卡 */
export function parseConsent(raw: unknown): ReplicateConsent | null {
  const c = rec(raw)
  if (!Object.keys(c).length) return null
  const action = str(c.action)
  const points = num(c.points)
  if (!(points >= 0) || c.points === undefined) return null
  return {
    action: (CONSENT_ACTIONS as readonly string[]).includes(action) ? (action as ReplicateConsent['action']) : 'confirm',
    points,
    restPoints: num(pick(c, 'restPoints', 'rest_points')),
    etaText: str(pick(c, 'etaText', 'eta_text')),
    refundText: str(pick(c, 'refundText', 'refund_text')),
    aiMarkText: str(pick(c, 'aiMarkText', 'ai_mark_text')),
    watermarkText: str(pick(c, 'watermarkText', 'watermark_text')),
    redoText: str(pick(c, 'redoText', 'redo_text')),
    needsPortraitConsent: pick(c, 'needsPortraitConsent', 'needs_portrait_consent') === true,
    largeAmount: pick(c, 'largeAmount', 'large_amount') === true,
    planNo: str(pick(c, 'planNo', 'plan_no')),
    jobId: str(pick(c, 'jobId', 'job_id')),
    segIndex: num(pick(c, 'segIndex', 'seg_index')),
    refundPoints: num(pick(c, 'refundPoints', 'refund_points')),
    cancelSegments: num(pick(c, 'cancelSegments', 'cancel_segments')),
    running: num(pick(c, 'running', 'running')),
    priceChangedFrom: num(pick(c, 'priceChangedFrom', 'price_changed_from')),
    rows: (Array.isArray(c.rows) ? c.rows : []).map((r) => ({ label: str(rec(r).label), points: num(rec(r).points) })),
  }
}

/** 主按钮文案：先做第 1 段 · N 点 / 继续 · N 点 / 重做第 k 段 · N 点 */
export function consentPrimaryLabel(c: ReplicateConsent): string {
  const pts = c.points.toLocaleString('en-US')
  if (c.action === 'continue') return `继续 · ${pts} 点`
  if (c.action === 'redo') return `重做第 ${c.segIndex || 1} 段 · ${pts} 点`
  if (c.action === 'refine') return `精修第 ${c.segIndex || 1} 段 · ${pts} 点`
  if (c.action === 'batch') return `做这 ${c.rows.length} 条 · 合计 ${pts} 点`
  if (c.action === 'stop') return '确认不继续'
  if (c.action === 'cancel_rest') return `确认不做剩下的段 · 退回 ${c.refundPoints.toLocaleString('en-US')} 点`
  if (c.restPoints <= 0) return `开始生成 · ${pts} 点`
  return `先做第 1 段 · ${pts} 点`
}

/** 从中断 / 回退 tool_result 的 payload 与 questions 里找 replicate_consent（payload 顶层或 budget_confirm 题上） */
export function findConsent(payload: Record<string, unknown>, questions: unknown): ReplicateConsent | null {
  const top = parseConsent(pick(payload, 'replicateConsent', 'replicate_consent'))
  if (top) return top
  for (const q of Array.isArray(questions) ? questions : []) {
    const r = rec(q)
    const qid = str(pick(r, 'questionId', 'question_id'))
    if (qid && qid !== 'budget_confirm') continue
    const c = parseConsent(pick(r, 'replicateConsent', 'replicate_consent'))
    if (c) return c
  }
  return null
}
