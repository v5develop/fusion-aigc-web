/**
 * 智能体（Java /api/v1/agent/*）接口封装 + SSE 流式对话客户端。
 *
 * <p>字段照 fusion-aigc CreaftV1CoreAgentController / CompatCoreAgentService 的 DTO（lowerCamel 出网）。
 * 普通接口复用 api/index.ts 的 axios 实例（token 注入、401 刷新、业务错误 toast）；
 * 流式接口走 {@link authorizedFetch}，同一个 token。
 *
 * <p>流式对话是计费接口（受理时预扣，终态结算）。服务端按请求头 X-Request-Id 做幂等
 * （idempotencyKey = "agent-" + X-Request-Id），所以：客户端从不自动重试；结果未知时由页面
 * 保留同一个 requestId，用户手动重发同一条内容才沿用它。
 */
import { ApiError, authorizedFetch, del, get, patch, post } from './index.ts'

const PREFIX = '/api/v1/agent'

// ---------------- 类型 ----------------

/** 分页信封（PageView） */
export interface IAgentPage<T> {
  current: number
  pages: number
  total: number
  data: T[]
}

/** 技能（SkillView）。agentSkillId 以字符串下发（雪花 id 超出 JS 安全整数），原样回传 */
export interface IAgentSkill {
  agentSkillId: string
  agentSkillCode: string
  title: string
  description: string
  icon: string
  version: string
  enabled: boolean | null
  category: string
  weight: number | null
  updatedAt: string | null
  /** react = 可走对话；workflow = 只能走对应工作流入口，选进对话会被拒 */
  executionShape: string | null
}

/** 技能目录的一个分组（键 = 分类中文名，组序照服务端下发） */
export interface IAgentSkillGroup {
  name: string
  skills: IAgentSkill[]
}

/** 「我的技能」分组名。目录是公共资源、当前不下发用户自建技能；若哪天下发了同名分类，就落进这一组 */
export const MY_SKILL_GROUP = '我的技能'

/**
 * 对话面可选的技能分组：去掉停用与 workflow 形态（选进对话会被拒），去掉因此变空的组；
 * 组序、组内顺序都照服务端（服务端已按运营配置 / 条目数与 weight 排好，默认技能取第一条）。
 */
export function chatSkillGroups(groups: Record<string, IAgentSkill[]> | null | undefined): IAgentSkillGroup[] {
  return Object.entries(groups ?? {})
    .map(([name, list]) => ({
      name,
      skills: (list ?? []).filter((s) => s.enabled !== false && s.executionShape !== 'workflow'),
    }))
    .filter((g) => g.skills.length > 0)
}

