/**
 * 画布编辑器状态与业务（模块级单例，节点组件与面板共用）。
 *
 * <p>职责：加载 / 乐观锁保存（含 4002 冲突）/ 节点增删连线 / 单节点执行（幂等提交 +
 * 1.2s 轮询 + 取消）/ 候选选择。快照节点 data 内部 camelCase 原样收发（契约 1.4），
 * 接口外层 snake_case 由 src/api/canvasHome.ts 处理。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import {
  canvasGet,
  canvasNodeRun,
  canvasRunCancel,
  canvasRunGet,
  canvasRuns,
  canvasSaveWithLock,
  canvasSelectCandidate,
  canvasCatalog,
  type ICanvasCatalog,
  type ICanvasCatalogModel,
  type ICanvasRunReq,
  type ICanvasRunRef,
  type ICanvasRunResult,
} from '@/api/canvasHome.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import {
  applyModelToNode,
  buildReferences,
  edgeColorForHandle,
  isDuplicateEdge,
  makeImageNode,
  makeModelNode,
  makeTextNode,
  makeToolNode,
  makeVideoNode,
  nextEdgeId,
  normalizeHandle,
  renumberDefaultTitles,
  spawnPosition,
  validateConnection,
} from './graph.ts'
import type {
  CanvasEditorEdge,
  CanvasEditorNode,
  CanvasEditorNodeData,
  CanvasEditorSnapshot,
  CanvasToolKind,
} from './types.ts'

const { message, dialog } = createDiscreteApi(['message', 'dialog'])

/** 供编辑器子组件使用的消息提示（naive 离散 API，组件树外可用） */
export const editorMessage = message
/** 供编辑器页面使用的确认弹窗（页面自身渲染的 n-config-provider 不构成祖先注入，离散 API 才可靠） */
export const editorDialog = dialog

// ---------------- 模块级单例状态 ----------------

const nodes = ref<CanvasEditorNode[]>([])
const edges = ref<CanvasEditorEdge[]>([])
const title = ref('')
const revision = ref('')
const loading = ref(false)
const loadError = ref('')
const ready = ref(false)
/** idle / dirty / saving / saved / error / conflict */
const saveState = ref<'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'>('idle')
const saveError = ref('')
const lastSavedAt = ref(0)
const selectedNodeId = ref('')
const catalog = ref<ICanvasCatalog | null>(null)

let canvasId = ''
let lastSignature = ''
let initSeq = 0
let saveSeq = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<unknown> = Promise.resolve()
let conflictDialogOpen = false

/** 节点 id → 最近一次「成功」run 的 run_id（select-candidate 必须用成功 run，内存缓存） */
const productRunIds = new Map<string, string>()

// ---------------- 快照序列化与脏检测 ----------------

/** 纯运行态字段：保存时服务端本就会剥离，脏检测也把它们排除（轮询写进度不触发保存） */
const RUNTIME_KEYS = new Set([
  'status',
  'progress',
  'runId',
  'requestId',
  'errorMessage',
  'errorCode',
  'retryable',
  'requestedCount',
  'candidates',
  'selectedCandidate',
])
/** 成品字段：在模型 / 工具节点上是运行态（输入节点的 image / video 是用户内容，要保留） */
const PRODUCT_KEYS = new Set(['image', 'video', 'assetId', 'resultText', 'resultImage'])

function slimData(node: CanvasEditorNode): Record<string, unknown> {
  const data = node.data as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (RUNTIME_KEYS.has(key)) continue
    if (PRODUCT_KEYS.has(key) && (node.type === 'model' || node.type === 'tool')) continue
    out[key] = data[key]
  }
  return out
}

/** 白名单序列化：Vue Flow 会往节点对象上挂内部字段，保存只取契约结构 */
function buildSnapshot(): CanvasEditorSnapshot {
  return {
    nodes: nodes.value.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: JSON.parse(JSON.stringify(node.data)) as CanvasEditorNodeData,
      ...(node.draggable === false ? { draggable: false } : {}),
      ...(node.selectable === false ? { selectable: false } : {}),
      ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
    })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: 'canvas-bezier' as const,
      data: edge.data ? { ...edge.data } : undefined,
    })),
  }
}

