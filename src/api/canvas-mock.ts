/**
 * 画布实时同步 + 画布助手的本地 mock（`?mock=canvas` 打开，见 canvas-mock-switch.ts）。
 *
 * <p>模拟一个内存里的「服务端」：画布详情 / 乐观锁保存（4002）/ 最近 20 个历史 revision / 变更事件流 /
 * revision 轮询 / 画布助手流式回复。形状对齐 canvas-home.ts、canvas-sync.ts、agent.ts 的真实接口。
 *
 * <p>画布助手脚本（按消息内容选）：
 * - 含「冲突」「提示词」：改第一个图片生成节点的提示词与名称、第一个文字节点的文案（你本地也改了那段文案且未保存 → 冲突弹窗）；
 * - 含「生成」：提交一次生成（只演示步骤与点数，不真的出图）；
 * - 含「未开启」：工具回 CANVAS_DISABLED（演示「画布助手暂未开启」）；
 * - 含「未知」：写类工具超时回 RESULT_UNKNOWN（演示「结果未知，正在核实」，随后读画布核实）；
 * - 其余：加 3 个节点并连线（本地有未保存改动 → 自动合并）。
 * 保存默认延迟 600ms；控制台 `__canvasMock.setSaveDelay(ms)` 可调大，方便制造「本地未保存时对方改了」。
 * `__canvasMock.agentAddNodes()` / `__canvasMock.agentEditPrompt(text)` 直接模拟画布助手改画布。
 */
import type { ApiResponse } from './types.ts'
import type {
  ICanvasApiEnvelope,
  ICanvasCatalog,
  ICanvasDetail,
  ICanvasSaveConflict,
  ICanvasSaveResp,
} from './canvas-home.ts'
import {
  CanvasRevisionNotRetained,
  type ICanvasChangeEvent,
  type ICanvasEventStreamHandlers,
  type ICanvasRevision,
} from './canvas-sync.ts'
import type { IAgentFrame } from './agent.ts'
import type { ICanvasAgentStreamReq } from './canvas-agent.ts'

type Snap = { nodes: Record<string, any>[]; edges: Record<string, any>[] }

interface IMockCanvas {
  id: string
  title: string
  revision: string
  snapshot: Snap
  updatedAt: number
  history: { revision: string; title: string; snapshot: Snap }[]
  events: ICanvasChangeEvent[]
}

const ok = <T>(data: T): ApiResponse<T> => ({ code: 0, msg: 'ok', data })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

let revSeq = 1
let idSeq = 100
let saveDelay = 600
const canvases = new Map<string, IMockCanvas>()
const listeners = new Map<string, Set<(event: ICanvasChangeEvent) => void>>()
/** 下一次 / 当前连接要发的结束帧（`__canvasMock.gone(code)` / `bye(code)`） */
const terminators = new Map<string, Set<(kind: 'gone' | 'bye', code: string) => void>>()

function nextRevision(): string {
  revSeq += 1
  return `r${String(revSeq).padStart(4, '0')}`
}

function textNode(id: string, x: number, y: number, text: string, title = '文字') {
  return { id, type: 'text', position: { x, y }, data: { title, subtitle: '文字', kind: 'text', text, mentions: [] } }
}
function imageNode(id: string, x: number, y: number, title = '图片') {
  return { id, type: 'image', position: { x, y }, data: { title, subtitle: '图片', kind: 'input', image: '' } }
}
function modelNode(id: string, x: number, y: number, prompt: string, title = '图片生成') {
  return {
    id,
    type: 'model',
    position: { x, y },
    data: {
      title,
      subtitle: '图片',
      kind: 'model',
      model: 'Image',
      modelId: 'img.mock',
      maxImageRefs: 5,
      capabilities: { count: true },
      ratio: '1:1',
      size: '1K',
      quality: 'medium',
      count: 1,
      cfg: 0.95,
      prompt,
      status: 'idle',
    },
  }
}
function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string) {
  return { id, source, sourceHandle, target, targetHandle, type: 'canvas-bezier' }
}