/** 会话列表行（ConversationListView） */
export interface IAgentConversation {
  agentConversationId: string
  title: string
  meta: unknown
  messageTotal: number
  lastMessage: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** 一帧 SSE（实时流与助手历史 sseEvents 同形） */
export interface IAgentFrame {
  event: string
  data: { content: Record<string, any>; timestamp?: number }
}

/**
 * 会话消息（messageView）：assistant 为对象时给 sseEvents、没有 content；
 * 其余给 content（user 可能带 hidden / attribute / imageUrls）。
 */
export interface IAgentMessage {
  id: number | string
  role: string
  content?: unknown
  sseEvents?: IAgentFrame[]
  generationLanguage?: string
  hidden?: boolean
  /** 用户消息本轮带的图片 */
  imageUrls?: string[]
  /** 用户消息透传的表单数据（键已转 lowerCamel，表单续答的 answers 键即问题 id 的 lowerCamel） */
  attribute?: Record<string, unknown>
  createdAt?: string | null
  updatedAt?: string | null
}

/** 表单一题的答案：选中的选项 id + 补充文字（AgentInterruptResume.answers） */
export interface IAgentAnswer {
  selected: string[]
  text: string
}

/** 流式请求体（StreamRequest 的子集） */
export interface IAgentStreamReq {
  conversationId: string
  /** 普通消息必填非空；只有带 attribute.answers 的表单续答可为空串 */
  content: string
  /** 表单续答：answers = { 问题 id: { selected, text } } */
  attribute?: { answers: Record<string, IAgentAnswer> }
  /** 表单续答：取自 interrupt_required 帧的 interrupt_id，不带则按会话当前待答表单处理 */
  interruptId?: string
  /** 必填（服务端要求 > 0）：没有可用技能时页面不发请求 */
  agentSkillId: string
  /** 本轮图片（http/https，最多 9 个，服务端按用户核验归属）；没有图就不带 */
  imageUrls?: string[]
  /** 回答语言（≤64 字符），服务端拼进系统提示 "Response language: …"；不限语言就不带 */
  language?: string
}

/** 回答语言选项：value 为空 = 不限语言（不带 language） */
export interface IAgentLanguage {
  code: string
  name: string
  value: string
}

export const AGENT_LANGUAGES: readonly IAgentLanguage[] = [
  { code: 'ZH', name: '中文', value: 'Chinese' },
  { code: 'EN', name: '英语', value: 'English' },
  { code: '—', name: '无语言', value: '' },
  { code: 'ZH-HANT', name: '繁体中文', value: 'Traditional Chinese' },
  { code: 'KO', name: '韩语', value: 'Korean' },
  { code: 'FR', name: '法语', value: 'French' },
  { code: 'DE', name: '德语', value: 'German' },
  { code: 'ES', name: '西班牙语', value: 'Spanish' },
  { code: 'PT', name: '葡萄牙语', value: 'Portuguese' },
  { code: 'RU', name: '俄语', value: 'Russian' },
  { code: 'AR', name: '阿拉伯语', value: 'Arabic' },
  { code: 'TH', name: '泰语', value: 'Thai' },
  { code: 'VI', name: '越南语', value: 'Vietnamese' },
  { code: 'IT', name: '意大利语', value: 'Italian' },
  { code: 'JA', name: '日语', value: 'Japanese' },
  { code: 'PL', name: '波兰语', value: 'Polish' },
  { code: 'TR', name: '土耳其语', value: 'Turkish' },
  { code: 'ID', name: '印尼语', value: 'Indonesian' },
  { code: 'HI', name: '印地语', value: 'Hindi' },
]

// ---------------- 普通接口 ----------------

/** 技能目录：按分类分组的字典；不传 categories = 全部 */
export function agentSkills() {
  return get<Record<string, IAgentSkill[]>>(`${PREFIX}/skills`)
}

export function agentConversations(params: { page: number; size: number }) {
  return get<IAgentPage<IAgentConversation>>(`${PREFIX}/conversations`, params)
}

/** 建会话：只回 {conversationId} */
export function agentCreateConversation(data: { title?: string; category?: string }) {
  return post<{ conversationId: string }>(`${PREFIX}/conversations`, data)
}

export function agentMessages(id: string, params: { page: number; size: number }) {
  return get<IAgentPage<IAgentMessage>>(`${PREFIX}/conversations/${encodeURIComponent(id)}/messages`, params)
}

/** 改名：局部更新，只传 title */
export function agentRenameConversation(id: string, title: string) {
  return patch<null>(`${PREFIX}/conversations/${encodeURIComponent(id)}`, { title })
}

export function agentDeleteConversation(id: string) {
  return del<null>(`${PREFIX}/conversations/${encodeURIComponent(id)}`)
}

/** 中断当前回答：status 只会是 interrupting / idle */
export function agentCancel(id: string) {
  return post<{ status: 'interrupting' | 'idle'; conversationId: string; runId: string }>(
    `${PREFIX}/conversations/${encodeURIComponent(id)}/cancel`,
    {},
  )
}

// ---------------- 分享（ShareRequest / ShareView） ----------------

/** 分享选中的轮次：turnNos 从 1 起（一轮 = 会话里按顺序的用户 + 助手两条消息）；expireDays 0 = 永不过期 */
export function agentShareConversation(id: string, data: { turnNos: number[]; expireDays: number }) {
  return post<{ token: string }>(`${PREFIX}/conversations/${encodeURIComponent(id)}/share`, data)
}

/** 免登录读分享：返回消息数组（不是分页信封），形状同 messageView */
export function agentSharedMessages(token: string) {
  return get<IAgentMessage[]>(`${PREFIX}/messages/share`, { token })
}

// ---------------- 我的技能（/api/v1/user-skills） ----------------

/** 自建技能：列表项不含 prompt，详情才有 */
export interface IUserSkill {
  userSkillId: number
  title: string
  prompt?: string
  createdAt?: string | null
  updatedAt?: string | null
}

const USER_SKILLS = '/api/v1/user-skills'

export function userSkillList(params: { page: number; size: number }) {
  return get<IAgentPage<IUserSkill>>(USER_SKILLS, params)
}

export function userSkillDetail(id: number) {
  return get<IUserSkill>(`${USER_SKILLS}/${id}`)
}

/** title 与 prompt 都必填 */
export function userSkillCreate(data: { title: string; prompt: string }) {
  return post<null>(USER_SKILLS, data)
}

/** 局部更新：只传要改的字段 */
export function userSkillUpdate(id: number, data: { title?: string; prompt?: string }) {
  return patch<null>(`${USER_SKILLS}/${id}`, data)
}

/**
 * 批量删除：id 列表放在请求体（{userSkillIds}）。公共 del 只带 query，这里走带 token 的 fetch；
 * 业务失败（code≠0）不会经过 axios 拦截器 toast，由调用方提示。
 */
export async function userSkillDelete(ids: number[]): Promise<void> {
  let resp: Response
  try {
    resp = await authorizedFetch(USER_SKILLS, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userSkillIds: ids }),
    })
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }
  const json = (await resp.json().catch(() => null)) as { code?: number; msg?: string; reason?: string } | null
  if (resp.ok && json?.code === 0) return
  const code = typeof json?.code === 'number' && json.code !== 0 ? json.code : -1
  throw new ApiError(json?.msg || `删除失败（HTTP ${resp.status}）`, {
    code,
    reason: typeof json?.reason === 'string' ? json.reason : undefined,
    httpStatus: resp.ok ? undefined : resp.status,
  })
}