function signature(): string {
  return JSON.stringify({
    title: title.value,
    nodes: nodes.value.map((node) => ({ id: node.id, type: node.type, p: node.position, d: slimData(node) })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      s: edge.source,
      t: edge.target,
      sh: edge.sourceHandle ?? '',
      th: edge.targetHandle ?? '',
      d: edge.data ?? null,
    })),
  })
}

const dirty = computed(() => ready.value && signature() !== lastSignature)

function findNode(id: string): CanvasEditorNode | undefined {
  return nodes.value.find((node) => node.id === id)
}

function updateNodeData(id: string, patch: Record<string, unknown>): void {
  const node = findNode(id)
  if (!node) return
  Object.assign(node.data, patch)
}

// ---------------- 加载 ----------------

/** 旧快照缺字段的兜底：工具参数、模型参考图上限 / 能力表 */
function normalizeNodeData(node: CanvasEditorNode): void {
  const data = node.data
  if (data.kind === 'tool') {
    if (data.tool === 'crop' && !data.crop) {
      data.crop = { shape: 'rect', x: 0.1, y: 0.1, w: 0.6, h: 0.6 }
    }
    if (data.tool === 'upscale' && !data.scale) data.scale = 2
    return
  }
  if (data.kind === 'model' || data.kind === 'video') {
    if (!data.maxImageRefs) data.maxImageRefs = data.kind === 'video' ? 3 : 5
    if (!data.capabilities) {
      data.capabilities = data.kind === 'video' ? { duration: true, sound: true } : { count: true }
    }
  }
}

function migrateNodes(raw: unknown): CanvasEditorNode[] {
  if (!Array.isArray(raw)) return []
  const out: CanvasEditorNode[] = []
  for (const item of raw) {
    const node = item as Partial<CanvasEditorNode>
    if (!node || typeof node.id !== 'string' || !node.position || typeof node.type !== 'string') continue
    const types = ['text', 'image', 'video', 'model', 'tool', 'module'] as const
    if (!types.includes(node.type as (typeof types)[number])) continue
    const migrated: CanvasEditorNode = {
      id: node.id,
      type: node.type as CanvasEditorNode['type'],
      position: { x: Number(node.position.x) || 0, y: Number(node.position.y) || 0 },
      data: (node.data ?? { title: '节点' }) as CanvasEditorNodeData,
      ...(node.draggable === false ? { draggable: false } : {}),
      ...(node.selectable === false ? { selectable: false } : {}),
      ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
    }
    normalizeNodeData(migrated)
    out.push(migrated)
  }
  return out
}

function migrateEdges(raw: unknown, nodeIds: Set<string>): CanvasEditorEdge[] {
  if (!Array.isArray(raw)) return []
  const out: CanvasEditorEdge[] = []
  for (const item of raw) {
    const edge = item as Partial<CanvasEditorEdge>
    if (!edge || typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string')
      continue
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    out.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: 'canvas-bezier' as const,
      data: { color: edgeColorForHandle(edge.targetHandle), ...(edge.data?.order ? { order: edge.data.order } : {}) },
    })
  }
  return out
}

async function init(id: string): Promise<boolean> {
  const seq = ++initSeq
  canvasId = id
  loading.value = true
  loadError.value = ''
  ready.value = false
  conflictInfo.value = null
  stopAllPollers()
  productRunIds.clear()
  selectedNodeId.value = ''
  try {
    const res = await canvasGet(id)
    if (seq !== initSeq) return false
    const detail = res.data
    const nextNodes = migrateNodes(detail?.snapshot?.nodes)
    const nodeIds = new Set(nextNodes.map((node) => node.id))
    const nextEdges = migrateEdges(detail?.snapshot?.edges, nodeIds)
    // 节点先挂载（Handle 尺寸就绪）、连线下一拍再补：同步加边会被 Vue Flow 丢弃
    nodes.value = nextNodes
    title.value = detail?.title || '未命名画布'
    revision.value = detail?.revision ?? ''
    await nextTick()
    if (seq !== initSeq) return false
    edges.value = nextEdges
    lastSignature = signature()
    ready.value = true
    saveState.value = 'saved'
    saveError.value = ''
    resumePollers()
    return true
  } catch (error) {
    if (seq !== initSeq) return false
    loadError.value = error instanceof Error ? error.message : '画布加载失败'
    return false
  } finally {
    if (seq === initSeq) loading.value = false
  }
}

// ---------------- 保存（乐观锁 + 冲突处理） ----------------