function ensureCanvas(id: string): IMockCanvas {
  let cv = canvases.get(id)
  if (cv) return cv
  const snapshot: Snap = {
    nodes: [
      textNode('t_mock_1', 120, 140, '一杯冒着热气的拿铁，木桌，清晨阳光', '咖啡文案'),
      imageNode('n_mock_1', 120, 420, '产品参考图'),
      modelNode('m_mock_1', 520, 180, '咖啡产品主图，暖色调，柔和光影', '主图生成'),
    ],
    edges: [
      edge('e_mock_1', 't_mock_1', 'text', 'm_mock_1', 'prompt'),
      edge('e_mock_2', 'n_mock_1', 'image', 'm_mock_1', 'image'),
    ],
  }
  cv = {
    id,
    title: '咖啡新品海报（mock）',
    revision: 'r0001',
    snapshot,
    updatedAt: Date.now(),
    history: [],
    events: [],
  }
  cv.history.push({ revision: cv.revision, title: cv.title, snapshot: clone(snapshot) })
  canvases.set(id, cv)
  return cv
}

function detailOf(cv: IMockCanvas, snap = cv.snapshot, revision = cv.revision, title = cv.title): ICanvasDetail {
  return {
    id: cv.id,
    title,
    revision,
    nodeCount: snap.nodes.length,
    coverUrl: '',
    createdAt: cv.updatedAt - 3600_000,
    updatedAt: cv.updatedAt,
    snapshot: clone(snap),
  }
}

/** 节点的非运行态内容（判断「改了哪些节点」） */
function nodeKey(node: Record<string, any> | undefined): string {
  if (!node) return ''
  const { status, progress, runId, requestId, candidates, ...rest } = node.data ?? {}
  void status
  void progress
  void runId
  void requestId
  void candidates
  return JSON.stringify({ t: node.type, p: node.position, d: rest })
}

function commit(cv: IMockCanvas, snapshot: Snap, title: string, source: string, actor: string): ICanvasChangeEvent {
  const before = new Map(cv.snapshot.nodes.map((node) => [node.id as string, node]))
  const changed = snapshot.nodes
    .filter((node) => nodeKey(before.get(node.id)) !== nodeKey(node))
    .map((node) => node.id as string)
  cv.snapshot = clone(snapshot)
  cv.title = title
  cv.revision = nextRevision()
  cv.updatedAt = Date.now()
  cv.history.push({ revision: cv.revision, title, snapshot: clone(snapshot) })
  if (cv.history.length > 20) cv.history.shift()
  const event: ICanvasChangeEvent = {
    canvasId: cv.id,
    revision: cv.revision,
    source,
    actor,
    changedNodeIds: changed,
    at: cv.updatedAt,
  }
  cv.events.push(event)
  if (cv.events.length > 50) cv.events.shift()
  // 推送异步发出（真实服务端经 Redis 也是异步的）
  setTimeout(() => listeners.get(cv.id)?.forEach((fn) => fn(event)), 30)
  return event
}

// ---------------- 画布接口 ----------------

export async function mockCanvasGet(id: string): Promise<ApiResponse<ICanvasDetail>> {
  await wait(120)
  return ok(detailOf(ensureCanvas(id)))
}

export async function mockGetAtRevision(id: string, revision: string): Promise<ICanvasDetail> {
  await wait(80)
  const cv = ensureCanvas(id)
  const hit = cv.history.find((item) => item.revision === revision)
  if (!hit) throw new CanvasRevisionNotRetained()
  return detailOf(cv, hit.snapshot, hit.revision, hit.title)
}

export async function mockRevision(id: string): Promise<ICanvasRevision> {
  await wait(40)
  const cv = ensureCanvas(id)
  return { revision: cv.revision, updatedAt: cv.updatedAt, push: true, pollIntervalMs: 5000 }
}

export async function mockCanvasSave(
  id: string,
  body: { title?: string; snapshot: unknown; ifMatchRevision: string },
): Promise<ICanvasApiEnvelope<ICanvasSaveResp | ICanvasSaveConflict>> {
  await wait(saveDelay)
  const cv = ensureCanvas(id)
  if (body.ifMatchRevision !== cv.revision) {
    return {
      code: 4002,
      msg: '画布已被修改',
      data: { conflict: 'revision', revision: cv.revision, updatedAt: cv.updatedAt },
    }
  }
  const snap = clone(body.snapshot) as Snap
  commit(cv, snap, body.title || cv.title, 'user', 'mock-user')
  return {
    code: 0,
    msg: 'ok',
    data: { revision: cv.revision, updatedAt: cv.updatedAt, nodeCount: snap.nodes.length, coverUrl: '' },
  }
}