// ---------------- 画布动作（/api/v1/agent/canvas/*） ----------------

/**
 * 比例坐标（0~1）字符串对 [x, y]，不是像素。
 * 服务端按数组收：传成单个字符串 "0.5,0.5" 会因类型不匹配被拒。
 */
export type CanvasPoint = [string, string]

/** 点选识别请求：point（单点）与 points（多点）二选一，两个都给或都不给都会被拒；图片后缀仅 jpg/jpeg/png/webp */
export type ICanvasIdentifyReq = { imageUrl: string } & (
  | { point: CanvasPoint; points?: never }
  | { points: CanvasPoint[]; point?: never }
)

/** 识别结果：id 自带 region_ 前缀，图像编辑的提示词用 {{<id>}} 引用该区域 */
export interface ICanvasRegion {
  id: string
  label: string
  description: string
}

/** 图像编辑的区域：bbox 为 1 个或 4 个比例坐标点（只校验点数，不参与出图）；label / description 会被拼进提示词 */
export interface ICanvasEditRegion {
  id: string
  imageIndex?: number
  bbox: CanvasPoint[]
  label?: string
  description?: string
}

export interface ICanvasImageEditReq {
  /** 至少一张，最多 9 张（另有账号单次上限），整组下发 */
  imageUrls: string[]
  /** 必填，≤4096 字符；用 {{region_xxx}} 引用 regions 里的区域 */
  prompt: string
  regions?: ICanvasEditRegion[]
  /** 不传按 1k */
  resolution?: string
  /** 不传按 1:1 */
  aspectRatio?: string
}

export interface ICanvasMultiviewReq {
  imageUrl: string
  /** 1~9，不传按 1；直接乘进计费，一件一个 taskId */
  num?: number
  /** 0.1~2.0，不传按 1.0 */
  scale?: number
  /** -90~90，不传按 0 */
  rotation?: number
  /** -30~60，不传按 0 */
  skew?: number
}

/** 图层任务读取：PENDING（含运行中）/ SUCCEED / FAILED；SUCCEED 时 content 为图层正文（结构由执行方定义，键名 lowerCamel） */
export interface ICanvasLayerResult {
  status: 'PENDING' | 'SUCCEED' | 'FAILED' | string
  content: unknown
}

const CANVAS = `${PREFIX}/canvas`

/** 幂等键：计费提交不带时，重试会被当成新任务再次扣费 */
const idemHeader = (key?: string) => (key ? { 'Idempotency-Key': key } : undefined)

/** 点选主体识别：同步、不计费（每用户每分钟 30 次） */
export function canvasIdentify(data: ICanvasIdentifyReq) {
  return post<ICanvasRegion>(`${CANVAS}/identify`, data)
}