const conflictInfo = ref<{ revision: string; updated_at: number } | null>(null)

function scheduleSave(): void {
  if (!ready.value || conflictInfo.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!dirty.value) return
    saveState.value = 'dirty'
    void enqueueSave()
  }, 400)
}

/** 串行化保存：同一画布一次只发一个请求，上一个没回来不发下一个（自己和自己必冲突） */
function enqueueSave(force = false): Promise<boolean> {
  const run = saveChain.catch(() => undefined).then(() => doSave(force))
  saveChain = run.catch(() => undefined)
  return run
}

/** 节点 data 第一层这些文本键不做 dataURL 检测（契约 2.4） */
const DATA_URL_EXEMPT_KEYS = new Set([
  'text',
  'prompt',
  'title',
  'subtitle',
  'maskPrompt',
  'resultText',
  'name',
  'label',
])
const FORBIDDEN_URL = /^\s*(data|blob|file):/i
const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024

function findForbiddenUrl(value: unknown): boolean {
  if (typeof value === 'string') return FORBIDDEN_URL.test(value)
  if (Array.isArray(value)) return value.some(findForbiddenUrl)
  if (value && typeof value === 'object') return Object.values(value).some(findForbiddenUrl)
  return false
}

/** 保存 / 执行前的本地预检（服务端有同口径兜底）：返回错误文案，通过返回空串 */
function checkSnapshot(snapshot: CanvasEditorSnapshot): string {
  for (const node of snapshot.nodes) {
    const { data, ...rest } = node as unknown as { data: Record<string, unknown> } & Record<string, unknown>
    const bad =
      findForbiddenUrl(rest) ||
      Object.entries(data ?? {}).some(([key, val]) => !DATA_URL_EXEMPT_KEYS.has(key) && findForbiddenUrl(val))
    if (bad) {
      const title = typeof data?.title === 'string' && data.title ? `「${data.title}」` : node.id
      return `节点 ${title} 里有未上传完成的图片或视频（data: / blob: / file: 地址），请重新上传后再保存`
    }
  }
  if (findForbiddenUrl(snapshot.edges)) return '连线数据里含有 data: / blob: / file: 地址，无法保存'
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length
  if (bytes > SNAPSHOT_MAX_BYTES) {
    return `画布内容过大（${(bytes / 1024 / 1024).toFixed(2)}MB），超过 2MB 上限，请删减节点或长文本后再保存`
  }
  return ''
}

async function doSave(force: boolean): Promise<boolean> {
  if (!canvasId || !ready.value) return false
  const seq = ++saveSeq
  const payload = buildSnapshot()
  const signatureBefore = signature()
  if (!force && signatureBefore === lastSignature) return true
  const precheck = checkSnapshot(payload)
  if (precheck) {
    saveState.value = 'error'
    saveError.value = precheck
    message.error(precheck)
    return false
  }
  saveState.value = 'saving'
  try {
    const body = force
      ? { title: title.value, snapshot: payload, force: true }
      : { title: title.value, snapshot: payload, if_match_revision: revision.value }
    const env = await canvasSaveWithLock(canvasId, body)
    if (seq !== saveSeq) return true
    if (env.code === 0 && env.data && 'revision' in env.data) {
      revision.value = env.data.revision
      lastSignature = signature()
      saveState.value = 'saved'
      saveError.value = ''
      lastSavedAt.value = Date.now()
      return true
    }
    if (env.code === 4002 && env.data && 'conflict' in env.data && env.data.conflict === 'revision') {
      conflictInfo.value = { revision: env.data.revision ?? '', updated_at: env.data.updated_at ?? 0 }
      saveState.value = 'conflict'
      showConflictDialog()
      return false
    }
    saveState.value = 'error'
    saveError.value = env.msg || '保存失败'
    message.error(saveError.value)
    return false
  } catch (error) {
    if (seq !== saveSeq) return false
    saveState.value = 'error'
    saveError.value = error instanceof Error ? error.message : '保存失败'
    message.error(saveError.value)
    return false
  }
}

