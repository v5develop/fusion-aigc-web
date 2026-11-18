/**
 * 视频做同款的本地 mock（`?mock=replicate` 打开，见 mock-switch.ts）：内存状态机，按「流逝时间」推进，
 * 轮询 GET 时现算，不起定时器。数据全是占位；时长压缩（第 1 段约 8 秒、其余约 8 秒、拼接 3 秒）便于联调看流程。
 *
 * 响应形状与 Go 真实输出一致（fusion_aigc_go/docs/api/api-replicate.md、app/replicate/core 的 View 结构）：
 * 分析状态小写 + stages[]；PlanView 带 cost / stageQuotes / eta / policy / confirmButton；JobView 状态小写、
 * 段 state/stateLabel/moneyText/redoable、decision、money；缺项走 code=1003 + data.gaps；409 走 code=4002 + reason。
 * 成片 / 每段给 videoRid + 现签 videoUrl / coverUrl（mock 里 url 直接是占位图地址），带 urlExpiresAt。
 *
 * 失败演练（控制台）：
 * - `localStorage.setItem('fusion:mock-replicate-fail','2')` 让第 2 段失败一次（退点后可「重做这一段」）；
 * - `localStorage.setItem('fusion:mock-replicate-err','QUOTE_CHANGED')` 让下一次写接口回对应的 409 reason（PLAN_STALE / QUOTE_CHANGED / PLAN_EXPIRED /
 *   IN_PROGRESS / NOT_WAITING / SEGMENT_OK / SEGMENT_BUSY / REDO_LIMIT / NOT_REDOABLE），或 `INSUFFICIENT`（3003）/ `NO_PRICE`（5001）/ `NOT_READY`（7003）；触发一次后自动清除。
 * - `localStorage.setItem('fusion:mock-replicate-gone','1')` 让「我的方案」全部变成原片已不在（sourceAvailable=false，「用它做」回 404 SOURCE_GONE）。
 *
 * 示例 / 我的方案 / 改标注（契约 §10）：示例列表与 try、PATCH 改标注（旧方案变 STALE + supersededBy）、GET 方案、保存 / 列表 / 删除 / reuse。
 */
import { ApiError } from './index.ts'
import type { ReplicateExportList,
  ReplicateAnalysis,
  ReplicateAnalysisResult,
  ReplicateClassifyResult,
  ReplicateWishResult,
  ReplicateRefKind,
  ReplicateGap,
  ReplicateJob,
  ReplicateJobList,
  ReplicateJobSegment,
  ReplicateLimits,
  ReplicateModelList,
  ReplicatePatchAnnotationsRequest,
  ReplicatePlan,
  ReplicatePlanRequest,
  ReplicateReuseRequest,
  ReplicateSample,
  ReplicateSampleList,
  ReplicateSampleTry,
  ReplicateSavedPlan,
  ReplicateSavedPlanList,
  ReplicateExport,
} from './replicate.ts'

type Resp<T> = { code: number; msg: string; data: T }
const ok = <T,>(data: T): Resp<T> => ({ code: 0, msg: 'ok', data })
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()
const pts = (n: number) => `${n} 点`

const LIMITS: ReplicateLimits = {
  segCapSec: 15,
  specMinSec: 4,
  overlapSec: 0.4,
  minSegSec: 3,
  minTailSec: 2,
  maxSegments: 6,
  minDurationSec: 2,
  maxDurationSec: 80,
  segTargetSec: 12,
  longformEnabled: true,
  maxInFlight: 3,
  continueHours: 24,
  redoMaxPerSegment: 3,
  // mock 调低，便于「一次全部做」（340 点）验证二次确认；真实口径由后端下发
  confirmThresholdPoints: 300,
}

const SEGS = [
  { t0: 0, t1: 15, gen: 15, pts: 150, cut: 'cut', label: '镜头切换处' },
  { t0: 15, t1: 30, gen: 15, pts: 100, cut: 'pause', label: '说话停顿处' },
  { t0: 30, t1: 34, gen: 4, pts: 90, cut: 'end', label: '结尾' },
]
const FIRST = SEGS[0]!.pts
const REST = SEGS[1]!.pts + SEGS[2]!.pts
const TOTAL = FIRST + REST