/** 图像编辑（异步、计费）：返回单个 taskId，随后按任务查询接口轮询 */
export function canvasImageEdit(data: ICanvasImageEditReq, idempotencyKey?: string) {
  return post<{ taskId: string }>(`${CANVAS}/image-edict`, data, idemHeader(idempotencyKey))
}

/** 多角度出图（异步、计费）：返回 taskIds 数组，按 num 一件一个，需逐个轮询 */
export function canvasMultiview(data: ICanvasMultiviewReq, idempotencyKey?: string) {
  return post<{ taskIds: string[] }>(`${CANVAS}/multiview`, data, idemHeader(idempotencyKey))
}

/** 图层拆分（异步、计费）：只收 imageUrl，返回单个 taskId */
export function canvasImageLayer(imageUrl: string, idempotencyKey?: string) {
  return post<{ taskId: string }>(`${CANVAS}/image-layer`, { imageUrl }, idemHeader(idempotencyKey))
}

export function canvasImageLayerResult(taskId: string) {
  return get<ICanvasLayerResult>(`${CANVAS}/image-layer/${encodeURIComponent(taskId)}`)
}

/**
 * 轮询图层任务直到 SUCCEED / FAILED，或 signal 被中止（抛 AbortError）。
 * 只读接口，查询失败按网络抖动处理：连续失败 maxErrors 次才抛出。
 */
export async function pollCanvasImageLayer(
  taskId: string,
  opts: { signal: AbortSignal; intervalMs?: number; maxErrors?: number },
): Promise<ICanvasLayerResult> {
  const interval = opts.intervalMs ?? 3000
  const maxErrors = opts.maxErrors ?? 3
  let errors = 0
  for (;;) {
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      const res = await canvasImageLayerResult(taskId)
      errors = 0
      if (res.data && res.data.status !== 'PENDING') return res.data
    } catch (err) {
      if (++errors >= maxErrors) throw err
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval)
      opts.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        },
        { once: true },
      )
    })
  }
}

// ---------------- 帧归并（实时与历史共用） ----------------

/** 生图工具提交的一条任务（tool_result 的 result.results 项；消息历史按读取时的任务状态现算） */
export interface IAgentGenTask {
  taskId: string
  status: 'queued' | 'processing' | 'success' | 'failed'
  imageUrls: string[]
}

export interface IAgentToolResult {
  name: string
  status: string
  message: string
  /** 生图工具（resultType = generation_task_submitted）提交的任务；其余工具为空 */
  tasks: IAgentGenTask[]
}

const GEN_RESULT_TYPE = 'generation_task_submitted'
const GEN_STATUSES: readonly IAgentGenTask['status'][] = ['queued', 'processing', 'success', 'failed']

/** 读出生图工具的任务：优先 result.results；旧帧只有 taskIds 时按排队处理 */
function genTasks(result: unknown): IAgentGenTask[] {
  const r = (result ?? {}) as Record<string, unknown>
  if (r.resultType !== GEN_RESULT_TYPE) return []
  if (Array.isArray(r.results)) {
    return r.results
      .map((x) => (x ?? {}) as Record<string, unknown>)
      .filter((x) => typeof x.taskId === 'string' && x.taskId)
      .map((x) => ({
        taskId: String(x.taskId),
        status: GEN_STATUSES.includes(x.status as IAgentGenTask['status'])
          ? (x.status as IAgentGenTask['status'])
          : 'queued',
        imageUrls: Array.isArray(x.imageUrls)
          ? x.imageUrls.filter((u): u is string => typeof u === 'string' && !!u)
          : [],
      }))
  }
  return (Array.isArray(r.taskIds) ? r.taskIds : [])
    .filter((id): id is string => typeof id === 'string' && !!id)
    .map((taskId) => ({ taskId, status: 'queued' as const, imageUrls: [] }))
}

/** 任务还没到终态（排队 / 生成中） */
export function genTaskPending(t: IAgentGenTask): boolean {
  return t.status === 'queued' || t.status === 'processing'
}

/** 表单选项：image_spec 是「分辨率 → 比例」两级，children 非空即需再选一级 */
export interface IAgentQuestionOption {
  id: string
  label: string
  description: string
  children: IAgentQuestionOption[]
}