function showConflictDialog(): void {
  if (conflictDialogOpen) return
  conflictDialogOpen = true
  dialog.warning({
    title: '画布已被其他窗口修改',
    content: '远端已有更新的版本。可以载入最新版本（丢弃本地未保存的改动），或用当前内容强制覆盖。',
    positiveText: '覆盖保存',
    negativeText: '载入最新版本',
    onPositiveClick: () => {
      conflictDialogOpen = false
      conflictInfo.value = null
      void enqueueSave(true).then((ok) => {
        if (ok) message.success('已覆盖保存')
      })
    },
    onClose: () => {
      conflictDialogOpen = false
      void reloadLatest()
    },
    onNegativeClick: () => {
      conflictDialogOpen = false
      void reloadLatest()
    },
  })
}

async function reloadLatest(): Promise<void> {
  const ok = await init(canvasId)
  if (ok) message.success('已载入最新版本')
}

async function flushSave(): Promise<boolean> {
  if (!dirty.value) return true
  if (conflictInfo.value) {
    message.warning('画布版本冲突待处理，请先选择「载入最新版本」或「覆盖保存」')
    return false
  }
  return enqueueSave()
}

watch([nodes, edges, title], () => scheduleSave(), { deep: true })

// ---------------- 节点 / 连线编辑 ----------------

function selectNode(id: string): void {
  selectedNodeId.value = id
}

const selectedNode = computed(() => (selectedNodeId.value ? findNode(selectedNodeId.value) : undefined))

function addNode(
  kind: 'text' | 'image' | 'video' | 'image-model' | 'video-model' | 'tool',
  tool?: CanvasToolKind,
): CanvasEditorNode | undefined {
  if (!ready.value) return undefined
  const at = spawnPosition(nodes.value)
  let created: CanvasEditorNode
  if (kind === 'text') created = makeTextNode(at)
  else if (kind === 'image') created = makeImageNode(at)
  else if (kind === 'video') created = makeVideoNode(at)
  else if (kind === 'tool') created = makeToolNode(tool ?? 'crop', at)
  else created = makeModelNode(kind === 'video-model' ? 'video' : 'image', at)
  if (created.type === 'model') applyCatalogDefaults(created)
  nodes.value.push(created)
  renumberDefaultTitles(nodes.value)
  selectedNodeId.value = created.id
  return created
}

/** 按 catalog 给新建 / 换模型的生成节点回填模型参数（取第一个 ready 的模型兜底） */
function applyCatalogDefaults(node: CanvasEditorNode): void {
  const data = node.data
  if (data.kind !== 'model' && data.kind !== 'video') return
  const isVideo = data.kind === 'video'
  const list = isVideo ? catalog.value?.video_models : catalog.value?.image_models
  const model = list?.find((item) => item.ready) ?? list?.[0]
  if (!model) return
  applyModelToNode(data, model, isVideo)
}

/** 面板换模型：回填参数并裁掉超出新参考图上限的连线 */
function changeModel(nodeId: string, model: ICanvasCatalogModel): void {
  const node = findNode(nodeId)
  const data = node?.data
  if (!node || !data || (data.kind !== 'model' && data.kind !== 'video')) return
  applyModelToNode(data, model, data.kind === 'video')
  const limit = data.maxImageRefs ?? 5
  const imageEdges = edges.value.filter((edge) => {
    if (edge.target !== nodeId) return false
    const handle = edge.targetHandle ?? ''
    return normalizeHandle(handle) === 'image' && handle !== 'image1' && handle !== 'image2'
  })
  const extra = imageEdges.slice(limit)
  if (extra.length) {
    const ids = new Set(extra.map((edge) => edge.id))
    edges.value = edges.value.filter((edge) => !ids.has(edge.id))
    message.info(`新模型最多 ${limit} 张参考图，已断开 ${extra.length} 条`)
  }
}

