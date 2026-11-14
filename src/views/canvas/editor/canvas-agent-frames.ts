/**
 * 画布助手的帧归并：把 /agent/stream 的 PROCESSING 帧整理成面板可渲染的一轮回复（正文 / 思考 / 工具步骤 / 生成任务）。
 *
 * <p>工具名：Java 出网前已换成中文展示名（AgentInterruptProtocol.TOOL_DISPLAY_NAMES：canvas_add_nodes → 添加画布节点 …），
 * 这里两种都认，统一回 canvas_* 再映射成「正在添加 3 个节点…」「已添加 3 个节点」。
 * tool_result.result = frontend_payload（键已转 lowerCamel）：{resultType: canvas_tool_result, isError, revision, result: Go 工具原始出参}。
 * tool_call（可选帧，{toolName, toolArgs}）到达时先显示进行中的动作，tool_result 到达再落为完成 / 失败。
 */
import { applyFrame, emptyReply, type IAgentForm, type IAgentFrame, type IAgentGenTask, type IAgentMessage } from '@/api/agent.ts'

/** unknown：工具超时但可能已在画布服务执行（RESULT_UNKNOWN），模型会先核实，不算失败 */
export type CanvasAgentStepStatus = 'running' | 'done' | 'failed' | 'unknown'

export interface ICanvasAgentStep {
  key: string
  /** 归一后的工具名（canvas_*；不认识的保留原名） */
  tool: string
  status: CanvasAgentStepStatus
  /** 中文动作文案 */
  text: string
  /** 失败原因 / 工具补充说明 */
  detail: string
  /** canvas_run_node：生成节点、请求号与预扣点数 */
  nodeId?: string
  requestId?: string
  credits?: number
  /** 工具返回的 revision（展示用） */
  revision?: string
  /** 工具错误码（CANVAS_DISABLED / INSUFFICIENT_POINTS …） */
  errorCode?: string
  /** 写类工具出参的 changed_node_ids（lowerCamel 出网为 changedNodeIds）：用于高亮 */
  changedNodeIds?: string[]
}

export const RESULT_UNKNOWN_CODE = 'RESULT_UNKNOWN'
export const RESULT_UNKNOWN_TEXT = '结果未知，正在核实'

export interface ICanvasAgentReply {
  text: string
  thinking: string
  steps: ICanvasAgentStep[]
  /** 通用生图工具提交的任务（非画布工具；与智能体页同一口径） */
  tasks: IAgentGenTask[]
  error: string
  finished: boolean
  /** 有工具回了 CANVAS_DISABLED（Java 未接 Go 画布服务）：面板显示「画布助手暂未开启」 */
  disabled: boolean
  /** ERROR 帧的 content.code（续流带 clientCaps=canvas 时才有）：FORBIDDEN / TURN_FAILED / TURN_INTERRUPTED */
  errorCode?: string
  /** 用户打断收口（END{reason:interrupted}） */
  interrupted?: boolean
  /** 本轮以确认 / 参数表单中断（question_asker：interrupt_required 帧，或 question_request 工具结果回退）；null = 无 */
  form: IAgentForm | null
}

export const TURN_FORBIDDEN_CODE = 'FORBIDDEN'
export const TURN_FAILED_CODE = 'TURN_FAILED'
export const TURN_INTERRUPTED_CODE = 'TURN_INTERRUPTED'

export function emptyCanvasReply(): ICanvasAgentReply {
  return { text: '', thinking: '', steps: [], tasks: [], error: '', finished: false, disabled: false, form: null }
}

/**
 * 表单帧交给智能体页同一套解析（agent.ts applyFrame：interrupt_required → 带 interruptId 的表单，
 * tool_result.result.resultType=question_request → 尚无 interrupt_required 时的回退），只取它解析出的 form。
 */
function mergeForm(reply: ICanvasAgentReply, frame: IAgentFrame): void {
  const scratch = emptyReply()
  scratch.form = reply.form
  applyFrame(scratch, frame)
  reply.form = scratch.form
}