export async function mockCatalog(): Promise<ApiResponse<ICanvasCatalog>> {
  await wait(60)
  const model = {
    model: 'Image',
    label: 'Mock 图片模型',
    modelId: 'img.mock',
    badge: '',
    maxImageRefs: 5,
    maxReferenceVideos: 0,
    ratios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    sizes: ['1K', '2K'],
    qualities: ['low', 'medium', 'high'],
    durations: [],
    sound: false,
    countMax: 4,
    capabilities: { quality: true, count: true, duration: false, sound: false },
    prices: [
      { size: '1K', points: 12 },
      { size: '2K', points: 20 },
    ],
    ready: true,
  }
  return ok({ imageModels: [model], video_models: [], tools: [] })
}

/** 估价 mock：高 > 中 > 低，按尺寸 / 张数 / 参考图线性放大；文案走 actual_cost 分支 */
export async function mockEstimate(req: {
  size?: string
  count?: number
  quality?: string
  ref_images?: number
}): Promise<ApiResponse<import('./canvas-home.ts').ICanvasEstimateResp>> {
  await wait(80)
  const q = { low: 1, medium: 2, high: 4 }[req.quality ?? 'high'] ?? 2
  const sizeK = req.size === '2K' ? 1.6 : 1
  const points = Math.ceil((4 * q * sizeK + (req.ref_images ?? 0) * 1.5) * Math.max(1, req.count ?? 1))
  return ok({
    available: true,
    points,
    cap_points: points,
    settle_mode: 'actual_cost',
    currency: 'points',
    billing_mode: 'ACTUAL_COST',
  })
}

// ---------------- 事件流 ----------------