function connect(conn: {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}): boolean {
  if (!conn.source || !conn.target) return false
  // 提示词口语义是「新线替换旧线」：容量校验时先剔除旧 prompt 线
  const targetHandle = conn.targetHandle ?? ''
  const pool =
    normalizeHandle(targetHandle) === 'prompt'
      ? edges.value.filter((edge) => !(edge.target === conn.target && normalizeHandle(edge.targetHandle) === 'prompt'))
      : edges.value
  const check = validateConnection(nodes.value, pool, conn)
  if (!check.ok) {
    if (check.reason) message.warning(check.reason)
    return false
  }
  if (isDuplicateEdge(edges.value, conn)) return false
  if (normalizeHandle(targetHandle) === 'prompt') {
    edges.value = edges.value.filter(
      (edge) => !(edge.target === conn.target && normalizeHandle(edge.targetHandle) === 'prompt'),
    )
  }
  const siblings = edges.value.filter(
    (edge) => edge.target === conn.target && normalizeHandle(edge.targetHandle) === normalizeHandle(targetHandle),
  )
  // 旧数据没有 order：先按当前顺序补 1..n，避免新旧序号打架
  if (siblings.some((edge) => !edge.data?.order)) {
    siblings.forEach((edge, index) => {
      edge.data = { ...(edge.data ?? {}), order: index + 1 }
    })
  }
  const order =
    normalizeHandle(targetHandle) === 'prompt'
      ? undefined
      : siblings.reduce((max, edge) => Math.max(max, edge.data?.order ?? 0), 0) + 1
  edges.value.push({
    id: nextEdgeId(),
    source: conn.source,
    target: conn.target,
    sourceHandle: conn.sourceHandle ?? undefined,
    targetHandle: targetHandle || undefined,
    type: 'canvas-bezier',
    data: { color: check.color, ...(order ? { order } : {}) },
  })
  return true
}

function removeEdgeById(id: string): void {
  edges.value = edges.value.filter((edge) => edge.id !== id)
}

function removeNode(id: string): void {
  if (!findNode(id)) return
  nodes.value = nodes.value.filter((node) => node.id !== id)
  edges.value = edges.value.filter((edge) => edge.source !== id && edge.target !== id)
  if (selectedNodeId.value === id) selectedNodeId.value = ''
  renumberDefaultTitles(nodes.value)
}

// ---------------- 执行节点（幂等提交 + 轮询 + 取消） ----------------

interface IPoller {
  timer: ReturnType<typeof setTimeout> | null
  nodeId: string
  startedAt: number
  timeoutMs: number
  errors: number
}

const POLL_INTERVAL = 1200
const pollers = new Map<string, IPoller>()

const runningCount = computed(
  () => nodes.value.filter((node) => node.data.status === 'running' || node.data.status === 'queued').length,
)

function timeoutMsFor(node: CanvasEditorNode): number {
  if (node.data.kind === 'tool') return node.data.tool === 'i2p' ? 3 * 60_000 : 10 * 60_000
  return node.data.kind === 'video' ? 15 * 60_000 : 5 * 60_000
}

function runCountOf(node: CanvasEditorNode): number {
  if (node.data.kind === 'video') return 1
  const max = catalogOf(node)?.count_max ?? 4
  return Math.min(max, Math.max(1, Math.round(Number((node.data as { count?: number }).count) || 1)))
}

function catalogOf(node: CanvasEditorNode): ICanvasCatalogModel | undefined {
  const data = node.data
  if (data.kind !== 'model' && data.kind !== 'video') return undefined
  const list = data.kind === 'video' ? catalog.value?.video_models : catalog.value?.image_models
  return list?.find((item) => item.model_id === data.modelId) ?? list?.find((item) => item.model === data.model)
}

const QUALITY_MAP: Record<string, string> = { 低: 'low', 中: 'medium', 高: 'high' }

function toolParamsOf(node: CanvasEditorNode): { params?: Record<string, unknown>; error?: string } {
  const data = node.data
  switch (data.tool) {
    case 'crop': {
      const crop = data.crop ?? { shape: 'rect' as const, x: 0.1, y: 0.1, w: 0.6, h: 0.6 }
      return { params: { shape: crop.shape ?? 'rect', x: crop.x, y: crop.y, w: crop.w, h: crop.h } }
    }
    case 'upscale':
      return { params: { scale: data.scale ?? 2 } }
    case 'outpaint': {
      const w = data.outWidth
      const h = data.outHeight
      if (w || h) {
        if (!w || !h || w <= 0 || h <= 0) return { error: '扩图宽高须同时填写' }
        return { params: { width: Math.round(w), height: Math.round(h) } }
      }
      return { params: { ...(data.ratio ? { ratio: data.ratio } : {}), resolution: data.resolution || '2k' } }
    }
    case 'mask': {
      const box = data.maskBox
      if (!box || box.w <= 0 || box.h <= 0) return { error: '请先框选需要重绘的区域' }
      if (!(data.maskPrompt ?? '').trim()) return { error: '请先在参数面板填写重绘要求' }
      const { x, y, w, h } = box
      const bbox = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]
      return { params: { mask_prompt: data.maskPrompt, bbox } }
    }
    case 'i2p':
      return { params: { language: data.language ?? 'zh' } }
    case 'tryon': {
      const items = data.tryonItems?.length ? data.tryonItems : ['top']
      if (items.length > 3) return { error: '试穿单品最多选 3 件' }
      const garmentName = (data.garmentName ?? '').trim()
      const fabric = (data.fabric ?? '').trim()
      return {
        params: {
          items,
          ...(garmentName ? { garment_name: garmentName } : {}),
          ...(fabric ? { fabric } : {}),
          model: data.tryonModel || '通用',
          resolution: data.tryonResolution || '1k',
          aspect_ratio: data.tryonAspectRatio || '3:4',
        },
      }
    }
    default:
      return {}
  }
}