/** 表单一题（AgentInterruptProtocol.legacyQuestionFromWaiting / AgentQuestionRequest 的 question_candidates） */
export interface IAgentQuestion {
  id: string
  /** single_select / multi_select / nested_select / text（tool_result 回退时为原始值） */
  type: string
  title: string
  message: string
  required: boolean
  options: IAgentQuestionOption[]
  /** 可补充文字（select 题）或纯文字题 */
  allowText: boolean
  placeholder: string
  defaultSelected: string[]
  defaultText: string
}

/** 待答的参数确认表单（question_asker 发起的中断） */
export interface IAgentForm {
  /** interrupt_required 帧的 interrupt_id；只收到 tool_result 时为空（续答不带，服务端按当前待答表单处理） */
  interruptId: string
  title: string
  message: string
  questions: IAgentQuestion[]
}

/** 一轮助手回复的可渲染状态 */
export interface IAgentReply {
  text: string
  thinking: string
  tools: IAgentToolResult[]
  /** 本轮以参数确认表单中断时的表单；null = 无 */
  form: IAgentForm | null
  /** ERROR 帧的 message；空 = 无错误 */
  error: string
  /** 收到 END */
  finished: boolean
}

export function emptyReply(): IAgentReply {
  return { text: '', thinking: '', tools: [], form: null, error: '', finished: false }
}

const str = (v: unknown) => (v == null ? '' : String(v))
const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const strList = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => str(x).trim()).filter((x): x is string => !!x)

const QUESTION_RESULT_TYPE = 'question_request'
const SELECT_TYPES = ['single_select', 'multi_select', 'nested_select']

function toOptions(raw: unknown): IAgentQuestionOption[] {
  return (Array.isArray(raw) ? raw : [])
    .map(rec)
    .map((o) => {
      const id = str(o.id ?? o.value).trim()
      return {
        id,
        label: str(o.label).trim() || id,
        description: str(o.description).trim(),
        children: toOptions(o.children),
      }
    })
    .filter((o) => !!o.id)
}

function toQuestion(raw: unknown): IAgentQuestion | null {
  const q = rec(raw)
  const id = str(q.questionId).trim()
  if (!id) return null
  const type = str(q.questionType).trim() || 'text'
  // interrupt_required 已按 textInputConfig 定好；tool_result 回退时缺省规则同服务端：select 题默认可补充文字
  const allowText = typeof q.allowTextInput === 'boolean' ? q.allowTextInput : SELECT_TYPES.includes(type)
  return {
    id,
    type,
    title: str(q.title).trim() || id,
    message: str(q.message).trim(),
    required: q.required === true,
    options: toOptions(q.options),
    allowText: allowText || type === 'text' || type === 'text_input',
    placeholder: str(q.textInputPlaceholder).trim(),
    defaultSelected: strList(q.defaultSelected),
    defaultText: str(q.defaultText).trim(),
  }
}

function toForm(interruptId: string, title: unknown, msg: unknown, questions: unknown): IAgentForm | null {
  const list = (Array.isArray(questions) ? questions : []).map(toQuestion).filter((q): q is IAgentQuestion => !!q)
  if (!list.length) return null
  return { interruptId, title: str(title).trim(), message: str(msg).trim(), questions: list }
}

/**
 * 把一帧归并进回复：
 * PROCESSING message_delta → 正文；thinking_delta → 思考；tool_result → 工具结果；
 * interrupt_required → 参数确认表单（带 interruptId，以它为准）；
 * tool_result 的 result.resultType = question_request 也记一份表单（尚无 interrupt_required 时的回退）；
 * END → finished；ERROR → error（content.message）。START / RECOVER_EMPTY / 其余 eventType 忽略。
 * 工具名在出网前已换成中文展示名（question_asker → 参数确认），所以表单按 resultType / eventType 认，不按工具名。
 */