/** Java 展示名 → 工具名（与 AgentInterruptProtocol.TOOL_DISPLAY_NAMES 同一张表） */
const DISPLAY_TO_TOOL: Record<string, string> = {
  画布列表: 'canvas_list',
  新建画布: 'canvas_create',
  读取画布: 'canvas_get',
  添加画布节点: 'canvas_add_nodes',
  修改画布节点: 'canvas_update_nodes',
  删除画布节点: 'canvas_delete_nodes',
  移动画布节点: 'canvas_move_nodes',
  调整画布节点大小: 'canvas_resize_nodes',
  画布连线: 'canvas_connect',
  断开画布连线: 'canvas_disconnect',
  画布自动排版: 'canvas_auto_layout',
  画布批量编辑: 'canvas_batch_edit',
  画布模型目录: 'canvas_catalog',
  画布节点生成: 'canvas_run_node',
  查询画布生成: 'canvas_get_run',
  画布生成记录: 'canvas_list_runs',
  取消画布生成: 'canvas_cancel_run',
  选择画布候选图: 'canvas_select_candidate',
}

export function normalizeToolName(name: string): string {
  const trimmed = name.trim()
  return DISPLAY_TO_TOOL[trimmed] ?? trimmed
}

/** 计数类动作：动词 + 量词；count 取自参数 / 出参的数组长度 */
const COUNTED: Record<string, { verb: string; unit: string; args: string[]; result: string[] }> = {
  canvas_add_nodes: { verb: '添加', unit: '个节点', args: ['nodes'], result: ['nodes'] },
  canvas_update_nodes: { verb: '修改', unit: '个节点', args: ['updates'], result: ['updated'] },
  canvas_delete_nodes: {
    verb: '删除',
    unit: '个节点',
    args: ['nodeIds', 'node_ids'],
    result: ['deletedNodes', 'deleted_nodes'],
  },
  canvas_move_nodes: { verb: '移动', unit: '个节点', args: ['moves'], result: ['nodes'] },
  canvas_resize_nodes: { verb: '调整', unit: '个节点的尺寸', args: ['sizes'], result: ['nodes'] },
  canvas_connect: { verb: '连接', unit: '条连线', args: ['edges'], result: ['edges'] },
  canvas_disconnect: { verb: '断开', unit: '条连线', args: ['edgeIds', 'edge_ids', 'pairs'], result: ['removed'] },
  canvas_auto_layout: { verb: '整理', unit: '个节点的布局', args: ['nodeIds', 'node_ids'], result: ['nodes'] },
  canvas_batch_edit: { verb: '批量编辑', unit: '步', args: ['ops'], result: ['results'] },
}

/** 不计数的动作：进行中 / 完成两种说法 */
const PLAIN: Record<string, [string, string]> = {
  canvas_get: ['正在读取画布', '已读取画布'],
  canvas_list: ['正在查看画布列表', '已查看画布列表'],
  canvas_create: ['正在新建画布', '已新建画布'],
  canvas_catalog: ['正在查看可用模型与价目', '已查看可用模型与价目'],
  canvas_run_node: ['正在提交生成', '已提交生成'],
  canvas_get_run: ['正在查询生成进度', '已查询生成进度'],
  canvas_list_runs: ['正在查看生成记录', '已查看生成记录'],
  canvas_cancel_run: ['正在取消生成', '已取消生成'],
  canvas_select_candidate: ['正在选用候选图', '已选用候选图'],
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown) => (v == null ? '' : String(v))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function countOf(obj: Record<string, unknown>, keys: string[]): number | undefined {
  let total: number | undefined
  for (const key of keys) {
    const value = obj[key]
    if (Array.isArray(value)) total = (total ?? 0) + value.length
  }
  return total
}