/** 是否已有可用提示词（连线文字 + 节点自带，任一非空即可；服务端会把两者拼接） */
function hasPromptText(node: CanvasEditorNode, refs: ICanvasRunRef[]): boolean {
  const own = (node.data.prompt ?? '').trim()
  if (own) return true
  return refs.some((ref) => normalizeHandle(ref.handle) === 'prompt' && (ref.text ?? '').trim())
}

/** 组装 run 请求体；参数缺失返回原因（契约 3.1 / 3.2） */
function buildRunRequest(node: CanvasEditorNode): { req?: ICanvasRunReq; error?: string } {
  const data = node.data
  if (data.kind === 'tool') {
    if (!data.tool) return { error: '工具节点缺少工具类型' }
    const refs = buildReferences(nodes.value, edges.value, node.id)
    if (data.tool !== 'tryon' && !refs.some((ref) => ref.handle === 'image' && ref.image)) {
      return { error: '请先连一条图片输入（或在参数面板选择上游图片）' }
    }
    const { params, error } = toolParamsOf(node)
    if (error) return { error }
    return {
      req: {
        run_id: createSafeUuid(),
        kind: 'tool',
        tool: data.tool,
        ...(params ? { params } : {}),
        references: refs,
      },
    }
  }
  if (data.kind !== 'model' && data.kind !== 'video') return { error: '该节点不需要执行' }
  if (data.inputOnly) return { error: '参考素材节点不需要执行' }
  const isVideo = data.kind === 'video'
  const model = data.model ?? ''
  const modelId = data.modelId || catalogOf(node)?.model_id || ''
  if (!model || !modelId) return { error: '请先在参数面板选择模型' }
  const refs = buildReferences(nodes.value, edges.value, node.id)
  // body.prompt 只放节点自带的提示词；连线文字走 references，服务端把两者拼成「连线文本 + 换行 + 节点提示词」
  if (!hasPromptText(node, refs)) return { error: '提示词为空：请连接文字节点或在参数面板填写提示词' }
  const req: ICanvasRunReq = {
    run_id: createSafeUuid(),
    kind: isVideo ? 'video' : 'image',
    model,
    model_id: modelId,
    prompt: (node.data.prompt ?? '').trim(),
    references: refs,
    ratio: data.ratio ?? (isVideo ? '16:9' : '1:1'),
    size: data.size ?? (isVideo ? '720p' : '1K'),
    count: runCountOf(node),
    cfg: data.cfg ?? 0.95,
  }
  const quality = QUALITY_MAP[data.quality ?? ''] ?? data.quality
  if (quality) req.quality = quality
  if (isVideo) {
    req.duration = data.duration ?? '4s'
    req.sound = data.sound ?? true
  }
  return { req }
}

/** 提交前先落地待保存改动：服务端按已保存快照核对 references（先保存、再执行） */
async function runNode(nodeId: string): Promise<void> {
  const node = findNode(nodeId)
  if (!node || !ready.value) return
  if (node.data.status === 'running' || node.data.status === 'queued') return
  if (node.data.kind === 'tool' && catalog.value?.tools?.find((t) => t.tool === node.data.tool)?.ready === false) {
    message.warning('该功能暂未开放')
    return
  }
  const { req, error } = buildRunRequest(node)
  if (!req) {
    message.warning(error ?? '参数不完整')
    return
  }
  const saved = await flushSave()
  if (!saved) return
  const runId = req.run_id
  const live = findNode(nodeId)
  if (!live) return
  live.data.runId = runId
  live.data.status = 'queued'
  live.data.errorMessage = undefined
  live.data.errorCode = undefined
  live.data.retryable = undefined
  live.data.progress = 0
  live.data.requestedCount = runCountOf(live)
  try {
    const res = await canvasNodeRun(canvasId, nodeId, req, runId)
    const data = res.data
    if (!data?.request_id) throw new Error('提交失败')
    live.data.requestId = data.request_id
    if (data.warnings?.length) message.warning(data.warnings.join('；'))
    startPolling(live)
  } catch (err) {
    const current = findNode(nodeId)
    if (!current) return
    current.data.status = 'error'
    current.data.errorMessage = err instanceof Error ? err.message : '提交失败'
  }
}