export function mockEventStream(id: string, handlers: ICanvasEventStreamHandlers): Promise<void> {
  const cv = ensureCanvas(id)
  return new Promise<void>((_resolve, reject) => {
    const push = (event: ICanvasChangeEvent) => handlers.onEvent(clone(event))
    const set = listeners.get(id) ?? new Set()
    listeners.set(id, set)
    const enders = terminators.get(id) ?? new Set()
    terminators.set(id, enders)
    const timer = setInterval(() => handlers.onActivity?.(), 15000)
    const end = (kind: 'gone' | 'bye', code: string) => {
      set.delete(push)
      enders.delete(end)
      clearInterval(timer)
      if (kind === 'gone')
        handlers.onGone?.(code, code === 'SESSION_EXPIRED' ? '登录已失效，请重新登录' : '画布已删除或不再属于你')
      else handlers.onBye?.(code, code === 'RECONNECT' ? 'reconnect' : '实时连接暂不可用，稍后自动重连')
      _resolve()
    }
    const stop = () => {
      set.delete(push)
      enders.delete(end)
      clearInterval(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    if (handlers.signal.aborted) return stop()
    handlers.signal.addEventListener('abort', stop, { once: true })
    setTimeout(() => {
      if (handlers.signal.aborted) return
      handlers.onOpen?.()
      handlers.onActivity?.()
      // Last-Event-ID 续传：补发游标之后的事件
      if (handlers.lastEventId) {
        const idx = cv.events.findIndex((event) => event.revision === handlers.lastEventId)
        if (idx >= 0) cv.events.slice(idx + 1).forEach(push)
      }
      set.add(push)
      enders.add(end)
    }, 80)
  })
}

// ---------------- 画布助手改画布 ----------------

function firstCanvas(): IMockCanvas {
  return canvases.values().next().value ?? ensureCanvas('cv_0000000000000001')
}

function agentAddNodes(cv = firstCanvas()): { event: ICanvasChangeEvent; ids: string[] } {
  const snap = clone(cv.snapshot)
  // 新的一行排在现有内容下方（进页视口里看得到）
  const maxY = Math.max(0, ...snap.nodes.map((node) => Number(node.position?.y) || 0))
  const y = maxY + 340
  const a = `t_ag_${++idSeq}`
  const b = `m_ag_${++idSeq}`
  const c = `t_ag_${++idSeq}`
  snap.nodes.push(
    textNode(a, -280, y, '同款文案：秋季限定南瓜拿铁，温暖上市', '秋季文案'),
    modelNode(b, 100, y, '秋季限定海报，南瓜色调，落叶氛围', '秋季海报生成'),
    textNode(c, 480, y, '投放尺寸：小红书 3:4 竖版', '投放说明'),
  )
  snap.edges.push(edge(`e_ag_${++idSeq}`, a, 'text', b, 'prompt'))
  const event = commit(cv, snap, cv.title, 'agent', '画布助手')
  return { event, ids: [a, b, c] }
}

function agentEditPrompt(text = '画布助手改写：极简白底产品图，突出杯身质感', cv = firstCanvas()): ICanvasChangeEvent {
  const snap = clone(cv.snapshot)
  const model = snap.nodes.find((node) => node.type === 'model')
  if (model) {
    model.data.prompt = text
    model.data.title = '主图生成（助手改）'
  }
  // 第一个文字节点的文案也一起改：本地同时改了它就会冲突，提示词那处不冲突、自动合并
  const copy = snap.nodes.find((node) => node.type === 'text')
  if (copy) copy.data.text = '画布助手改写：清晨第一杯，醇香拿铁'
  return commit(cv, snap, cv.title, 'agent', '画布助手')
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__canvasMock = {
    canvases,
    setSaveDelay: (ms: number) => {
      saveDelay = Math.max(0, ms)
    },
    /** 服务端宣告终止：gone('CANVAS_GONE' | 'SESSION_EXPIRED') 不重连；bye('RECONNECT' | 'CONN_SLOT_UNAVAILABLE') 重连 */
    gone: (code = 'CANVAS_GONE') => terminators.forEach((set) => [...set].forEach((fn) => fn('gone', code))),
    bye: (code = 'RECONNECT') => terminators.forEach((set) => [...set].forEach((fn) => fn('bye', code))),
    agentAddNodes: () => agentAddNodes(),
    agentEditPrompt: (text?: string) => agentEditPrompt(text),
  }
}

// ---------------- 画布助手接口 ----------------

function frame(eventType: string, payload: Record<string, unknown>): IAgentFrame {
  return { event: 'PROCESSING', data: { content: { eventType, payload } } }
}

/** Java emitCanvasToolCall 的真实形状：{toolName 展示名, toolKey, toolCallId, status:'started', message, argsSummary} */
const TOOL_KEYS: Record<string, [string, (n: number) => string]> = {
  读取画布: ['canvas_get', () => '正在读取画布…'],
  添加画布节点: ['canvas_add_nodes', (n) => `正在添加 ${n} 个节点…`],
  修改画布节点: ['canvas_update_nodes', (n) => `正在修改 ${n} 个节点…`],
  画布连线: ['canvas_connect', (n) => `正在连接 ${n} 条线…`],
  画布模型目录: ['canvas_catalog', () => '正在查询可用模型…'],
  画布节点生成: ['canvas_run_node', () => '正在提交生成…'],
}
let callSeq = 0
function toolCall(toolName: string, count = 0): IAgentFrame {
  const [toolKey, say] = TOOL_KEYS[toolName] ?? ['', () => '正在操作画布…']
  return frame('tool_call', {
    toolName,
    toolKey,
    toolCallId: `call-${++callSeq}`,
    status: 'started',
    message: say(count),
    argsSummary: count ? { nodesCount: count } : {},
  })
}

async function streamText(text: string, emit: (f: IAgentFrame) => void, signal: AbortSignal) {
  for (let i = 0; i < text.length; i += 6) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    emit(frame('message_delta', { delta: text.slice(i, i + 6), source: 'response' }))
    await wait(35)
  }
}

export async function mockAgentStream(
  req: ICanvasAgentStreamReq,
  opts: { requestId: string; signal: AbortSignal; onFrame: (frame: IAgentFrame) => void },
): Promise<void> {
  const cv = ensureCanvas(req.canvasId)
  const emit = (f: IAgentFrame) => {
    if (!opts.signal.aborted) opts.onFrame(f)
  }
  const step = async (ms: number) => {
    await wait(ms)
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')
  }
  emit({ event: 'START', data: { content: {} } })
  await step(250)
  emit(frame('thinking_delta', { delta: '先读取画布，确认现有节点与连线。', source: 'planner' }))
  emit(toolCall('读取画布'))
  await step(500)
  emit(
    frame('tool_result', {
      toolName: '读取画布',
      status: 'completed',
      message: '',
      result: {
        resultType: 'canvas_tool_result',
        isError: false,
        revision: cv.revision,
        result: { revision: cv.revision, nodeCount: cv.snapshot.nodes.length },
      },
    }),
  )
  const content = req.content
  if (/未开启/.test(content)) {
    emit(toolCall('添加画布节点', 1))
    await step(400)
    emit(
      frame('tool_result', {
        toolName: '添加画布节点',
        status: 'failed',
        message: '画布操作失败 [CANVAS_DISABLED] 画布能力未开启',
        result: {
          resultType: 'canvas_tool_result',
          isError: true,
          result: { errorCode: 'CANVAS_DISABLED', message: '画布能力未开启', retryable: false },
        },
      }),
    )
    await streamText('抱歉，画布能力暂未开启，我现在还不能修改画布。', emit, opts.signal)
  } else if (/未知/.test(content)) {
    emit(toolCall('添加画布节点', 2))
    await step(500)
    emit(
      frame('tool_result', {
        toolName: '添加画布节点',
        status: 'failed',
        message: '画布操作结果未知 [RESULT_UNKNOWN] 请求超时，结果未知：这次操作可能已经在画布服务里执行了。',
        result: {
          resultType: 'canvas_tool_result',
          isError: true,
          result: { errorCode: 'RESULT_UNKNOWN', message: '请求超时，结果未知', retryable: false },
        },
      }),
    )
    emit(toolCall('读取画布'))
    await step(600)
    emit(
      frame('tool_result', {
        toolName: '读取画布',
        status: 'completed',
        message: '',
        result: {
          resultType: 'canvas_tool_result',
          isError: false,
          revision: cv.revision,
          result: { revision: cv.revision, nodeCount: cv.snapshot.nodes.length },
        },
      }),
    )
    await streamText('核实后画布上没有新增节点，刚才那次添加没有生效，我再重新添加一次。', emit, opts.signal)
  } else if (/冲突|提示词/.test(content)) {
    emit(toolCall('修改画布节点', 1))
    await step(700)
    const event = agentEditPrompt(undefined, cv)
    emit(
      frame('tool_result', {
        toolName: '修改画布节点',
        status: 'completed',
        message: '',
        result: {
          resultType: 'canvas_tool_result',
          isError: false,
          revision: event.revision,
          result: {
            revision: event.revision,
            nodeCount: cv.snapshot.nodes.length,
            updated: event.changedNodeIds,
            changedNodeIds: event.changedNodeIds,
          },
        },
      }),
    )
    await step(200)
    await streamText(
      '已把「主图生成」的提示词改成极简白底风格，并改写了「咖啡文案」。你可以直接执行这个节点出图。',
      emit,
      opts.signal,
    )
  } else if (/生成|出图/.test(content)) {
    emit(toolCall('画布模型目录'))
    await step(400)
    emit(
      frame('tool_result', {
        toolName: '画布模型目录',
        status: 'completed',
        message: '',
        result: { resultType: 'canvas_tool_result', isError: false, result: { models: [] } },
      }),
    )
    const target = cv.snapshot.nodes.find((node) => node.type === 'model')
    emit(toolCall('画布节点生成'))
    await step(600)
    emit(
      frame('tool_result', {
        toolName: '画布节点生成',
        status: 'completed',
        message: '',
        result: {
          resultType: 'canvas_tool_result',
          isError: false,
          result: {
            requestId: '90001',
            runId: 'ag_mock',
            status: 'queued',
            credits: 12,
            maxPoints: 12,
            nodeId: target?.id ?? '',
          },
        },
      }),
    )
    await step(200)
    await streamText(
      '已用 Mock 图片模型提交「主图生成」，冻结 12 点数，出图后按实际张数结算，失败自动退回。',
      emit,
      opts.signal,
    )
  } else {
    emit(
      frame('thinking_delta', {
        delta: '用户要扩展一组秋季物料：加两段文案和一个生成节点，并把文案连到生成节点。',
        source: 'planner',
      }),
    )
    emit(toolCall('添加画布节点', 3))
    await step(800)
    const { event, ids } = agentAddNodes(cv)
    emit(
      frame('tool_result', {
        toolName: '添加画布节点',
        status: 'completed',
        message: '',
        result: {
          resultType: 'canvas_tool_result',
          isError: false,
          revision: event.revision,
          result: {
            revision: event.revision,
            nodeCount: cv.snapshot.nodes.length,
            nodes: ids.map((nodeId) => ({ nodeId })),
            changedNodeIds: event.changedNodeIds,
          },
        },
      }),
    )
    emit(toolCall('画布连线', 1))
    await step(300)
    emit(
      frame('tool_result', {
        toolName: '画布连线',
        status: 'completed',
        message: '',
        result: { resultType: 'canvas_tool_result', isError: false, result: { edges: [{}] } },
      }),
    )
    await step(200)
    await streamText(
      `已在下方加了「秋季文案」「秋季海报生成」「投放说明」3 个节点，并把文案连到了生成节点。画布现在共 ${cv.snapshot.nodes.length} 个节点。`,
      emit,
      opts.signal,
    )
  }
  emit({ event: 'END', data: { content: { type: 'agent_finish' } } })
}