/** 一个工具调用的中文动作文案 */
export function describeCanvasTool(
  tool: string,
  phase: CanvasAgentStepStatus,
  args: Record<string, unknown> = {},
  result: Record<string, unknown> = {},
): string {
  if (phase === 'unknown') return RESULT_UNKNOWN_TEXT
  const counted = COUNTED[tool]
  if (counted) {
    const n = countOf(result, counted.result) ?? countOf(args, counted.args)
    const what = n == null ? counted.unit.replace(/^[个条步]/, '') : `${n} ${counted.unit}`
    if (phase === 'running') return `正在${counted.verb} ${what}…`
    if (phase === 'failed') return `${counted.verb}${what}失败`
    return `已${counted.verb} ${what}`
  }
  const plain = PLAIN[tool]
  if (plain) {
    if (phase === 'running') return `${plain[0]}…`
    if (phase === 'failed') return `${plain[0].replace(/^正在/, '')}失败`
    return plain[1]
  }
  // 非画布工具：用原展示名
  if (phase === 'running') return `正在调用「${tool}」…`
  if (phase === 'failed') return `「${tool}」失败`
  return `已完成「${tool}」`
}

let stepSeq = 0

const GEN_STATUSES: readonly IAgentGenTask['status'][] = ['queued', 'processing', 'success', 'failed']

function genTasksOf(result: Record<string, unknown>): IAgentGenTask[] {
  if (result.resultType !== 'generation_task_submitted' || !Array.isArray(result.results)) return []
  return result.results
    .map(rec)
    .filter((x) => typeof x.taskId === 'string' && x.taskId)
    .map((x) => ({
      taskId: str(x.taskId),
      status: GEN_STATUSES.includes(x.status as IAgentGenTask['status'])
        ? (x.status as IAgentGenTask['status'])
        : 'queued',
      imageUrls: Array.isArray(x.imageUrls) ? x.imageUrls.filter((u): u is string => typeof u === 'string' && !!u) : [],
      ...(num(x.pricePoints) != null ? { pricePoints: num(x.pricePoints) } : {}),
    }))
}