function startPolling(node: CanvasEditorNode): void {
  const requestId = node.data.requestId
  if (!requestId || pollers.has(requestId)) return
  const entry: IPoller = {
    timer: null,
    nodeId: node.id,
    startedAt: Date.now(),
    timeoutMs: timeoutMsFor(node),
    errors: 0,
  }
  pollers.set(requestId, entry)
  const tick = (): void => {
    const current = pollers.get(requestId)
    if (!current) return
    if (Date.now() - current.startedAt > current.timeoutMs) {
      stopPolling(requestId)
      message.warning('生成超时，任务可能仍在运行，可稍后刷新画布查看结果')
      return
    }
    canvasRunGet(requestId)
      .then((res) => {
        const live = pollers.get(requestId)
        if (!live) return
        live.errors = 0
        if (!applyRunResult(live.nodeId, res.data)) {
          live.timer = setTimeout(tick, POLL_INTERVAL)
        }
      })
      .catch(() => {
        const live = pollers.get(requestId)
        if (!live) return
        live.errors += 1
        if (live.errors > 2) {
          // 轮询请求失败 ≠ 任务失败：不取消，停在这里让用户稍后刷新确认
          stopPolling(requestId)
          message.error('查询执行状态失败，请稍后刷新画布查看结果')
          return
        }
        live.timer = setTimeout(tick, 800)
      })
  }
  entry.timer = setTimeout(tick, POLL_INTERVAL)
}

function stopPolling(requestId: string): void {
  const entry = pollers.get(requestId)
  if (entry?.timer) clearTimeout(entry.timer)
  pollers.delete(requestId)
}

function stopAllPollers(): void {
  for (const requestId of [...pollers.keys()]) stopPolling(requestId)
}

/** 加载后恢复轮询：节点回填的 requestId 就是最近一次 run 的服务端 run 号 */
function resumePollers(): void {
  for (const node of nodes.value) {
    if ((node.data.status === 'running' || node.data.status === 'queued') && node.data.requestId) {
      startPolling(node)
    }
  }
}

/** run 终态写回节点；返回是否终态 */
function applyRunResult(nodeId: string, run: ICanvasRunResult | undefined): boolean {
  const node = findNode(nodeId)
  if (!node) return true
  if (!run?.status) return false
  const data = node.data
  data.requestId = run.request_id || data.requestId
  data.runId = run.run_id || data.runId
  if (run.status === 'succeeded') {
    const urls = (run.candidates ?? []).map((item) => item.url)
    const selected = Math.min(Math.max(run.selected_index ?? 0, 0), Math.max(urls.length - 1, 0))
    data.candidates = urls
    data.selectedCandidate = selected
    if (data.kind === 'video') {
      // 视频 run 的 candidates[0] 是封面图
      if (run.video_url) data.video = run.video_url
      data.image = urls[selected] ?? urls[0]
    } else if (data.kind === 'model' || data.kind === 'tool') {
      data.image = urls[selected] ?? urls[0]
    }
    if (run.text && data.kind === 'tool') data.resultText = run.text
    data.status = 'done'
    data.progress = 100
    data.requestedCount = run.requested_count ?? data.requestedCount
    data.errorMessage = undefined
    data.errorCode = undefined
    data.retryable = undefined
    productRunIds.set(nodeId, run.run_id)
    stopPolling(run.request_id)
    return true
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    data.status = 'error'
    data.errorMessage = run.error || (run.status === 'cancelled' ? '已取消执行' : '执行失败')
    data.errorCode = run.error_code || undefined
    data.retryable = run.status === 'failed' && run.retryable === true
    stopPolling(run.request_id)
    return true
  }
  // submitting / queued / running / 未知状态都按未结束处理
  data.status = run.status === 'running' ? 'running' : 'queued'
  data.progress = run.progress ?? data.progress
  return false
}