export function applyFrame(reply: IAgentReply, frame: IAgentFrame): void {
  const content = frame.data?.content ?? {}
  switch (frame.event) {
    case 'PROCESSING': {
      const payload = rec(content.payload)
      if (content.eventType === 'message_delta') reply.text += str(payload.delta)
      else if (content.eventType === 'thinking_delta') reply.thinking += str(payload.delta)
      else if (content.eventType === 'tool_result') {
        reply.tools.push({
          name: str(payload.toolName),
          status: str(payload.status),
          message: str(payload.message),
          tasks: genTasks(payload.result),
        })
        const result = rec(payload.result)
        if (result.resultType === QUESTION_RESULT_TYPE && !reply.form?.interruptId) {
          const data = rec(result.data)
          reply.form = toForm('', data.title, data.message || result.summary, data.questionCandidates) ?? reply.form
        }
      } else if (content.eventType === 'interrupt_required') {
        reply.form =
          toForm(str(payload.interruptId).trim(), payload.title, payload.message, payload.questions) ?? reply.form
      }
      break
    }
    case 'END':
      reply.finished = true
      break
    case 'ERROR':
      reply.error = str(content.message) || 'agent 执行失败'
      break
  }
}

// ---------------- 参数确认表单：答案 ----------------

/** 题目带两级选项（image_spec：先选分辨率，再选比例） */
export function isNestedQuestion(q: IAgentQuestion): boolean {
  return q.options.some((o) => o.children.length > 0)
}

/** 纯文字题（没有选项可选） */
export function isTextQuestion(q: IAgentQuestion): boolean {
  return !q.options.length
}

/**
 * 初始答案：照服务端下发的 default_selected / default_text 预选。
 * 两级题的默认值是子项 id（如 1k__3:4），补上它的父项，答案形如 [父 id, 子 id]（服务端按最后一个命中取选项）。
 */
export function initialAnswer(q: IAgentQuestion): IAgentAnswer {
  const text = q.allowText ? q.defaultText : ''
  if (isNestedQuestion(q)) {
    for (const id of q.defaultSelected) {
      const parent = q.options.find((o) => o.id === id || o.children.some((c) => c.id === id))
      if (!parent) continue
      return { selected: parent.id === id ? [id] : [parent.id, id], text }
    }
    return { selected: [], text }
  }
  const ids = new Set(q.options.map((o) => o.id))
  const selected = q.defaultSelected.filter((id) => ids.has(id))
  return { selected: q.type === 'multi_select' ? selected : selected.slice(0, 1), text }
}

/** 这一题是否已作答：填了补充文字，或选到了可提交的选项（两级题要选到子项） */
export function answerReady(q: IAgentQuestion, a: IAgentAnswer | undefined): boolean {
  if (!a) return false
  if (q.allowText && a.text.trim()) return true
  if (!isNestedQuestion(q)) return a.selected.length > 0
  const last = a.selected[a.selected.length - 1]
  const parent = q.options.find((o) => o.id === a.selected[0])
  if (!parent || !last) return false
  return parent.children.length ? parent.children.some((c) => c.id === last) : last === parent.id
}

/** 必答题都答了才能提交 */
export function formReady(form: IAgentForm, answers: Record<string, IAgentAnswer>): boolean {
  return form.questions.every((q) => !q.required || answerReady(q, answers[q.id]))
}

/** 组 attribute.answers：每题都带（没答的给空），文字去首尾空白 */
export function buildAnswers(form: IAgentForm, answers: Record<string, IAgentAnswer>): Record<string, IAgentAnswer> {
  const out: Record<string, IAgentAnswer> = {}
  for (const q of form.questions) {
    const a = answers[q.id]
    out[q.id] = { selected: [...(a?.selected ?? [])], text: q.allowText ? (a?.text ?? '').trim() : '' }
  }
  return out
}

/**
 * 历史里用户消息的 attribute 出网时键名整体转了 lowerCamel（CreaftV1WireKeys.lowerCamel：按 _ 切分，
 * 首段原样，其余段 Python str.title()），answers 的键也在内。回读答案时按同一规则把问题 id 转过去再取。
 */
export function wireKey(id: string): string {
  const parts = id.split('_')
  if (parts.length === 1) return id
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (!out) {
      out = part
      continue
    }
    let prevCased = false
    for (const ch of part) {
      const cased = ch.toLowerCase() !== ch.toUpperCase()
      out += cased ? (prevCased ? ch.toLowerCase() : ch.toUpperCase()) : ch
      prevCased = cased
    }
  }
  return out
}