/** 把一帧归并进回复（与智能体页 applyFrame 同一套事件；多认 tool_call 与画布工具结果） */
export function applyCanvasFrame(reply: ICanvasAgentReply, frame: IAgentFrame): void {
  const content = rec(frame.data?.content)
  if (frame.event === 'END') {
    reply.finished = true
    if (str(content.reason) === 'interrupted') {
      // 用户打断：没跑完的步骤按未完成显示
      reply.interrupted = true
      for (const step of reply.steps) if (step.status === 'running') step.status = 'failed'
      if (!reply.text) reply.text = '已停止。'
      return
    }
    for (const step of reply.steps) if (step.status === 'running') step.status = 'done'
    return
  }
  if (frame.event === 'ERROR') {
    const code = str(content.code)
    if (code) reply.errorCode = code
    reply.error =
      code === TURN_FORBIDDEN_CODE
        ? '会话不存在或无权访问'
        : str(content.message) || (code === TURN_INTERRUPTED_CODE ? '本轮执行被中断，请重新发送' : '画布助手执行失败')
    reply.finished = true
    for (const step of reply.steps) if (step.status === 'running') step.status = 'failed'
    return
  }
  if (frame.event !== 'PROCESSING') return
  const payload = rec(content.payload)
  const type = str(content.eventType)
  if (type === 'message_delta') {
    reply.text += str(payload.delta)
    return
  }
  if (type === 'thinking_delta') {
    reply.thinking += str(payload.delta)
    return
  }
  if (type === 'interrupt_required') {
    mergeForm(reply, frame)
    return
  }
  if (type === 'tool_call') {
    // Java 帧：{toolName(展示名), toolKey(canvas_*), toolCallId, status:'started', message:'正在添加 3 个节点…', argsSummary:{nodesCount…, canvasId}}
    // 仅本轮带 canvasId 时才发；旧写法 toolArgs 也认
    const tool = normalizeToolName(str(payload.toolKey ?? payload.tool_key) || str(payload.toolName))
    const args = rec(payload.toolArgs ?? payload.arguments)
    const message = str(payload.message).trim()
    reply.steps.push({
      key: `s${++stepSeq}`,
      tool,
      status: 'running',
      text: message || describeCanvasTool(tool, 'running', args),
      detail: '',
      ...(str(args.nodeId ?? args.node_id) ? { nodeId: str(args.nodeId ?? args.node_id) } : {}),
    })
    return
  }
  if (type === 'tool_result') {
    const tool = normalizeToolName(str(payload.toolName))
    const front = rec(payload.result)
    const inner = rec(front.result)
    const errorCode = str(inner.errorCode ?? inner.error_code)
    const unknown = errorCode === RESULT_UNKNOWN_CODE
    const failed = !unknown && (str(payload.status) === 'failed' || front.isError === true)
    // 参数确认 / 超预算确认表单（question_asker）：不记成工具步骤，表单本身由 interrupt_required 渲染
    if (str(payload.status) === 'interrupted' || front.resultType === 'question_request') {
      mergeForm(reply, frame)
      return
    }
    const tasks = genTasksOf(front)
    if (tasks.length) reply.tasks.push(...tasks)
    let step = [...reply.steps].reverse().find((item) => item.tool === tool && item.status === 'running')
    if (!step) {
      step = { key: `s${++stepSeq}`, tool, status: 'running', text: '', detail: '' }
      reply.steps.push(step)
    }
    step.status = unknown ? 'unknown' : failed ? 'failed' : 'done'
    step.text = describeCanvasTool(tool, step.status, {}, inner)
    step.detail = failed ? str(inner.message) || str(payload.message) : ''
    if ((failed || unknown) && errorCode) step.errorCode = errorCode
    const changed = inner.changedNodeIds ?? inner.changed_node_ids
    if (Array.isArray(changed)) step.changedNodeIds = changed.map(str).filter(Boolean)
    if (errorCode === 'CANVAS_DISABLED') reply.disabled = true
    const revision = str(front.revision ?? inner.revision)
    if (revision) step.revision = revision
    const nodeId = str(inner.nodeId ?? inner.node_id)
    if (nodeId) step.nodeId = nodeId
    const requestId = str(inner.requestId ?? inner.request_id)
    if (requestId) step.requestId = requestId
    const credits = num(inner.maxPoints ?? inner.max_points) ?? num(inner.credits)
    if (credits != null) step.credits = credits
  }
}

// ---------------- 历史回读与续流游标 ----------------

/** 引用的画布节点（与面板 ICanvasAgentRef 同形） */
export interface ICanvasAgentNodeRef {
  id: string
  title: string
  kind: string
}

const REF_MARK = '[引用画布节点]'

/** 引用的节点写进正文：Java 只收 canvasId，节点 id 靠正文交给模型 */
export function composeCanvasContent(text: string, list: ICanvasAgentNodeRef[]): string {
  if (!list.length) return text
  const lines = list.map((item) => `${item.id}「${item.title}」（${item.kind}）`).join('、')
  return `${text}\n\n${REF_MARK} ${lines}`
}

/** composeCanvasContent 的逆：历史里的用户消息拆回正文 + 引用节点（认不出就整段当正文） */
export function parseCanvasContent(raw: string): { content: string; refs: ICanvasAgentNodeRef[] } {
  const marker = `\n\n${REF_MARK} `
  const idx = raw.lastIndexOf(marker)
  if (idx < 0) return { content: raw, refs: [] }
  const refs: ICanvasAgentNodeRef[] = []
  for (const m of raw.slice(idx + marker.length).matchAll(/([^\s、「」]+)「([^」]*)」（([^）]*)）/g)) {
    refs.push({ id: m[1]!, title: m[2]!, kind: m[3]! })
  }
  return refs.length ? { content: raw.slice(0, idx), refs } : { content: raw, refs: [] }
}