function art(h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 45% 62%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 40% 28%)"/></linearGradient></defs><rect width="270" height="480" fill="url(#g)"/><circle cx="135" cy="190" r="70" fill="rgba(255,255,255,.18)"/><rect x="50" y="330" width="170" height="60" rx="30" fill="rgba(255,255,255,.14)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 控制台演练：下一次写接口回指定的错误（一次性） */
function maybeFail() {
  let r = ''
  try {
    r = localStorage.getItem('fusion:mock-replicate-err') || ''
    if (r) localStorage.removeItem('fusion:mock-replicate-err')
  } catch {
    return
  }
  if (!r) return
  const text: Record<string, string> = {
    PLAN_STALE: '方案刚更新了，请再看一眼价格',
    QUOTE_CHANGED: '价格有变化：340 → 380 点。确认后按新价格生成',
    PLAN_EXPIRED: '这个方案已过期。点「重新生成方案」，不用重新分析',
    IN_PROGRESS: '正在提交…',
    NOT_WAITING: '这一步已经处理过了',
    SEGMENT_OK: '这一段已经做好了',
    SEGMENT_BUSY: '这一段还在生成',
    REDO_LIMIT: '这一段已经重做了 3 次，换个模型或调整方案再试',
    NOT_REDOABLE: '这个任务现在不能重做',
  }
  if (r === 'INSUFFICIENT') throw new ApiError('点数不足，还差 120 点', { code: 3003, reason: 'INSUFFICIENT_POINTS' })
  if (r === 'NO_PRICE') throw new ApiError('该功能暂未配置价格，请联系客服', { code: 5001 })
  if (r === 'NOT_READY') throw new ApiError('功能暂未开放', { code: 7003, reason: 'FEATURE_NOT_READY' })
  if (text[r]) throw new ApiError(text[r]!, { code: 4002, reason: r })
}

// ---------------- 分析 ----------------

const RESULT: ReplicateAnalysisResult = {
  promptVersion: 'mock',
  durationS: 34,
  width: 1080,
  height: 1920,
  hasAudio: true,
  type: 'promo',
  purpose: 'sell',
  audioKind: 'speech',
  audioNote: '',
  dims: {
    model: { present: true, desc: '一位穿制服的技师', risk: 'high' },
    product: { present: true, desc: '泡脚桶和套餐展示牌', risk: 'mid' },
    scene: { present: true, desc: '木质装修的包间，暖色灯光', risk: 'mid' },
    garment: {
      present: true,
      desc: '深色中式制服',
      risk: 'mid',
      occurrences: [
        { t0: 0, t1: 14, desc: '深色中式制服', subject: 's1' },
        { t0: 14, t1: 34, desc: '白色围裙', subject: 's1' },
      ],
    },
    line: { present: true, desc: '有人声讲解', risk: 'low' },
    camera: { present: true, desc: '缓慢推进的中景', risk: 'low' },
    motion: { present: false, desc: '', risk: 'low' },
    expression: { present: false, desc: '', risk: 'low' },
    accessory: { present: false, desc: '', risk: 'low' },
    light: { present: true, desc: '暖光', risk: 'low' },
    style: { present: true, desc: '写实、暖调', risk: 'low' },
  },
  dimOrder: ['model', 'product', 'scene', 'garment', 'line', 'camera', 'light', 'style', 'motion', 'expression', 'accessory'],
  subjects: [
    { id: 's1', name: '左侧技师', desc: '穿深色制服的技师' },
    { id: 's2', name: '右侧顾客', desc: '坐着泡脚的女顾客' },
  ],
  sections: [
    { index: 1, t0: 0, t1: 12, desc: '门头和前台，暖光，镜头缓慢推进' },
    { index: 2, t0: 12, t1: 25, desc: '包间环境和技师，近景' },
    { index: 3, t0: 25, t1: 34, desc: '泡脚桶和套餐展示牌特写' },
  ],
  onScreenText: [],
  lines: [],
  summary: '看懂了：3 个镜头，技师介绍门店和套餐；有人声讲解；画面上没有字幕',
}

interface AnaRow {
  no: string
  start: number
  sample: boolean
}
const analyses = new Map<string, AnaRow>()
let seqNo = 1
const STAGES = [
  { key: 'read', label: '正在读取视频…' },
  { key: 'frames', label: '正在抽取画面…' },
  { key: 'lines', label: '正在听台词…' },
  { key: 'understand', label: '正在看懂画面…' },
] as const

function anaView(a: AnaRow): ReplicateAnalysis {
  const el = (now() - a.start) / 1000
  const total = a.sample ? 0 : 6
  const base = { analysisNo: a.no, cached: a.sample, freeText: '分析免费，不扣点数；只分析一次，之后改方案不用再等', elapsedS: Math.round(Math.min(el, total)) }
  if (el >= total) {
    return {
      ...base,
      status: 'succeeded',
      stages: STAGES.map((s) => ({ ...s, status: 'done' as const })),
      ...(a.sample ? { cachedText: '这条视频你分析过，直接用上次的结果' } : {}),
      result: RESULT,
    }
  }
  const at = Math.min(STAGES.length - 1, Math.floor((el / total) * STAGES.length))
  return {
    ...base,
    status: 'running',
    stages: STAGES.map((s, i) => ({ ...s, status: i < at ? ('done' as const) : i === at ? ('active' as const) : ('pending' as const) })),
  }
}

// ---------------- 方案 ----------------

interface PlanRow {
  no: string
  hash: string
  req: ReplicatePlanRequest
  createdAt: number
  parent?: string
  supersededBy?: string
  /** 被这次改动（PATCH 的内容）取代：同样的改动重试回同一张新方案 */
  supersededKey?: string
  confirmed?: boolean
}
const plans = new Map<string, PlanRow>()
const plansByContent = new Map<string, PlanRow>()

const DIM_LABEL: Record<string, string> = {
  model: '人物', garment: '服装', accessory: '配饰', product: '商品', motion: '动作', expression: '表情',
  line: '台词', camera: '镜头', light: '光线', scene: '场景·门店', style: '风格',
}
const MODE_LABEL = { keep: '不改', replace: '换成我的图', describe: '按我写的改' } as const
const AUDIO_LABEL = { regenerate: '重新配乐', keep: '保留原声', mute: '无声', revoice: '换个声音' } as const

/** 同 Go validate 的子集：未知模型 / 缺图 / 缺说明 / 原片没有这一项 / 什么都没改 */
function validate(p: ReplicatePlanRequest): ReplicateGap[] {
  const gaps: ReplicateGap[] = []
  if (!['vid.seedance-2.5', 'vid.seedance-2', 'vid.minimax-h3', 'vid.wan-3.0'].includes(p.modelGroup)) {
    gaps.push({ code: 'MODEL_UNKNOWN', field: 'modelGroup', message: '这个模型暂时不可用，请换一个' })
  }
  if (p.refImages.length > 9) gaps.push({ code: 'REF_TOO_MANY', field: 'refImages', message: '最多放 9 张' })
  let changed = p.annotations.texts?.length ?? 0
  for (const [k, e] of Object.entries(p.annotations.dims)) {
    if (!e || e.mode === 'keep') continue
    const label = DIM_LABEL[k] ?? k
    const field = `dims.${k}`
    if (e.mode === 'replace') {
      if (!RESULT.dims[k as keyof typeof RESULT.dims]?.present) gaps.push({ code: 'DIM_ABSENT', field, message: `${label}：视频里没有这一项` })
      if (!e.refs?.length) {
        gaps.push({
          code: 'REF_MISSING',
          field,
          message: k === 'product' ? '要把商品换掉，需要一张你的商品图。放一张正面清晰的就行' : k === 'model' ? '换人需要一张人物正脸照，生成才稳定' : `${label}：需要放一张图`,
        })
      }
    } else if (!e.note?.trim()) {
      gaps.push({ code: 'NOTE_MISSING', field, message: `${label}：写一句话再继续` })
    }
    changed++
  }
  if (!changed && !gaps.length) gaps.push({ code: 'NOTHING_CHANGED', field: 'dims', message: '勾出你想换的地方，没勾的保持原样' })
  if (!p.analysisNo && !p.sampleId) gaps.push({ code: 'DIM_UNKNOWN', field: 'analysisNo', message: '先放入一条视频' })
  return gaps
}

/** mock 里「rid ↔ 地址」：refImages 可以是地址或 `mr://rid` */
const ridUrl = new Map<string, string>()
function ridOf(ref: string, i: number): string {
  if (ref.startsWith('mr://')) return ref.slice(5)
  const rid = `mock-ref-${[...ref].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}-${i}`
  ridUrl.set(rid, ref)
  return rid
}

function planOf(row: PlanRow): ReplicatePlan {
  const ann = row.req.annotations
  const changes: ReplicatePlan['changes'] = []
  const kept: ReplicatePlan['kept'] = []
  for (const k of RESULT.dimOrder) {
    const d = RESULT.dims[k as keyof typeof RESULT.dims]
    const e = ann.dims[k as keyof typeof ann.dims]
    const mode = e?.mode ?? 'keep'
    if (!d?.present && mode === 'keep') continue
    const line = { key: k, label: DIM_LABEL[k]!, mode, modeLabel: MODE_LABEL[mode], current: d?.desc ?? '', risk: d?.risk, ...(e?.note ? { note: e.note } : {}), ...(e?.refs ? { refs: e.refs } : {}) }
    ;(mode === 'keep' ? kept : changes).push(line)
  }
  const risks: string[] = []
  for (const c of changes) if (c.risk === 'high') risks.push(`${c.label}比较难换（涉及人脸或细节），效果可能和预期有出入`)
  if (ann.audio === 'keep') risks.push('原声里的台词、店名、电话会原样保留；画面换了人或店之后，口型和内容可能对不上。原片的声音和音乐可能有版权，发布前请自行确认可用')
  if (ann.texts?.length) risks.push('画面文字将在生成后由系统叠加，不会交给 AI 画')
  const eta = (lo: number, hi: number) => ({ lowSec: lo, highSec: hi, text: `预计 ${Math.round(lo / 60)}–${Math.round(hi / 60)} 分钟` })
  return {
    planNo: row.no,
    planHash: row.hash,
    status: row.supersededBy ? 'STALE' : row.confirmed ? 'CONFIRMED' : 'READY',
    ...(row.supersededBy ? { supersededBy: row.supersededBy } : {}),
    ...(row.parent ? { parentPlanNo: row.parent } : {}),
    ...(row.req.sampleId ? { sampleId: row.req.sampleId } : {}),
    annotations: { ...ann, audio: ann.audio ?? 'regenerate' },
    refImages: row.req.refImages.map((r, i) => ({ index: i + 1, rid: ridOf(r, i + 1) })),
    resolution: row.req.resolution || '720p',
    aspectRatio: row.req.aspectRatio ?? '',
    title: '这条方案会改什么',
    overview: [...changes.map((c) => `换${c.label}`), AUDIO_LABEL[ann.audio ?? 'regenerate'], `共 ${RESULT.durationS} 秒`, `${SEGS.length} 段`].join(' · '),
    changes,
    kept,
    risks,
    timeline: {
      title: `这条视频会拆成 ${SEGS.length} 段分别生成，再拼成一条`,
      explain: `这条视频 ${RESULT.durationS} 秒。AI 单次最长生成 ${LIMITS.segCapSec} 秒，所以拆成 ${SEGS.length} 段。拆的位置选在镜头切换或说话停顿的地方，看起来自然`,
      single: false,
      seamTip: `这里是两段的拼接处，会多留 ${LIMITS.overlapSec} 秒让画面接得更顺`,
      segments: SEGS.map((s, i) => ({ index: i + 1, t0: s.t0, t1: s.t1, genDuration: s.gen, cutReason: s.cut, cutLabel: s.label, points: s.pts })),
    },
    modelGroup: row.req.modelGroup,
    cost: {
      lines: SEGS.map((s, i) => ({ index: i + 1, seconds: s.gen, points: s.pts })),
      first: FIRST,
      rest: REST,
      total: TOTAL,
      restSegments: SEGS.length - 1,
      totalSeconds: SEGS.reduce((a, s) => a + s.gen, 0),
      validUntil: new Date(now() + 10 * 60000).toISOString(),
      defaultStage: 'first',
      firstText: `现在先做第 1 段：${pts(FIRST)}`,
      restText: `满意之后再做剩下 ${SEGS.length - 1} 段：约 ${pts(REST)}（现在不收，你点「继续」才预留）`,
      totalText: `全部做完共约 ${pts(TOTAL)}`,
      explain: '按每段生成的秒数计点。哪一段没生成成功，就退哪一段的点数',
      overlapText: `段与段之间多留的 ${LIMITS.overlapSec} 秒也按秒计点`,
      holdText: '确认后先预留点数（从可用余额里暂时扣出）；生成成功才真正扣除，没成功的段会退回',
    },
    stageQuotes: { first: FIRST, rest: REST, total: TOTAL },
    eta: { first: eta(240, 360), rest: eta(240, 360), total: eta(420, 720), prior: true, fast: eta(420, 720), smooth: eta(720, 1080) },
    ...(row.req.continuity === 'smooth' ? { continuity: 'smooth' as const } : {}),
    policy: { watermark: false, text: '成片：不带水印' },
    confirmButton: `先做第 1 段（${pts(FIRST)}）`,
    copyright: '默认会改写原视频的台词和画面文字，只沿用结构和节奏',
    prompts: SEGS.map((_, i) => `第 ${i + 1} 段：参考 @视频1 的镜头和节奏，按方案替换内容`),
    expiresAt: new Date(row.createdAt + 7 * 86400000).toISOString(),
    analysis: { summary: RESULT.summary, durationS: RESULT.durationS },
  }
}

// ---------------- 任务 ----------------

const SPEED = 1
interface JobRow {
  id: number
  planNo: string
  planHash: string
  createdAt: number
  staged: boolean
  /** 第 1 段完成后用户点「继续」的时间 */
  continuedAt?: number
  stoppedAt?: number
  failedOnce: boolean
  redo: Record<number, number>
  redoCount: Record<number, number>
  refunded: Record<number, number>
}
const jobs = new Map<number, JobRow>()
const SEG1 = 8000 / SPEED
const REST_MS = 8000 / SPEED
const STITCH = 3000 / SPEED

function jobView(j: JobRow): ReplicateJob {
  const t = now()
  const failIdx = Number(localStorage.getItem('fusion:mock-replicate-fail') || 0)
  const segs: ReplicateJobSegment[] = SEGS.map((s, i) => {
    const k = i + 1
    const base = { index: k, points: s.pts, redoable: false, redos: j.redoCount[k] ?? 0 }
    const redoAt = j.redo[k]
    const startAt = redoAt ?? (k === 1 ? j.createdAt : j.continuedAt)
    if (j.stoppedAt && (!startAt || startAt > j.stoppedAt)) return { ...base, points: 0, state: 'canceled', stateLabel: '未做', text: '没有继续，这一段没有收费' }
    if (!startAt) return { ...base, points: 0, state: 'not_started', stateLabel: '满意第 1 段后再做' }
    const dur = k === 1 ? SEG1 : REST_MS
    const p = Math.min(1, (t - startAt) / dur)
    if (failIdx === k && !j.failedOnce && !redoAt && p >= 0.6) {
      j.refunded[k] = s.pts
      return {
        ...base,
        state: 'failed',
        stateLabel: '没成功',
        text: '这一段这次没生成出来',
        moneyText: `已退回 ${s.pts} 点`,
        redoable: true,
        redoLabel: `重做这一段（${s.pts} 点）`,
      }
    }
    if (p < 1) return { ...base, state: p < 0.08 ? 'queued' : 'running', stateLabel: p < 0.08 ? '排队中' : '生成中' }
    return { ...base, state: 'succeeded', stateLabel: '已完成', videoRid: `mock-seg-${k}`, videoUrl: art(30 + k * 40), coverUrl: art(30 + k * 40) }
  })
  const allDone = segs.every((s) => s.state === 'succeeded')
  const anyFail = segs.some((s) => s.state === 'failed')
  const running = segs.some((s) => s.state === 'running' || s.state === 'queued')
  const lastDone = Math.max(...segs.map((s, i) => (s.state === 'succeeded' ? (j.redo[i + 1] ?? (i === 0 ? j.createdAt : (j.continuedAt ?? 0))) + (i === 0 ? SEG1 : REST_MS) : 0)))
  const stitched = allDone && t - lastDone >= STITCH
  const first = segs[0]!
  const waiting = j.staged && !j.continuedAt && !j.stoppedAt && first.state === 'succeeded'

  let status: ReplicateJob['status'] = 'running'
  let message = ''
  let result: ReplicateJob['result']
  if (j.stoppedAt && !running) {
    status = 'succeeded'
    message = '好的，已结束。第 1 段留给你，可以下载，没有再收费'
    result = { status: 'ready', kind: 'partial', videoRid: 'mock-part', videoUrl: art(30 + 40), coverUrl: art(30 + 40) }
  } else if (!running && anyFail) {
    status = 'partial'
    result = { status: 'ready', kind: 'preview', videoRid: 'mock-prev', videoUrl: art(300), coverUrl: art(300), missing: segs.filter((s) => s.state === 'failed').map((s) => s.index), text: '这是预览版，有一段还没做好，暂时不能下载' }
  } else if (stitched) {
    status = 'succeeded'
    result = { status: 'ready', kind: 'full', videoRid: 'mock-full', videoUrl: art(300), coverUrl: art(300) }
  } else if (waiting) {
    status = 'waiting'
  } else if (!running && j.continuedAt && !allDone) {
    status = 'continuing'
  } else if (segs.every((s) => s.state === 'queued')) {
    status = 'queued'
  }

  const done = segs.filter((s) => s.state === 'succeeded').length
  const failed = segs.filter((s) => s.state === 'failed').length
  const held = segs.filter((s) => s.state === 'running' || s.state === 'queued').reduce((a, s) => a + s.points, 0)
  const confirmed = segs.filter((s) => s.state === 'succeeded').reduce((a, s) => a + s.points, 0)
  const refunded = Object.values(j.refunded).reduce((a, b) => a + b, 0)

  const rest = segs.slice(1)
  const decision: ReplicateJob['decision'] = waiting
    ? {
        kind: 'continue',
        title: '第 1 段做好了，和原片对比看看。',
        options: [
          { action: 'continue', label: `满意，继续做剩下 ${rest.length} 段（预计 ${pts(REST)}）`, points: REST },
          { action: 'adjust', label: '调整后重做第 1 段' },
          { action: 'stop', label: '不继续了' },
        ],
        autoContinueLabel: '以后直接全部做（不再先看第 1 段）',
        expiresAt: new Date(j.createdAt + SEG1 + (LIMITS.continueHours - 1) * 3600000).toISOString(),
        remainingText: `还剩 ${LIMITS.continueHours - 1} 小时`,
      }
    : status === 'partial'
      ? {
          kind: 'redo',
          title: '这次有一段没成功',
          options: segs.filter((s) => s.redoable).map((s) => ({ action: 'redo' as const, label: s.redoLabel ?? '重做这一段', points: s.points, segIndex: s.index })),
        }
      : undefined

  const labels: Record<ReplicateJob['status'], string> = {
    submitting: '正在提交',
    queued: '排队中',
    running: '生成中',
    waiting: '第 1 段做好了',
    continuing: '正在继续',
    succeeded: '已完成',
    partial: `做好了 ${done} 段，${SEGS.length - done} 段没成功`,
    failed: '没有生成成功',
    canceled: '已取消',
  }
  return {
    jobId: j.id,
    taskId: `AiCreation_LF_mock${j.id}`,
    planNo: j.planNo,
    planHash: j.planHash,
    ...(plans.get(j.planNo)?.req.continuity === 'smooth' ? { continuity: 'smooth' as const } : {}),
    status,
    statusLabel: labels[status],
    staged: j.staged,
    segTotal: SEGS.length,
    segDone: done,
    segFailed: failed,
    overview: `已完成 ${done}/${SEGS.length} 段`,
    segments: segs,
    money: {
      held,
      confirmed,
      refunded,
      refundPending: 0,
      text: refunded ? `共花费 ${pts(confirmed)}（${SEGS.length} 段做好 ${done} 段，退回 ${pts(refunded)}）` : undefined,
    },
    ...(decision ? { decision } : {}),
    ...(message ? { message } : {}),
    concurrencyText: `最多同时做 ${LIMITS.maxInFlight} 段，其余排队`,
    ...(result ? { result } : {}),
    urlExpiresAt: new Date(t + 3600000).toISOString(),
  }
}

// ---------------- 示例 / 我的方案 ----------------

const SAMPLES: ReplicateSample[] = [
  { id: 1, title: '足浴门店·换技师和门头', industry: 'footbath', coverUrl: art(20), durationS: 12.4, summary: RESULT.summary, hasResult: true },
  { id: 2, title: '女装上新·模特换装', industry: 'womenswear', coverUrl: art(320), durationS: 9.8, summary: '看懂了：2 个镜头，模特展示外套 → 近景细节；无人声', hasResult: true },
  { id: 3, title: '餐饮探店·换招牌菜', industry: '', coverUrl: art(140), durationS: 14, summary: '看懂了：3 个镜头，门头 → 后厨 → 上菜特写；有人声讲解', hasResult: true },
]

interface SavedRow {
  id: number
  name: string
  planNo: string
  createdAt: number
  lastUsedAt?: number
  useCount: number
}
const saved = new Map<number, SavedRow>()
const SAVED_LIMIT = 50

function sourceGone(): boolean {
  try {
    return localStorage.getItem('fusion:mock-replicate-gone') === '1'
  } catch {
    return false
  }
}

function savedView(r: SavedRow, created?: boolean): ReplicateSavedPlan {
  const row = plans.get(r.planNo)!
  const p = planOf(row)
  return {
    id: r.id,
    name: r.name,
    planNo: r.planNo,
    title: RESULT.summary,
    labels: [...p.changes.map((c) => `换${c.label}`), AUDIO_LABEL[row.req.annotations.audio ?? 'regenerate']],
    modelGroup: row.req.modelGroup,
    resolution: row.req.resolution || '720p',
    aspectRatio: row.req.aspectRatio ?? '',
    annotations: p.annotations!,
    refImages: row.req.refImages.map((ref, i) => {
      const rid = ridOf(ref, i + 1)
      return { index: i + 1, rid, url: ridUrl.get(rid) ?? ref }
    }),
    sourceThumbUrl: art(row.req.sampleId ? 20 : 30),
    sourceAvailable: !sourceGone(),
    sampleId: row.req.sampleId ?? 0,
    useCount: r.useCount,
    ...(r.lastUsedAt ? { lastUsedAt: new Date(r.lastUsedAt).toISOString() } : {}),
    createdAt: new Date(r.createdAt).toISOString(),
    ...(created != null ? { created } : {}),
  }
}

function newPlanRow(req: ReplicatePlanRequest, parent?: string): PlanRow {
  const row: PlanRow = { no: `VRP${seqNo++}`, hash: (seqNo * 2654435761).toString(16).padStart(8, '0').repeat(8), req, createdAt: now(), ...(parent ? { parent } : {}) }
  plans.set(row.no, row)
  return row
}

function throwGaps(gaps: ReplicateGap[]): never {
  throw new ApiError(gaps.slice(0, 5).map((g) => g.message).join('；'), { code: 1003, reason: 'PARAM_INVALID', data: { gaps } })
}

const notFound = (what: string) => new ApiError(`找不到这个${what}`, { code: 4001, reason: 'RESOURCE_NOT_FOUND', httpStatus: 404 })

/** 素材归类 mock：地址里带类别词就按它，否则按序轮流（人物 → 服装 → 商品 → 场景） */
const KIND_CYCLE: ReplicateRefKind[] = ['person', 'garment', 'product', 'scene']
function mockKind(url: string, i: number): ReplicateRefKind {
  const hit = /person|model|人物|模特/i.test(url)
    ? 'person'
    : /garment|cloth|服装/i.test(url)
      ? 'garment'
      : /product|商品/i.test(url)
        ? 'product'
        : /scene|store|场景|门店/i.test(url)
          ? 'scene'
          : /other|其他/i.test(url)
            ? 'other'
            : null
  return hit ?? KIND_CYCLE[i % KIND_CYCLE.length]!
}

export const replicateMock = {
  async classifyRefs(p: { images: { rid?: string; url?: string }[]; analysisNo?: string }) {
    await wait(700)
    const items = p.images.map((im, index) => {
      const kind = mockKind(decodeURIComponent(im.url ?? im.rid ?? ''), index)
      const person = kind === 'person' || kind === 'garment'
      const n = index % 2
      return {
        index: index + 1,
        kind,
        ...(person && p.analysisNo ? { subjectId: n ? 's2' : 's1' } : {}),
        confidence: 0.9,
        label: person ? (n ? '右侧顾客' : '左侧技师') : kind === 'product' ? '商品' : kind === 'scene' ? '门店' : '图片',
      }
    })
    return ok<ReplicateClassifyResult>({ items })
  },
  async wish(_no: string, p: { text: string; refs: { index: number }[] }) {
    await wait(900)
    const draft: ReplicateWishResult['draft'] = { dims: {} }
    const explain: string[] = []
    const items: NonNullable<ReplicateWishResult['items']> = []
    const unsupported: string[] = []
    const add = (kind: 'dim' | 'line' | 'text' | 'continuity', key: string, text: string) => {
      explain.push(text)
      items.push({ kind, key, explain: text })
    }
    if (/冬/.test(p.text)) {
      draft.dims.scene = { mode: 'describe', note: '换成冬天的感觉，窗外有雪' }
      add('dim', 'scene', '场景：换成冬天的感觉，窗外有雪')
    }
    if (/价格|99/.test(p.text)) {
      draft.lines = [{ index: 2, text: '套餐价只要 99' }]
      draft.audio = 'revoice'
      add('line', '2', '第 2 句台词改成「套餐价只要 99」（需要换声音）')
    }
    if (/店名/.test(p.text)) {
      draft.texts = [{ text: '小王理发', kind: 'shop_name' }]
      add('text', '0', '加店名文字「小王理发」')
    }
    if (/电话/.test(p.text)) unsupported.push('电话文字（一次只能加一处店名）')
    return ok<ReplicateWishResult>({ draft, explain, items, ...(unsupported.length ? { unsupported } : {}) })
  },
  async limits() {
    await wait(80)
    return ok(LIMITS)
  },
  async startAnalysis() {
    await wait()
    const a: AnaRow = { no: `VRA${seqNo++}`, start: now(), sample: false }
    analyses.set(a.no, a)
    return ok(anaView(a))
  },
  async getAnalysis(no: string) {
    await wait(100)
    const a = analyses.get(no)
    if (!a) throw new ApiError('找不到这条视频，可能已被删除，或不是你账号里的文件', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    return ok(anaView(a))
  },
  async createPlan(p: ReplicatePlanRequest) {
    await wait(400)
    const gaps = validate(p)
    if (gaps.length) throwGaps(gaps)
    maybeFail()
    const key = JSON.stringify(p)
    let row = plansByContent.get(key)
    if (!row || row.supersededBy || row.confirmed) {
      row = newPlanRow(p)
      plansByContent.set(key, row)
    }
    return ok(planOf(row))
  },
  async getPlan(no: string) {
    await wait(120)
    const row = plans.get(no)
    if (!row) throw notFound('方案')
    return ok(planOf(row))
  },
  async patchAnnotations(no: string, p: ReplicatePatchAnnotationsRequest) {
    await wait(350)
    const row = plans.get(no)
    if (!row) throw notFound('方案')
    const key = JSON.stringify(p)
    if (row.supersededBy) {
      // 同样的改动（网络重试）回当初那张新方案；不同的改动请在最新方案上改
      if (row.supersededKey === key) return ok(planOf(plans.get(row.supersededBy)!))
      throw new ApiError('方案刚更新了，请再看一眼价格', { code: 4002, reason: 'PLAN_STALE', httpStatus: 409 })
    }
    const req: ReplicatePlanRequest = {
      ...(row.req.analysisNo ? { analysisNo: row.req.analysisNo } : {}),
      ...(row.req.sampleId ? { sampleId: row.req.sampleId } : {}),
      annotations: p.annotations,
      refImages: p.refImages ?? row.req.refImages,
      modelGroup: p.modelGroup ?? row.req.modelGroup,
      resolution: p.resolution ?? row.req.resolution,
      aspectRatio: p.aspectRatio ?? row.req.aspectRatio,
      ...((p.continuity ?? row.req.continuity) ? { continuity: p.continuity ?? row.req.continuity } : {}),
    }
    const gaps = validate(req)
    if (gaps.length) throwGaps(gaps)
    maybeFail()
    const next = newPlanRow(req, row.no)
    if (!row.confirmed) {
      row.supersededBy = next.no
      row.supersededKey = key
    }
    return ok(planOf(next))
  },
  async savePlan(no: string, p: { name?: string }): Promise<Resp<ReplicateSavedPlan>> {
    await wait(250)
    const row = plans.get(no)
    if (!row) throw notFound('方案')
    const name = p.name?.trim().slice(0, 40)
    const hit = [...saved.values()].find((r) => r.planNo === no)
    if (hit) {
      if (name) hit.name = name
      return ok(savedView(hit, false))
    }
    if (saved.size >= SAVED_LIMIT) throw new ApiError('方案满了，请删除不用的', { code: 4002, reason: 'SAVED_PLAN_LIMIT', httpStatus: 409 })
    const labels = planOf(row).changes.map((c) => `换${c.label}`).join('、') || '改法'
    const sample = SAMPLES.find((x) => x.id === row.req.sampleId)
    const r: SavedRow = { id: seqNo++, name: name || `${sample?.title.split('·')[0] ?? '我的视频'} · ${labels}`, planNo: no, createdAt: now(), useCount: 0 }
    saved.set(r.id, r)
    return ok(savedView(r, true))
  },
  async listSavedPlans(p: { page: number; size: number }): Promise<Resp<ReplicateSavedPlanList>> {
    await wait(200)
    const all = [...saved.values()].reverse()
    const size = Math.min(p.size, 50)
    return ok({
      items: all.slice((p.page - 1) * size, p.page * size).map((r) => savedView(r)),
      total: all.length,
      page: p.page,
      size,
      limit: SAVED_LIMIT,
      urlExpiresAt: new Date(now() + 3600000).toISOString(),
    })
  },
  async deleteSavedPlan(id: number) {
    await wait(200)
    if (!saved.delete(id)) throw notFound('方案')
    return ok({ id })
  },
  async reuseSavedPlan(id: number, p: ReplicateReuseRequest) {
    await wait(400)
    const r = saved.get(id)
    if (!r) throw notFound('方案')
    const base = plans.get(r.planNo)!
    if (!p.analysisNo && !p.sampleId && sourceGone()) {
      throw new ApiError('原片已经不在了，需要重新上传原片（方案设置会保留）', { code: 4001, reason: 'SOURCE_GONE', httpStatus: 404 })
    }
    const src = p.analysisNo
      ? { analysisNo: p.analysisNo }
      : p.sampleId
        ? { sampleId: p.sampleId }
        : base.req.analysisNo
          ? { analysisNo: base.req.analysisNo }
          : { sampleId: base.req.sampleId }
    const req: ReplicatePlanRequest = {
      ...src,
      annotations: base.req.annotations,
      refImages: p.refImages ?? base.req.refImages,
      modelGroup: p.modelGroup ?? base.req.modelGroup,
      resolution: p.resolution ?? base.req.resolution,
      aspectRatio: p.aspectRatio ?? base.req.aspectRatio,
    }
    const gaps = validate(req)
    if (gaps.length) throwGaps(gaps)
    r.useCount++
    r.lastUsedAt = now()
    return ok(planOf(newPlanRow(req)))
  },
  async listSamples(p: { industry?: string }): Promise<Resp<ReplicateSampleList>> {
    await wait(150)
    const items = p.industry ? SAMPLES.filter((x) => !x.industry || x.industry === p.industry) : SAMPLES
    return ok({ items, urlExpiresAt: new Date(now() + 3600000).toISOString() })
  },
  async trySample(id: number): Promise<Resp<ReplicateSampleTry>> {
    await wait(300)
    const sample = SAMPLES.find((x) => x.id === id)
    if (!sample) throw notFound('示例')
    return ok({
      sample,
      sourceRid: `mock-sample-src-${id}`,
      sourceUrl: art(20 + id * 60),
      resultRid: `mock-sample-res-${id}`,
      resultUrl: art(200 + id * 60),
      analysis: RESULT,
      annotations: { dims: { product: { mode: 'replace', refs: [1] } }, audio: 'regenerate' },
      freeText: '这是示例效果，用的是平台自有素材，不花点数；换成你的视频，先看报价再决定',
      nextText: '换成你的素材，按这个改法做同款',
      urlExpiresAt: new Date(now() + 3600000).toISOString(),
    })
  },
  async quote(no: string) {
    await wait(250)
    const row = plans.get(no)
    if (!row) throw new ApiError('找不到这个方案', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    return ok(planOf(row))
  },
  async confirm(no: string, p: { planHash: string; stage: 'first' | 'all'; expectedPoints: number }): Promise<Resp<ReplicateJob>> {
    await wait(500)
    maybeFail()
    const row = plans.get(no)
    if (!row) throw new ApiError('找不到这个方案', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    if (row.supersededBy || row.hash !== p.planHash) throw new ApiError('方案刚更新了，请再看一眼价格', { code: 4002, reason: 'PLAN_STALE', httpStatus: 409 })
    const need = p.stage === 'first' ? FIRST : TOTAL
    if (p.expectedPoints > 0 && p.expectedPoints !== need) {
      throw new ApiError(`价格有变化：${p.expectedPoints} → ${need} 点。确认后按新价格生成`, { code: 4002, reason: 'QUOTE_CHANGED' })
    }
    row.confirmed = true
    const j: JobRow = { id: 40 + seqNo++, planNo: no, planHash: row.hash, createdAt: now(), staged: p.stage === 'first', failedOnce: false, redo: {}, redoCount: {}, refunded: {} }
    if (!j.staged) j.continuedAt = j.createdAt
    jobs.set(j.id, j)
    return ok(jobView(j))
  },
  async getJob(id: string) {
    await wait(100)
    const j = jobs.get(Number(id))
    if (!j) throw new ApiError('找不到这个任务', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    return ok(jobView(j))
  },
  async listExports(id: string) {
    await wait(150)
    const sample = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    const exports: ReplicateExport[] = [
      { jobId: id, ratio: '9:16', mode: 'pad', videoUrl: sample, urlExpiresAt: new Date(Date.now() + 3600_000).toISOString(), library: { status: 'saved', state: 'saved' } },
      { jobId: id, ratio: '1:1', mode: 'crop', videoUrl: sample, urlExpiresAt: new Date(Date.now() + 3600_000).toISOString(), library: { status: 'saving', state: 'saving' } },
    ]
    return ok({ jobId: id, exports } satisfies ReplicateExportList)
  },
  async listJobs(p: { page: number; size: number }): Promise<Resp<ReplicateJobList>> {
    await wait(150)
    const all = [...jobs.values()].reverse().map(jobView)
    const size = Math.min(p.size, 50)
    return ok({
      items: all.slice((p.page - 1) * size, p.page * size).map((v) => ({
        jobId: v.jobId,
        taskId: v.taskId,
        planNo: v.planNo,
        status: v.status,
        statusLabel: v.statusLabel,
        title: RESULT.summary,
        segTotal: v.segTotal,
        segDone: v.segDone,
        points: v.money.held + v.money.confirmed,
        sourceThumbUrl: art(30),
        coverUrl: v.result?.coverUrl,
        createdAt: new Date(jobs.get(v.jobId)!.createdAt).toISOString(),
      })),
      total: all.length,
      page: p.page,
      size,
      urlExpiresAt: new Date(now() + 3600000).toISOString(),
    })
  },
  async continueJob(id: string) {
    await wait(300)
    maybeFail()
    const j = jobs.get(Number(id))
    if (!j) throw new ApiError('找不到这个任务', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    j.continuedAt = j.continuedAt ?? now()
    return ok(jobView(j))
  },
  async stop(id: string) {
    await wait(300)
    maybeFail()
    const j = jobs.get(Number(id))
    if (!j) throw new ApiError('找不到这个任务', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    j.stoppedAt = now()
    return ok(jobView(j))
  },
  async models() {
    await wait(80)
    return ok<ReplicateModelList>({
      defaultModel: 'vid.seedance-2.5',
      items: [
        { modelGroup: 'vid.seedance-2.5', name: 'Seedance 2.5', features: ['画质与一致性最好', '动作还原细'], recommended: true, dialect: 'seedance-2.5', resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], defaultResolution: '720p', minDurationSec: 4, maxDurationSec: 30, resolution: '720p', pointsPerSecond: 10, priceText: '10 点/秒（720p）', estimatedPoints: 340, supportsDuration: true, supportsAspect: true, supportsResolution: true, available: true },
        { modelGroup: 'vid.seedance-2', name: 'Seedance 2.0', features: ['性价比高', '稳定'], recommended: false, dialect: 'seedance-2', resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], defaultResolution: '720p', minDurationSec: 4, maxDurationSec: 15, resolution: '720p', pointsPerSecond: 6, priceText: '6 点/秒（720p）', estimatedPoints: 204, supportsDuration: true, supportsAspect: true, supportsResolution: true, available: true },
        { modelGroup: 'vid.minimax-h3', name: 'MiniMax H3', features: ['运镜流畅', '清晰度为 768p 档'], recommended: false, dialect: 'minimax-h3', resolutions: ['480p', '768p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], defaultResolution: '768p', minDurationSec: 4, maxDurationSec: 15, resolution: '768p', pointsPerSecond: 8, priceText: '8 点/秒（768p）', estimatedPoints: 272, supportsDuration: true, supportsAspect: true, supportsResolution: false, available: true },
      ],
    })
  },
  async cancelRest(id: string) {
    await wait(300)
    maybeFail()
    const j = jobs.get(Number(id))
    if (!j) throw new ApiError('找不到这个任务', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    j.stoppedAt = now()
    return ok(jobView(j))
  },
  async redo(id: string, k: number) {
    await wait(300)
    maybeFail()
    const j = jobs.get(Number(id))
    if (!j) throw new ApiError('找不到这个任务', { code: 4001, reason: 'RESOURCE_NOT_FOUND' })
    j.failedOnce = true
    j.redo[k] = now()
    j.redoCount[k] = (j.redoCount[k] ?? 0) + 1
    delete j.refunded[k]
    return ok(jobView(j))
  },
}