/** 从历史用户消息的 attribute.answers 读回某张表单的答案；没有对应答案的题不出现在结果里 */
export function answersFromAttribute(
  form: IAgentForm,
  attribute: Record<string, unknown> | undefined,
): Record<string, IAgentAnswer> | null {
  const raw = rec(rec(attribute).answers)
  if (!Object.keys(raw).length) return null
  const out: Record<string, IAgentAnswer> = {}
  for (const q of form.questions) {
    const a = raw[wireKey(q.id)] ?? raw[q.id]
    if (!a) continue
    const v = rec(a)
    out[q.id] = { selected: strList(Array.isArray(v.selected) ? v.selected : [v.selected]), text: str(v.text).trim() }
  }
  return out
}

export function replyFromFrames(frames: IAgentFrame[] | undefined): IAgentReply {
  const reply = emptyReply()
  for (const f of frames ?? []) applyFrame(reply, f)
  return reply
}

// ---------------- SSE 客户端 ----------------

export interface IAgentStreamOptions {
  /** 本次提交的幂等身份，写进 X-Request-Id（8~64 位字母数字与连字符） */
  requestId: string
  signal: AbortSignal
  onFrame: (frame: IAgentFrame) => void
}

/** 续流请求体（RecoverStreamRequest）：只传 conversationId 即整轮重放；带 turnId + afterSequence 只续游标之后的帧 */
export interface IAgentRecoverReq {
  conversationId: string
  turnId?: string
  afterSequence?: number
}

/**
 * 续接运行中那一轮的流（断网 / 刷新后），逐帧回调，流结束时 resolve。
 *
 * <p>恒 200 + SSE：没有运行中的流只发一帧 RECOVER_EMPTY；会话不存在或无权限发 ERROR。
 * 只读接口、不计费，失败抛法同 {@link agentStream}。
 */
export function agentRecoverStream(
  body: IAgentRecoverReq,
  opts: { signal: AbortSignal; onFrame: (frame: IAgentFrame) => void },
): Promise<void> {
  return readSse(`${PREFIX}/recover-stream`, body, {}, opts)
}

/**
 * 发起一轮流式对话，逐帧回调，流结束时 resolve。
 *
 * <p>失败一律抛 {@link ApiError}：传输层失败（断网 / 中断）isNetwork=true（结果未知）；
 * 受理前的参数校验失败服务端回 JSON 信封（code≠0），按确定失败抛出。
 * 受理前的业务拒绝（点数不足、技能不可用等）走 SSE 的 ERROR 帧（恒 200），经 onFrame 交回。
 * 主动 abort 时抛原生 AbortError，由调用方忽略。
 */
export function agentStream(body: IAgentStreamReq, opts: IAgentStreamOptions): Promise<void> {
  return readSse(`${PREFIX}/stream`, body, { 'X-Request-Id': opts.requestId }, opts)
}

async function readSse(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string>,
  opts: { signal: AbortSignal; onFrame: (frame: IAgentFrame) => void },
): Promise<void> {
  let resp: Response
  try {
    resp = await authorizedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...extraHeaders },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }

  const type = resp.headers.get('content-type') ?? ''
  if (!resp.ok || !type.includes('text/event-stream') || !resp.body) {
    const json = (await resp.json().catch(() => null)) as { code?: number; msg?: string; reason?: string } | null
    const code = typeof json?.code === 'number' && json.code !== 0 ? json.code : -1
    throw new ApiError(json?.msg || `SSE request failed: ${resp.status}`, {
      code,
      reason: typeof json?.reason === 'string' ? json.reason : undefined,
      httpStatus: resp.ok ? undefined : resp.status,
    })
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []

  const dispatch = () => {
    if (data.length) {
      try {
        const parsed = JSON.parse(data.join('\n'))
        opts.onFrame({ event: event || 'message', data: parsed })
      } catch {
        // 非 JSON 的 data 不是本接口的帧，丢弃
      }
    }
    event = ''
    data = []
  }

  const handleLine = (line: string) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return // 心跳注释帧（": ping"）
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 末尾裸 \r 可能是被分包劈开的 CRLF 前半，留到下一个 chunk 再归一
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, sep))
        buffer = buffer.slice(sep + 1)
      }
    }
    buffer += decoder.decode()
    for (const line of buffer.replace(/\r\n?/g, '\n').split('\n')) handleLine(line)
    dispatch()
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }
}