/** 帧里的续流游标：turnId（START / PROCESSING / END 都带）与 PROCESSING 的 sequence */
export function canvasFrameCursor(frame: IAgentFrame): { turnId: string; seq: number | undefined } {
  const content = rec(frame.data?.content)
  const seq = Number(content.sequence)
  return {
    turnId: str(content.turnId),
    seq: frame.event === 'PROCESSING' && content.sequence != null && Number.isFinite(seq) ? seq : undefined,
  }
}

/** 已落库的回复一律视为收尾：打断的轮次没有终止帧，进行中的工具步骤按完成显示 */
function settleHistoryReply(reply: ICanvasAgentReply): void {
  reply.finished = true
  for (const step of reply.steps) if (step.status === 'running') step.status = 'done'
}

export interface ICanvasAgentHistoryTurn {
  key: string
  content: string
  refs: ICanvasAgentNodeRef[]
  /** 还没有助手消息（运行中的一轮只落了用户那条）时 finished=false，面板据此尝试续流 */
  reply: ICanvasAgentReply
  /** 发起本轮的用户消息透传的 attribute（表单续答的答案在 attribute.answers；含被隐藏的续答消息） */
  attribute?: Record<string, unknown>
}

/**
 * 会话消息 → 面板的轮次：一条用户消息开一轮，其后的助手消息（sseEvents 与实时流同形）归并进这一轮的回复。
 * 隐藏的用户消息跳过；助手消息前面没有可挂的用户消息时单独成一轮（正文为空）。
 */
export function canvasTurnsFromMessages(messages: IAgentMessage[]): ICanvasAgentHistoryTurn[] {
  const out: ICanvasAgentHistoryTurn[] = []
  let open: ICanvasAgentHistoryTurn | null = null
  /** 被隐藏的用户消息（表单续答）带的 attribute：挂到它后面那条助手消息成的轮次上 */
  let hiddenAttribute: Record<string, unknown> | undefined
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.hidden) {
        hiddenAttribute = m.attribute
        continue
      }
      hiddenAttribute = undefined
      const parsed = parseCanvasContent(typeof m.content === 'string' ? m.content : '')
      open = { key: `m${m.id}`, content: parsed.content, refs: parsed.refs, reply: emptyCanvasReply() }
      if (m.attribute) open.attribute = m.attribute
      out.push(open)
      continue
    }
    if (m.role !== 'assistant') continue
    const reply = emptyCanvasReply()
    for (const frame of m.sseEvents ?? []) applyCanvasFrame(reply, frame)
    if (!m.sseEvents && typeof m.content === 'string') reply.text = m.content
    settleHistoryReply(reply)
    // 历史里的 CANVAS_DISABLED 只代表当时未开启，不把面板锁死；高亮也不重放
    reply.disabled = false
    for (const step of reply.steps) step.changedNodeIds = undefined
    if (open && !open.reply.finished) {
      open.reply = reply
    } else {
      out.push({ key: `m${m.id}`, content: '', refs: [], reply, ...(hiddenAttribute ? { attribute: hiddenAttribute } : {}) })
    }
    hiddenAttribute = undefined
    open = null
  }
  return out
}

/** 进行中回复的快照（与续流游标一起存本地）：去掉一次性的高亮标记 */
export function canvasReplySnapshot(reply: ICanvasAgentReply): ICanvasAgentReply {
  const copy = JSON.parse(JSON.stringify(reply)) as ICanvasAgentReply
  for (const step of copy.steps) delete step.changedNodeIds
  return copy
}

/** 读回快照：形状不对回 null（改为整轮重放）；步骤换新 key，免得与本页新编的 s{n} 撞 */
export function canvasReplyFromSnapshot(raw: unknown): ICanvasAgentReply | null {
  const value = rec(raw)
  if (typeof value.text !== 'string' || !Array.isArray(value.steps) || !Array.isArray(value.tasks)) return null
  const reply = { ...emptyCanvasReply(), ...(value as Partial<ICanvasAgentReply>) } as ICanvasAgentReply
  reply.steps = reply.steps.map((step) => ({ ...step, key: `s${++stepSeq}` }))
  reply.finished = false
  reply.error = ''
  return reply
}