async function cancelRun(nodeId: string): Promise<void> {
  const node = findNode(nodeId)
  if (!node) return
  const requestId = node.data.requestId
  if (!requestId) {
    node.data.status = 'idle'
    return
  }
  try {
    await canvasRunCancel(requestId)
  } catch {
    // 已是终态（4002）等：以轮询结果为准
  }
  if (pollers.has(requestId)) return // 轮询继续，下一拍拿终态
  try {
    const res = await canvasRunGet(requestId)
    applyRunResult(nodeId, res.data)
  } catch {
    node.data.status = 'error'
    node.data.errorMessage = '已请求取消，请稍后刷新画布确认结果'
  }
}

/** 重试：重新组装请求，run_id 每次由 buildRunRequest 现生成 UUID，绝不复用失败那次的 run_id */
function retryNode(nodeId: string): Promise<void> {
  const node = findNode(nodeId)
  if (node) {
    node.data.errorCode = undefined
    node.data.retryable = undefined
  }
  return runNode(nodeId)
}

// ---------------- 候选选择 ----------------

async function resolveProductRunId(nodeId: string): Promise<string | undefined> {
  const cached = productRunIds.get(nodeId)
  if (cached) return cached
  if (!canvasId) return undefined
  try {
    const res = await canvasRuns(canvasId, 50)
    const hit = res.data?.items?.find((item) => item.node_id === nodeId && item.status === 'succeeded')
    if (hit?.run_id) {
      productRunIds.set(nodeId, hit.run_id)
      return hit.run_id
    }
  } catch {
    // 查询失败走下面的兜底提示
  }
  return undefined
}

async function selectCandidate(nodeId: string, index: number): Promise<void> {
  const node = findNode(nodeId)
  const url = node?.data.candidates?.[index]
  if (!node || !url) return
  const runId = (await resolveProductRunId(nodeId)) ?? node.data.runId
  if (!runId) {
    message.warning('找不到该节点成功的运行记录，无法保存选择')
    return
  }
  // 先本地生效，再写回服务端（刷新后 selectedCandidate 以服务端记录为准）
  node.data.selectedCandidate = index
  const data = node.data
  const isVideoModel = data.kind === 'video'
  if (data.kind === 'model' || data.kind === 'tool') {
    if (!isVideoModel) data.image = url
  }
  try {
    const res = await canvasSelectCandidate(canvasId, nodeId, { run_id: runId, index })
    const selected = res.data?.selected_index
    if (typeof selected === 'number' && node.data.candidates?.[selected]) {
      node.data.selectedCandidate = selected
      if (!isVideoModel && (data.kind === 'model' || data.kind === 'tool')) {
        data.image = node.data.candidates[selected]
      }
    }
  } catch {
    // 拦截器已 toast；本地保持所选，刷新后以服务端为准
  }
}

// ---------------- 目录 ----------------

async function loadCatalog(): Promise<void> {
  try {
    const res = await canvasCatalog()
    catalog.value = res.data ?? null
  } catch {
    catalog.value = null
  }
}

export function useCanvasEditor() {
  return {
    // 状态
    nodes,
    edges,
    title,
    loading,
    loadError,
    ready,
    saveState,
    saveError,
    lastSavedAt,
    dirty,
    conflictInfo,
    selectedNodeId,
    selectedNode,
    runningCount,
    catalog,
    // 生命周期
    init,
    loadCatalog,
    /** 离开编辑器时停掉轮询等后台活动（服务端 run 会继续跑，重进时按 requestId 恢复轮询） */
    dispose: () => {
      stopAllPollers()
      ready.value = false
      selectedNodeId.value = ''
    },
    // 选择 / 编辑
    selectNode,
    findNode,
    updateNodeData,
    addNode,
    changeModel,
    connect,
    removeEdgeById,
    removeNode,
    // 保存
    saveNow: () => enqueueSave(),
    overwriteSave: () => enqueueSave(true),
    reloadLatest,
    flushSave,
    // 执行
    runNode,
    retryNode,
    cancelRun,
    selectCandidate,
  }
}

export type CanvasEditorStore = ReturnType<typeof useCanvasEditor>
