/**
 * 画布编辑器状态与业务（模块级单例，节点组件与面板共用）。
 *
 * <p>职责：加载 / 乐观锁保存（4002 冲突 → 拉最新快照三方合并）/ 实时同步（变更事件到达后静默载入或合并，见 merge.ts）/
 * 节点增删连线 / 单节点执行（幂等提交 + 1.2s 轮询 + 取消）/ 候选选择。快照节点 data 内部 camelCase 原样收发（契约 1.4），
 * 接口外层字段同为 camelCase（Go 网关兼容），封装在 src/api/canvas-home.ts。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { discreteConfigProviderProps } from '@/theme/naive'
import { catalogModelLabels, normalizeModelTier } from '@/utils/model-label'
import {
  canvasGet,
  canvasNodeRun,
  canvasRunCancel,
  canvasRunGet,
  canvasRunLibraryRetry,
  canvasRuns,
  canvasSaveWithLock,
  canvasSelectCandidate,
  canvasCatalog,
  type ICanvasCatalog,
  type ICanvasCatalogModel,
  type ICanvasRunReq,
  type ICanvasRunRef,
  type ICanvasRunResult,
} from '@/api/canvas-home.ts'
import { toApiError } from '@/api/index.ts'
import { canvasGetAtRevision, type ICanvasChangeEvent } from '@/api/canvas-sync.ts'
import type { ICanvasDetail } from '@/api/canvas-home.ts'
import {
  changedNodeIdsBetween,
  mergeCanvas,
  rebaseOntoRemote,
  stableStringify,
  type IMergeConflict,
  type IMergeDoc,
  type MergeSide,
} from './merge.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import {
  applyModelToNode,
  buildReferences,
  edgeColorForHandle,
  isDuplicateEdge,
  isVideoSource,
  makeImageNode,
  makeModelNode,
  makeTextNode,
  makeModuleNode,
  makeToolNode,
  makeVideoNode,
  nextEdgeId,
  nextNodeId,
  normalizeHandle,
  renumberDefaultTitles,
  spawnPosition,
  validateConnection,
} from './graph.ts'
import { remapClipboard, type ICanvasClipboard } from './clipboard.ts'
import {
  findFreeBlockShift,
  findFreeSpot,
  measuredSizeOf,
  NODE_GAP,
  obstacleRects,
  rectOfNode,
  resettleSpot,
  rightOf,
  sizeOfNode,
  type IPlacementOptions,
} from './placement.ts'
import {
  LIBRARY_PENDING_TIP,
  hasTransientMedia,
  isLibraryPending,
  normalizeLibraryStatus,
  stripLibraryStatus,
} from './library-status.ts'
import type {
  CanvasEditorEdge,
  CanvasEditorNode,
  CanvasEditorNodeData,
  CanvasEditorSnapshot,
  CanvasToolKind,
} from './types.ts'

const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  configProviderProps: discreteConfigProviderProps,
})

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

/** 节点 id → 最近一次「成功」run 的 run_id（select-candidate 必须用成功 run，内存缓存） */
const productRunIds = new Map<string, string>()
/** 节点 id → 提交结果未知（断网 / 超时 / 5xx）的那次请求：重试必须原样重发（同 run_id、同 body，契约 1.3） */
const pendingUnknownRuns = new Map<string, ICanvasRunReq>()
/** 提交在途的节点（双击 / 连点只发一次） */
const submittingNodes = new Set<string>()
/** 提交在途时用户点了停止：拿到 request_id 后立即取消 */
const cancelRequested = new Set<string>()
/** 本会话里提交时真的冻结了点数的 run（request_id → 预扣点数）：失败 / 取消时只对这些提示「将退回」 */
const chargedRuns = new Map<string, number>()
/** 估价接口返回的结算口径（模型 -> actual_cost / fixed），提交后提示「多退少补」用 */
const settleModes = new Map<string, string>()
export function rememberSettleMode(model: string, mode: string): void {
  if (model) settleModes.set(model, mode)
}
/** 批量执行中的节点：单节点的预扣 / 退回提示收进批量进度条，不逐条弹 */
const quietNodes = new Set<string>()

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
  // 产物转存素材库状态（只读，GET 回填 / 轮询写回；服务端保存时也剥离）
  'libraryStatus',
  'library_status',
])
/** 成品字段：在模型 / 工具节点上是运行态（输入节点的 image / video 是用户内容，要保留） */
const PRODUCT_KEYS = new Set(['image', 'video', 'assetId', 'resultText', 'resultImage'])

function slimData(node: CanvasEditorNode): Record<string, unknown> {
  const data = node.data as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (RUNTIME_KEYS.has(key)) continue
    // inputOnly 参考视频节点从不执行，它的 video 是用户上传的内容（服务端对没跑过的节点也保留），要计入脏检测
    if (PRODUCT_KEYS.has(key) && (node.type === 'model' || node.type === 'tool') && !node.data.inputOnly) continue
    out[key] = data[key]
  }
  return out
}

/** 节点 data 深拷贝，去掉只读的 libraryStatus（服务端也会剥，这里防御性先剥）；keepReadOnly = 撤销历史用，保留 */
function cloneDataForSave(node: CanvasEditorNode, keepReadOnly = false): CanvasEditorNodeData {
  const data = JSON.parse(JSON.stringify(node.data)) as Record<string, unknown>
  if (!keepReadOnly) stripLibraryStatus(data)
  return data as unknown as CanvasEditorNodeData
}

/**
 * 白名单序列化：Vue Flow 会往节点对象上挂内部字段，保存只取契约结构。
 * keepReadOnly：撤销历史快照保留 libraryStatus——被删节点经撤销恢复时没有 live 值可沿用，
 * 剥掉会把现签地址当成「已在素材库」放开给只认地址的入口。
 */
function buildSnapshot(keepReadOnly = false): CanvasEditorSnapshot {
  return {
    nodes: nodes.value.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: cloneDataForSave(node, keepReadOnly),
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
  return signatureOf(title.value, nodes.value, edges.value)
}

function signatureOf(docTitle: string, docNodes: CanvasEditorNode[], docEdges: CanvasEditorEdge[]): string {
  return JSON.stringify({
    title: docTitle,
    nodes: docNodes.map((node) => ({ id: node.id, type: node.type, p: node.position, d: slimData(node) })),
    edges: docEdges.map((edge) => ({
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

// ---------------- 撤销 / 重做（对齐原型 useCanvasStore history：past / future 两栈，上限 60） ----------------

/** 原型 pushHistory 的栈上限 */
const HISTORY_LIMIT = 60
/** 连续输入 / 拖拽合并成一步的静默时长 */
const HISTORY_SETTLE_MS = 400

interface IHistoryEntry {
  snapshot: CanvasEditorSnapshot
  signature: string
}

const historyPast = ref<IHistoryEntry[]>([])
const historyFuture = ref<IHistoryEntry[]>([])
/** 最近一次「稳定」的内容：下一次用户改动落定时把它压入 past */
let historyBase: IHistoryEntry | null = null
let historyTimer: ReturnType<typeof setTimeout> | null = null
/** 有尚未落定的用户改动（静默期内）：撤销按钮也应可点，点击时先落定再撤销 */
const historyPending = ref(false)
/** 撤销 / 重做回填中（节点、连线分两拍写入）：期间的变化不记历史 */
let historyRestoring = false

/** 用户内容签名：与脏检测同口径排除运行态 / 成品字段（轮询、执行、自动保存都不产生历史），标题不进历史（原型撤销不回退标题） */
function contentSignatureOf(nodeList: CanvasEditorNode[], edgeList: CanvasEditorEdge[]): string {
  return JSON.stringify({
    nodes: nodeList.map((node) => ({ id: node.id, type: node.type, p: node.position, d: slimData(node) })),
    edges: edgeList.map((edge) => ({
      id: edge.id,
      s: edge.source,
      t: edge.target,
      sh: edge.sourceHandle ?? '',
      th: edge.targetHandle ?? '',
      d: edge.data ?? null,
    })),
  })
}

function contentSignature(): string {
  return contentSignatureOf(nodes.value, edges.value)
}

function captureHistory(): IHistoryEntry {
  return { snapshot: buildSnapshot(true), signature: contentSignature() }
}

function clearHistoryTimer(): void {
  historyPending.value = false
  if (historyTimer) {
    clearTimeout(historyTimer)
    historyTimer = null
  }
}

/** 清空两栈并以当前内容为基线（加载 / 切换画布时调用；ready 为假时只清空） */
function resetHistory(): void {
  clearHistoryTimer()
  historyPast.value = []
  historyFuture.value = []
  historyBase = ready.value ? captureHistory() : null
}

/**
 * 远端变更落地后改基撤销栈（取代清空）：远端改动是不可撤销的基线，
 * past / future 里每个旧快照都叠上 pre → post 的远端变化，撤销只回退本地操作（见 merge.ts rebaseOntoRemote）。
 */
function rebaseHistory(pre: IMergeDoc, post: IMergeDoc): void {
  clearHistoryTimer()
  const rebase = (entry: IHistoryEntry): IHistoryEntry => {
    const doc = rebaseOntoRemote(
      pre,
      post,
      { title: '', nodes: entry.snapshot.nodes, edges: entry.snapshot.edges },
      isRuntimeKeyOf,
    )
    return {
      snapshot: { nodes: doc.nodes, edges: doc.edges },
      signature: contentSignatureOf(doc.nodes, doc.edges),
    }
  }
  const past = historyPast.value.map(rebase)
  const future = historyFuture.value.map(rebase)
  // 改基后与新基线内容一致的相邻快照（只改了被远端覆盖的字段）合并掉，避免出现「撤销没反应」的空步
  const base = ready.value ? captureHistory() : null
  const dedup: IHistoryEntry[] = []
  for (const entry of past) {
    if (dedup.length && dedup[dedup.length - 1]!.signature === entry.signature) continue
    dedup.push(entry)
  }
  while (base && dedup.length && dedup[dedup.length - 1]!.signature === base.signature) dedup.pop()
  historyPast.value = dedup
  historyFuture.value = future.filter((entry) => !base || entry.signature !== base.signature)
  historyBase = base
}

/** 把待落定的用户改动记为一步：基线压入 past，清空 future */
function commitHistory(): void {
  clearHistoryTimer()
  if (!historyBase || historyRestoring || !ready.value) return
  const current = captureHistory()
  if (current.signature === historyBase.signature) return
  historyPast.value.push(historyBase)
  if (historyPast.value.length > HISTORY_LIMIT) historyPast.value.shift()
  historyFuture.value = []
  historyBase = current
}

const historySignature = computed(() => (ready.value ? contentSignature() : ''))

watch(historySignature, (sig) => {
  if (!sig || historyRestoring || !historyBase) return
  clearHistoryTimer()
  historyPending.value = sig !== historyBase.signature
  historyTimer = setTimeout(commitHistory, HISTORY_SETTLE_MS)
})

/** 回填历史快照：节点上的运行态 / 成品沿用当前值（不打断轮询、不回退执行结果），节点先挂载、连线下一拍再补 */
async function restoreHistory(entry: IHistoryEntry): Promise<void> {
  historyRestoring = true
  const targetId = canvasId
  try {
    const live = new Map(nodes.value.map((node) => [node.id, node]))
    const snap = JSON.parse(JSON.stringify(entry.snapshot)) as CanvasEditorSnapshot
    const restored = snap.nodes.map((node) => {
      const current = live.get(node.id)
      if (current) {
        const from = current.data as unknown as Record<string, unknown>
        const to = node.data as unknown as Record<string, unknown>
        const keepProduct = (node.type === 'model' || node.type === 'tool') && !node.data.inputOnly
        for (const key of [...RUNTIME_KEYS, ...(keepProduct ? PRODUCT_KEYS : [])]) {
          if (from[key] === undefined) delete to[key]
          else to[key] = JSON.parse(JSON.stringify(from[key]))
        }
      }
      return node as CanvasEditorNode
    })
    nodes.value = restored
    await nextTick()
    if (targetId !== canvasId) return
    edges.value = snap.edges as CanvasEditorEdge[]
    if (selectedNodeId.value && !findNode(selectedNodeId.value)) selectedNodeId.value = ''
    await nextTick()
    if (targetId !== canvasId) return
    resumePollers()
    // 撤销恢复了被删的转存中节点：接着跟转存状态（已在跟的节点不会重复起）
    resumeLibraryWatches()
  } finally {
    historyRestoring = false
    if (targetId === canvasId && ready.value) historyBase = captureHistory()
  }
}

let historyBusy = false

async function undo(): Promise<boolean> {
  if (!ready.value || historyBusy) return false
  commitHistory()
  const previous = historyPast.value.pop()
  if (!previous || !historyBase) return false
  historyBusy = true
  try {
    historyFuture.value.push(historyBase)
    await restoreHistory(previous)
    return true
  } finally {
    historyBusy = false
  }
}

async function redo(): Promise<boolean> {
  if (!ready.value || historyBusy) return false
  commitHistory()
  const next = historyFuture.value.pop()
  if (!next || !historyBase) return false
  historyBusy = true
  try {
    historyPast.value.push(historyBase)
    if (historyPast.value.length > HISTORY_LIMIT) historyPast.value.shift()
    await restoreHistory(next)
    return true
  } finally {
    historyBusy = false
  }
}

const canUndo = computed(() => historyPast.value.length > 0 || historyPending.value)
const canRedo = computed(() => historyFuture.value.length > 0)

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
  // 转存素材库状态：只认 pending / failed（兼容下划线写法），其余按「已在素材库」去掉
  const raw = data as unknown as Record<string, unknown>
  const libraryStatus = normalizeLibraryStatus(raw.libraryStatus ?? raw.library_status)
  stripLibraryStatus(raw)
  if (libraryStatus) data.libraryStatus = libraryStatus
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

/** 快照节点 → 编辑器节点（加载画布与「从模板插入」templateInsert.ts 共用） */
export function migrateNodes(raw: unknown): CanvasEditorNode[] {
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
      ...(node.draggable === false || (node.data as CanvasEditorNodeData | undefined)?.locked
        ? { draggable: false }
        : {}),
      ...(node.selectable === false ? { selectable: false } : {}),
      ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
    }
    normalizeNodeData(migrated)
    out.push(migrated)
  }
  return out
}

export function migrateEdges(raw: unknown, nodeIds: Set<string>): CanvasEditorEdge[] {
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
  mergePending.value = null
  baseDoc = null
  ownRevisions.length = 0
  pendingHints.length = 0
  conflictStreak = 0
  // 作废在途保存的回包与待发的防抖保存（它们属于上一份内存状态）
  saveSeq += 1
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  stopAllPollers()
  stopAllLibraryWatches()
  productRunIds.clear()
  productRequestIds.clear()
  mediaFetchedAt.clear()
  mediaRefreshLog.clear()
  pendingUnknownRuns.clear()
  submittingNodes.clear()
  cancelRequested.clear()
  chargedRuns.clear()
  quietNodes.clear()
  selectedNodeId.value = ''
  resetHistory()
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
    rememberBase(revision.value, currentDoc())
    reconcileCatalogLimits()
    resetHistory()
    resumePollers()
    // 回填的现签地址此刻刚签出：记下取到的时间（提交前判断是否要先换新签名）；转存中的节点低频跟到状态变空
    const loadedAt = Date.now()
    for (const node of nextNodes) if (signedProductOf(node)) mediaFetchedAt.set(node.id, loadedAt)
    resumeLibraryWatches()
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

function scheduleSave(): void {
  if (!ready.value || mergePending.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!dirty.value) return
    saveState.value = 'dirty'
    void enqueueSave()
  }, 400)
}

/** 串行化保存：同一画布一次只发一个请求，上一个没回来不发下一个（自己和自己必冲突）；远端同步也排在同一条链上 */
function enqueueSave(): Promise<boolean> {
  const run = saveChain.catch(() => undefined).then(() => doSave())
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

async function doSave(): Promise<boolean> {
  // 合并冲突待用户选择：不能拿未合并的内容去保存
  if (!canvasId || !ready.value || mergePending.value) return false
  const seq = ++saveSeq
  const targetId = canvasId
  const payload = buildSnapshot()
  const titleBefore = title.value
  const signatureBefore = signature()
  if (signatureBefore === lastSignature) return true
  const precheck = checkSnapshot(payload)
  if (precheck) {
    saveState.value = 'error'
    saveError.value = precheck
    message.error(precheck)
    return false
  }
  saveState.value = 'saving'
  try {
    // 永远带乐观锁：没有「强制覆盖」——别人（画布助手 / 其他窗口）的修改只能经三方合并取舍，不能被整段盖掉
    const body = { title: titleBefore, snapshot: payload, ifMatchRevision: revision.value }
    const env = await canvasSaveWithLock(targetId, body)
    // 期间切换 / 重载了画布：这次回包的 revision 不属于当前画布，不能写进来
    if (seq !== saveSeq || targetId !== canvasId) return false
    if (env.code === 0 && env.data && 'revision' in env.data) {
      revision.value = env.data.revision
      rememberOwnRevision(env.data.revision)
      rememberBase(env.data.revision, { title: titleBefore, nodes: payload.nodes, edges: payload.edges })
      conflictStreak = 0
      // 只把「发出去的那份」记为已保存：请求在途时的新改动仍是脏的，会被下一次保存带上
      lastSignature = signatureBefore
      saveState.value = 'saved'
      saveError.value = ''
      lastSavedAt.value = Date.now()
      return true
    }
    if (env.code === 4002 && env.data && 'conflict' in env.data && env.data.conflict === 'revision') {
      // 服务端已有更新的版本：拉最新快照做三方合并（无冲突自动合并后再保存，有冲突弹窗逐个选）
      conflictStreak += 1
      if (conflictStreak > 3) {
        saveState.value = 'error'
        saveError.value = '画布一直在被修改，暂时无法保存，请稍后再试或刷新页面'
        message.error(saveError.value)
        return false
      }
      saveState.value = 'conflict'
      requestSync({ source: 'user', revision: '', force: true })
      return false
    }
    saveState.value = 'error'
    saveError.value = env.msg || '保存失败'
    message.error(saveError.value)
    return false
  } catch (error) {
    if (seq !== saveSeq || targetId !== canvasId) return false
    saveState.value = 'error'
    saveError.value = error instanceof Error ? error.message : '保存失败'
    // 业务失败拦截器已 toast，这里只补传输层失败（超时 / 断网）的提示
    if ((toApiError(error)?.code ?? -1) === -1) message.error(saveError.value)
    return false
  }
}

async function reloadLatest(): Promise<void> {
  const ok = await init(canvasId)
  if (ok) message.success('已载入最新版本')
}

async function flushSave(): Promise<boolean> {
  if (!dirty.value) return true
  if (mergePending.value) {
    message.warning('画布有待处理的合并冲突，请先在弹窗里逐项选择')
    return false
  }
  return enqueueSave()
}

// ---------------- 实时同步：变更事件 → 静默载入 / 三方合并 ----------------

/** 本地编辑起点：最近一次载入 / 保存成功时的服务端内容（三方合并的 base） */
let baseDoc: { revision: string; doc: IMergeDoc } | null = null
/** 自己保存产生的 revision（事件回来时据此认出「是我这次保存」，最多记 20 个） */
const ownRevisions: string[] = []
/** 尚未处理的事件提示（合并成一次拉取） */
const pendingHints: (Partial<ICanvasChangeEvent> & { force?: boolean })[] = []
let syncQueued = false
/** 连续保存冲突次数（防止服务端异常时无限「冲突 → 合并 → 冲突」） */
let conflictStreak = 0

export interface ICanvasMergePending {
  conflicts: IMergeConflict[]
  base: IMergeDoc | null
  ours: IMergeDoc
  theirs: IMergeDoc
  theirsRevision: string
  source: string
}

/** 待用户逐项选择的合并冲突（弹窗读它）；非空期间暂停保存 */
const mergePending = ref<ICanvasMergePending | null>(null)
/** 远端改动的节点：高亮 2 秒（seq 变化即重新触发） */
const remoteHighlight = ref<{ ids: string[]; seq: number }>({ ids: [], seq: 0 })
/** 远端改动提示条 */
const remoteNotice = ref<{ text: string; seq: number } | null>(null)
let remoteSeq = 0

function isRuntimeKeyOf(node: CanvasEditorNode, key: string): boolean {
  if (RUNTIME_KEYS.has(key)) return true
  return PRODUCT_KEYS.has(key) && (node.type === 'model' || node.type === 'tool') && !node.data?.inputOnly
}

function currentDoc(): IMergeDoc {
  const snap = buildSnapshot()
  return { title: title.value, nodes: snap.nodes, edges: snap.edges }
}

function detailToDoc(detail: ICanvasDetail): IMergeDoc {
  const docNodes = migrateNodes(detail?.snapshot?.nodes)
  const docEdges = migrateEdges(detail?.snapshot?.edges, new Set(docNodes.map((node) => node.id)))
  return { title: detail?.title || '未命名画布', nodes: docNodes, edges: docEdges }
}

function rememberBase(rev: string, doc: IMergeDoc): void {
  baseDoc = { revision: rev, doc: JSON.parse(JSON.stringify(doc)) as IMergeDoc }
}

function rememberOwnRevision(rev: string): void {
  if (!rev) return
  ownRevisions.push(rev)
  if (ownRevisions.length > 20) ownRevisions.shift()
}

/** 内容等价键（排除运行态、键序无关）：合并结果与远端相同就不必再保存一次 */
function docKey(doc: IMergeDoc): string {
  return stableStringify({
    title: doc.title,
    nodes: doc.nodes.map((node) => ({ id: node.id, type: node.type, p: node.position, d: slimData(node) })),
    edges: doc.edges.map((edge) => ({
      id: edge.id,
      s: edge.source,
      t: edge.target,
      sh: edge.sourceHandle ?? '',
      th: edge.targetHandle ?? '',
    })),
  })
}

function sourceLabel(source: string): string {
  if (source === 'agent') return '画布助手'
  if (source === 'run') return '生成任务'
  if (source === 'unknown') return '服务端'
  return '其他窗口'
}

/** 画布助手写类工具回的 changedNodeIds：只高亮、不提示（提示条由变更事件给） */
function flashNodes(ids: string[]): void {
  const live = ids.filter((id) => findNode(id))
  if (!live.length) return
  remoteSeq += 1
  remoteHighlight.value = { ids: live, seq: remoteSeq }
}

function announceRemote(source: string, ids: string[], merged: boolean): void {
  remoteSeq += 1
  if (source !== 'run' && ids.length) remoteHighlight.value = { ids: [...ids], seq: remoteSeq }
  // 生成任务回写产物是常态，不打扰；其余给一条提示
  if (source === 'run' && !merged) return
  const who = sourceLabel(source)
  const count = ids.length
  let text: string
  if (merged)
    text = count ? `已自动合并${who}对 ${count} 个节点的修改，你的改动已保留` : `已自动合并${who}的修改，你的改动已保留`
  else if (source === 'agent') text = count ? `画布助手修改了 ${count} 个节点` : '画布助手更新了画布'
  else text = count ? `画布已在${who}更新（${count} 个节点）` : `画布已在${who}更新`
  remoteNotice.value = { text, seq: remoteSeq }
}

/**
 * 收到一条 revision 变化（SSE 事件或轮询发现）：不是自己保存产生的就排进保存链拉最新。
 * 与保存同链串行：在途保存回来后再判断，保存本身产生的事件因此会被认出来跳过。
 */
function handleRemoteEvent(event: ICanvasChangeEvent): void {
  if (!ready.value || !canvasId) return
  if (event.canvasId && event.canvasId !== canvasId) return
  if (event.revision && (event.revision === revision.value || ownRevisions.includes(event.revision))) return
  requestSync(event)
}

function requestSync(hint?: Partial<ICanvasChangeEvent> & { force?: boolean }): void {
  if (hint) pendingHints.push(hint)
  if (syncQueued) return
  syncQueued = true
  const run = saveChain
    .catch(() => undefined)
    .then(async () => {
      syncQueued = false
      await syncFromServer()
    })
  saveChain = run.catch(() => undefined)
}

/** 三方合并的 base：内存里的编辑起点；对不上（极少）再按 revision 取历史快照，取不到退化为无 base */
async function resolveBase(targetId: string): Promise<IMergeDoc | null> {
  if (baseDoc && baseDoc.revision === revision.value) return baseDoc.doc
  if (!revision.value) return null
  try {
    return detailToDoc(await canvasGetAtRevision(targetId, revision.value))
  } catch {
    return null
  }
}

async function syncFromServer(): Promise<void> {
  if (!canvasId || !ready.value) return
  const hints = pendingHints.splice(0)
  // 全是自己保存 / 已知的 revision：不用拉
  const meaningful = hints.filter(
    (hint) =>
      hint.force || !hint.revision || (hint.revision !== revision.value && !ownRevisions.includes(hint.revision)),
  )
  if (hints.length && !meaningful.length) return
  const targetId = canvasId
  const seq = initSeq
  let detail: ICanvasDetail | undefined
  try {
    detail = (await canvasGet(targetId)).data
  } catch {
    if (saveState.value === 'conflict' && !mergePending.value) saveState.value = 'error'
    return
  }
  if (seq !== initSeq || targetId !== canvasId || !ready.value || !detail) return
  if (detail.revision === revision.value) {
    if (saveState.value === 'conflict' && !mergePending.value) saveState.value = dirty.value ? 'dirty' : 'saved'
    return
  }
  const theirs = detailToDoc(detail)
  const source = meaningful.some((hint) => hint.source === 'agent')
    ? 'agent'
    : (meaningful.find((hint) => hint.source)?.source ?? 'user')
  const hinted = [...new Set(meaningful.flatMap((hint) => hint.changedNodeIds ?? []))]

  // 冲突弹窗开着时又来了更新：换成最新的对方内容，选择时按它合并
  if (mergePending.value) {
    const result = mergeCanvas(mergePending.value.base, currentDoc(), theirs, { isRuntimeKey: isRuntimeKeyOf })
    mergePending.value = { ...mergePending.value, theirs, theirsRevision: detail.revision, conflicts: result.conflicts }
    return
  }

  if (!dirty.value) {
    const before = currentDoc()
    await applyDoc(theirs, theirs, detail.revision)
    if (seq !== initSeq || targetId !== canvasId) return
    const changed = hinted.length
      ? hinted.filter((id) => findNode(id))
      : changedNodeIdsBetween(before, theirs, isRuntimeKeyOf)
    announceRemote(source, changed, false)
    saveState.value = 'saved'
    return
  }

  const base = await resolveBase(targetId)
  if (seq !== initSeq || targetId !== canvasId || !ready.value) return
  const result = mergeCanvas(base, currentDoc(), theirs, { isRuntimeKey: isRuntimeKeyOf })
  if (!result.conflicts.length) {
    await applyDoc(result.doc, theirs, detail.revision)
    if (seq !== initSeq || targetId !== canvasId) return
    announceRemote(source, result.theirsNodeIds, true)
    saveState.value = dirty.value ? 'dirty' : 'saved'
    scheduleSave()
    return
  }
  mergePending.value = {
    conflicts: result.conflicts,
    base,
    ours: currentDoc(),
    theirs,
    theirsRevision: detail.revision,
    source,
  }
  saveState.value = 'conflict'
}

/**
 * 把一份内容写回编辑器（远端静默载入 / 合并结果），revision 前进到 theirs：
 * 已有节点原地更新（保住 Vue Flow 的选中态与测量尺寸、不动视口），连线下一拍再补；
 * 结果与 theirs 等价就记为已保存，否则留脏交给自动保存（带新 revision 的乐观锁）。
 */
async function applyDoc(doc: IMergeDoc, theirs: IMergeDoc, rev: string): Promise<void> {
  const targetId = canvasId
  // 静默期内还没落定的本地改动先记成一步，再叠远端：撤销栈保留，改基到新内容上
  commitHistory()
  const preDoc = currentDoc()
  historyRestoring = true
  try {
    const copy = JSON.parse(JSON.stringify(doc)) as IMergeDoc
    const live = new Map(nodes.value.map((node) => [node.id, node]))
    const next = copy.nodes.map((node) => {
      const current = live.get(node.id)
      if (!current || current.type !== node.type) return node
      if (current.position.x !== node.position.x || current.position.y !== node.position.y)
        current.position = node.position
      current.data = node.data
      for (const key of ['draggable', 'selectable', 'zIndex'] as const) {
        const value = (node as unknown as Record<string, unknown>)[key]
        const target = current as unknown as Record<string, unknown>
        if (value === undefined) delete target[key]
        else target[key] = value
      }
      return current
    })
    nodes.value = next
    title.value = copy.title
    await nextTick()
    if (targetId !== canvasId) return
    edges.value = copy.edges
    revision.value = rev
    rememberBase(rev, theirs)
    lastSignature = docKey(copy) === docKey(theirs) ? signature() : `remote:${rev}`
    if (selectedNodeId.value && !findNode(selectedNodeId.value)) selectedNodeId.value = ''
    await nextTick()
    if (targetId !== canvasId) return
    resumePollers()
    resumeLibraryWatches()
  } finally {
    historyRestoring = false
    // 远端改动是不可撤销的基线：撤销栈不清空，旧快照改基到新内容上，撤销只回退自己的操作，
    // 不会把画布助手 / 其他窗口刚改的内容当成「上一步」撤掉
    if (targetId === canvasId && ready.value) rebaseHistory(preDoc, currentDoc())
  }
}

/** 冲突弹窗确认：按选择（缺省保留我的）与当前本地内容重新合并后写回，再走自动保存 */
function resolveMerge(choices: Record<string, MergeSide>): Promise<void> {
  const run = saveChain
    .catch(() => undefined)
    .then(async () => {
      const pending = mergePending.value
      if (!pending || !ready.value) return
      const result = mergeCanvas(pending.base, currentDoc(), pending.theirs, { isRuntimeKey: isRuntimeKeyOf, choices })
      mergePending.value = null
      await applyDoc(result.doc, pending.theirs, pending.theirsRevision)
      announceRemote(pending.source, result.theirsNodeIds, true)
      saveState.value = dirty.value ? 'dirty' : 'saved'
      scheduleSave()
    })
  saveChain = run.catch(() => undefined)
  return run
}

/** 冲突弹窗「放弃我的修改」：丢掉本地未保存内容，载入最新版本 */
async function discardLocalChanges(): Promise<void> {
  mergePending.value = null
  await reloadLatest()
}

watch([nodes, edges, title], () => scheduleSave(), { deep: true })

// ---------------- 节点 / 连线编辑 ----------------

function selectNode(id: string): void {
  selectedNodeId.value = id
}

const selectedNode = computed(() => (selectedNodeId.value ? findNode(selectedNodeId.value) : undefined))

/**
 * 新节点落点登记：节点按估计尺寸落点，首次渲染量出真实尺寸后（常比估计高）复核一次，
 * 仍与别的节点重叠就只挪这一个节点；用户拖过 / 位置被改过就不再动。
 */
const settling = new Map<string, { x: number; y: number; flow: IPlacementOptions; tries: number }>()
let settleTimer: ReturnType<typeof setTimeout> | null = null
const SETTLE_INTERVAL_MS = 120
const SETTLE_MAX_TRIES = 25

/** 用户拖动 / 手动改了位置：放弃自动复核 */
function releasePlacement(id: string): void {
  settling.delete(id)
}

function scheduleSettle(): void {
  if (settleTimer || !settling.size) return
  settleTimer = setTimeout(() => {
    settleTimer = null
    runSettle()
  }, SETTLE_INTERVAL_MS)
}

function runSettle(): void {
  for (const [id, entry] of [...settling]) {
    const node = findNode(id)
    if (!node || node.position.x !== entry.x || node.position.y !== entry.y) {
      settling.delete(id)
      continue
    }
    const measured = measuredSizeOf(node)
    if (!measured) {
      entry.tries += 1
      if (entry.tries > SETTLE_MAX_TRIES) settling.delete(id)
      continue
    }
    settling.delete(id)
    const others = obstacleRects(nodes.value, new Set([id]))
    const spot = resettleSpot(node.position, measured, others, entry.flow)
    if (!spot) continue
    node.position = spot
    // 位置修正并入「创建」这一步：基线已落定时直接吸收，避免多出一个撤销步
    if (!historyPending.value && historyBase && !historyRestoring) historyBase = captureHistory()
  }
  scheduleSettle()
}

/** 登记并启动复核 */
function trackPlacement(node: CanvasEditorNode, flow: IPlacementOptions): void {
  if (node.type === 'module') return
  settling.set(node.id, { x: node.position.x, y: node.position.y, flow, tries: 0 })
  scheduleSettle()
}

/**
 * 新建节点（所有入口的唯一落点：按期望点找空位，不与已有节点重叠且间距 ≥ NODE_GAP）
 * @param position 期望落点（添加面板：双击画布 / 端口「+」的位置 / 拖放点 / 来源节点右侧）；不传沿用 spawnPosition 再找空位
 * @param placement 搜索策略：指定落点默认 spiral（取最近空位），不指定落点默认 right-first
 */
function addNode(
  kind: 'text' | 'image' | 'video' | 'image-model' | 'video-model' | 'tool',
  tool?: CanvasToolKind,
  position?: { x: number; y: number },
  placement?: IPlacementOptions,
): CanvasEditorNode | undefined {
  if (!ready.value) return undefined
  const at = position ? { x: Math.round(position.x), y: Math.round(position.y) } : spawnPosition(nodes.value)
  let created: CanvasEditorNode
  if (kind === 'text') created = makeTextNode(at)
  else if (kind === 'image') created = makeImageNode(at)
  else if (kind === 'video') created = makeVideoNode(at)
  else if (kind === 'tool') created = makeToolNode(tool ?? 'crop', at)
  else created = makeModelNode(kind === 'video-model' ? 'video' : 'image', at)
  if (created.type === 'model') applyCatalogDefaults(created)
  const flow: IPlacementOptions = { flow: position ? 'spiral' : 'right-first', ...placement }
  created.position = findFreeSpot(at, sizeOfNode(created), obstacleRects(nodes.value), flow)
  nodes.value.push(created)
  renumberDefaultTitles(nodes.value)
  selectedNodeId.value = created.id
  trackPlacement(created, flow)
  return created
}

/** 按 catalog 给新建 / 换模型的生成节点回填模型参数（取第一个 ready 的模型兜底） */
function applyCatalogDefaults(node: CanvasEditorNode): void {
  const data = node.data
  if (data.kind !== 'model' && data.kind !== 'video') return
  const isVideo = data.kind === 'video'
  const list = isVideo ? catalog.value?.video_models : catalog.value?.imageModels
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
  // 提示词口 / 服装口语义是「新线替换旧线」：容量校验时先剔除旧线，校验通过后再移除
  const targetHandle = conn.targetHandle ?? ''
  const normalized = normalizeHandle(targetHandle)
  const replaceSingle = normalized === 'prompt' || normalized === 'garment'
  const isOld = (edge: { target: string; targetHandle?: string | null }) =>
    edge.target === conn.target && normalizeHandle(edge.targetHandle) === normalized
  const pool = replaceSingle ? edges.value.filter((edge) => !isOld(edge)) : edges.value
  const check = validateConnection(nodes.value, pool, conn)
  if (!check.ok) {
    if (check.reason) message.warning(check.reason)
    return false
  }
  if (isDuplicateEdge(edges.value, conn)) return false
  if (replaceSingle) edges.value = edges.value.filter((edge) => !isOld(edge))
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

/** 批量删除（多选操作条 / 模块删除）：节点与相连连线一次性移除，撤销时作为一步回退 */
function removeNodes(ids: string[]): number {
  const drop = new Set(ids.filter((id) => findNode(id)))
  if (!drop.size) return 0
  nodes.value = nodes.value.filter((node) => !drop.has(node.id))
  edges.value = edges.value.filter((edge) => !drop.has(edge.source) && !drop.has(edge.target))
  if (drop.has(selectedNodeId.value)) selectedNodeId.value = ''
  renumberDefaultTitles(nodes.value)
  return drop.size
}

/** 模块底板的范围内节点（左上角落在底板矩形里即算模块内；模块本身不算） */
function moduleChildren(moduleId: string): CanvasEditorNode[] {
  const module = findNode(moduleId)
  if (!module || module.type !== 'module') return []
  const { x, y } = module.position
  const w = module.data.width ?? 760
  const h = module.data.height ?? 520
  return nodes.value.filter(
    (node) =>
      node.id !== moduleId &&
      node.type !== 'module' &&
      node.position.x >= x &&
      node.position.x <= x + w &&
      node.position.y >= y &&
      node.position.y <= y + h,
  )
}

/** 删除模块：底板与其范围内的节点（含相连连线）一起移除 */
function removeModule(moduleId: string): number {
  if (findNode(moduleId)?.type !== 'module') return 0
  return removeNodes([moduleId, ...moduleChildren(moduleId).map((node) => node.id)])
}

/**
 * 锁定 / 解锁（2026-11-06 二轮）：锁后拖不动（draggable=false）且不可删除，仍可选中 / 解锁；
 * 锁定标记存 data.locked（随快照持久化），拖动分组底板时锁定成员照样跟着走（成员是被程序挪的）。
 */
function toggleLock(id: string): boolean {
  const node = findNode(id)
  if (!node) return false
  const locked = !node.data.locked
  updateNodeData(id, { locked })
  node.draggable = !locked
  return locked
}

/** 批量设锁（多选：有未锁的就全锁，全锁了才全解） */
function setLocked(ids: string[], locked: boolean): number {
  let count = 0
  for (const id of ids) {
    const node = findNode(id)
    if (!node) continue
    updateNodeData(id, { locked })
    node.draggable = !locked
    count += 1
  }
  return count
}

/** 节点是否锁定（锁定成员不可单独拖动；分组拖动不受影响） */
function isLocked(id: string): boolean {
  return !!findNode(id)?.data.locked
}

/**
 * 成组（2026-11-06 二轮）：把选中的节点框进一块虚线底板（原型 group plate）。
 * 底板是几何分组——左上角落在板内的节点算成员（moduleChildren 同一口径），拖底板带成员走。
 */
function createModule(ids: string[]): string | null {
  const members = ids
    .map((id) => findNode(id))
    .filter((node): node is CanvasEditorNode => Boolean(node && node.type !== 'module'))
  if (!members.length) return null
  const minX = Math.min(...members.map((node) => node.position.x)) - 24
  const minY = Math.min(...members.map((node) => node.position.y)) - 24
  // 节点尺寸：Vue Flow 运行时挂在 dimensions 上（类型里没有，读不到时按 data 或常见尺寸兜底）
  const sizeOf = (node: CanvasEditorNode) => {
    const dims = (node as unknown as { dimensions?: { width?: number; height?: number } }).dimensions
    return { w: dims?.width ?? node.data.width ?? 260, h: dims?.height ?? node.data.height ?? 160 }
  }
  const maxX = Math.max(...members.map((node) => node.position.x + sizeOf(node).w)) + 24
  const maxY = Math.max(...members.map((node) => node.position.y + sizeOf(node).h)) + 24
  const created = makeModuleNode(
    { x: Math.round(minX), y: Math.round(minY) },
    { width: Math.round(Math.max(240, maxX - minX)), height: Math.round(Math.max(160, maxY - minY)) },
  )
  // 底板排在成员前面（DOM 顺序在下），配合 zIndex -1 不盖住成员
  nodes.value = [created, ...nodes.value]
  return created.id
}

/** 解组：只拆底板，成员原位保留（与 removeModule 的「连成员一起删」相对） */
function ungroup(moduleId: string): boolean {
  if (findNode(moduleId)?.type !== 'module') return false
  return removeNodes([moduleId]) > 0
}

/** 删除分组（含成员）：右键菜单「删除分组（含成员）」用；底板角钮只解组 / 只删底板，不再连成员一起删 */
function deleteGroupWithMembers(moduleId: string): number {
  return removeModule(moduleId)
}

/** 来源节点右侧的期望落点；addNode 配 down-first：同一来源连续加时在右侧一列往下排开，列满换右边一列 */
function spotRightOf(source: CanvasEditorNode): { x: number; y: number } {
  return rightOf(source, NODE_GAP)
}
const DOWNSTREAM_FLOW: IPlacementOptions = { flow: 'down-first' }

/** 节点的输出口 id（与各节点组件里 source Handle 的 id 一致） */
function outputHandleOf(node: CanvasEditorNode): string {
  if (node.type === 'text') return 'text'
  if (node.type === 'video') return 'video'
  if (node.type === 'image') return 'image'
  if (node.type === 'tool') return node.data.tool === 'i2p' ? 'text' : 'image-out'
  return node.data.inputOnly ? 'video' : 'image-out'
}

/**
 * 从图片类节点新建一个下游工具节点并自动连线（图片节点悬浮条「裁剪 / 高清放大」用；右键菜单也可复用）。
 * 试穿工具接 garment 口，其余接 image 口；连线校验不过（来源不是图片类）时节点照建、只是不连。
 */
function addConnectedToolNode(sourceId: string, tool: CanvasToolKind): CanvasEditorNode | undefined {
  const source = findNode(sourceId)
  if (!source || !ready.value) return undefined
  const created = addNode('tool', tool, spotRightOf(source), DOWNSTREAM_FLOW)
  if (!created) return undefined
  connect({
    source: source.id,
    target: created.id,
    sourceHandle: outputHandleOf(source),
    targetHandle: tool === 'tryon' ? 'garment' : 'image',
  })
  return created
}

/**
 * 在来源节点右侧新建一个文字节点（反推结果「插入画布」、端口「+」→「添加文字」用）。
 * 文字节点没有输入口，所以不连线；新节点选中，用户可再把它连到生成节点的提示词口。
 */
function addTextNodeNear(sourceId: string, text = ''): CanvasEditorNode | undefined {
  const source = findNode(sourceId)
  if (!source || !ready.value) return undefined
  const created = addNode('text', undefined, spotRightOf(source), DOWNSTREAM_FLOW)
  if (created && text) created.data.text = text.slice(0, 3000)
  return created
}

/**
 * 「更换」图片 / 视频：节点组件持有上传状态（上传中 / 取消），store 只发请求信号；
 * 右键菜单等外部入口调 replaceNodeImage(nodeId)，对应节点打开文件框（视频节点同样适用）。
 */
const replaceMediaRequest = ref<{ nodeId: string; seq: number } | null>(null)
let replaceSeq = 0
function replaceNodeImage(nodeId: string): void {
  if (!findNode(nodeId)) return
  replaceSeq += 1
  replaceMediaRequest.value = { nodeId, seq: replaceSeq }
}

/**
 * 候选列表指纹（隐藏候选的作废键）：只认 URL 去掉查询串后的部分，签名参数变化不算换了一批。
 * 不按 runId 记——节点上的 runId 是「最近一次」run（失败的重跑、刷新回填的最新 run 都会改它），
 * 候选却来自最近一次**成功**的 run，按 runId 比对会让移除过的候选在失败重跑 / 刷新后又冒出来。
 */
function candidatesFingerprint(urls: string[] | undefined): string {
  if (!urls?.length) return ''
  const text = urls.map((url) => url.split('?')[0]).join('\n')
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `${urls.length}:${(hash >>> 0).toString(36)}`
}

/** 当前这批候选里被用户移除的下标（候选换了一批自动作废；旧数据没有 fp 时按 runId 比对） */
function hiddenCandidatesOf(data: CanvasEditorNodeData): Set<number> {
  const hidden = data.hiddenCandidates
  if (!hidden) return new Set()
  const valid = hidden.fp
    ? hidden.fp === candidatesFingerprint(data.candidates) ||
      // 现签地址转存进素材库后 URL 整体换掉：同一个成功 run 产出的仍是同一批
      (Boolean(hidden.rid) && data.status === 'done' && hidden.rid === data.runId)
    : (hidden.runId ?? '') === (data.runId ?? '')
  return valid ? new Set(hidden.indices) : new Set()
}

/**
 * 移除一张候选（模型节点缩略图「×」）：候选下标保持不变（candidate-N 连线与服务端候选列表按下标对应），
 * 只记为隐藏；从这张候选单独连出的线一并断开；移除的是当前输出时改选剩下的第一张。至少保留一张。
 */
async function removeCandidate(nodeId: string, index: number): Promise<void> {
  const node = findNode(nodeId)
  const list = node?.data.candidates ?? []
  if (!node || !list[index]) return
  const hidden = hiddenCandidatesOf(node.data)
  hidden.add(index)
  const visible = list.map((_, i) => i).filter((i) => !hidden.has(i))
  if (!visible.length) {
    message.info('至少保留一张候选')
    return
  }
  // 注：撤销会把 hiddenCandidates 退回去（它是快照内容），但下面改选候选写回服务端的 select-candidate 不会撤销
  const rid = productRunIds.get(nodeId) ?? (node.data.status === 'done' ? node.data.runId : undefined)
  node.data.hiddenCandidates = {
    fp: candidatesFingerprint(list),
    ...(rid ? { rid } : {}),
    indices: [...hidden].sort((a, b) => a - b),
  }
  const handle = `candidate-${index + 1}`
  edges.value = edges.value.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === handle))
  if ((node.data.selectedCandidate ?? 0) === index && visible[0] !== undefined) {
    await selectCandidate(nodeId, visible[0])
  }
}

/**
 * 参考图拖拽排序（控制台缩略图）：把 edgeId 挪到同口同组的 toIndex 位置，按新顺序重写 data.order = 1..n
 * （buildReferences 按 order 编「图1 / 图2」）。首尾帧口各只有一条，不参与排序——它们固定排在最前、
 * 各占一个序号（见 graph.compareRefOrder），普通参考接在后面，所以这里只给普通参考重编 1..n。
 */
function reorderReference(targetId: string, edgeId: string, toIndex: number): void {
  const moving = edges.value.find((edge) => edge.id === edgeId && edge.target === targetId)
  if (!moving) return
  const group = normalizeHandle(moving.targetHandle)
  if (!group || group === 'prompt') return
  const siblings = edges.value
    .filter(
      (edge) =>
        edge.target === targetId &&
        normalizeHandle(edge.targetHandle) === group &&
        edge.targetHandle !== 'image1' &&
        edge.targetHandle !== 'image2',
    )
    .sort((a, b) => (a.data?.order ?? 0) - (b.data?.order ?? 0))
  const from = siblings.indexOf(moving)
  if (from < 0) return
  siblings.splice(from, 1)
  siblings.splice(Math.max(0, Math.min(toIndex, siblings.length)), 0, moving)
  siblings.forEach((edge, i) => {
    edge.data = { ...(edge.data ?? {}), order: i + 1 }
  })
}

/** 把画布上一个节点连到目标节点的参考图口（控制台虚线「+」从画布选节点）；校验不过时 connect 会给出原因 */
function addReferenceFrom(targetId: string, sourceId: string): boolean {
  const source = findNode(sourceId)
  const target = findNode(targetId)
  if (!source || !target) return false
  let targetHandle = 'image'
  if (target.data.kind === 'video') {
    if (isVideoSource(source)) targetHandle = 'video'
    else if (!edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'image1')) {
      targetHandle = 'image1'
    }
  }
  return connect({ source: source.id, target: target.id, sourceHandle: outputHandleOf(source), targetHandle })
}

const ID_PREFIX: Record<CanvasEditorNode['type'], string> = {
  text: 't',
  image: 'n',
  video: 'v',
  model: 'm',
  tool: 'tool',
  module: 'mod',
}

/**
 * 剪贴板快照（Ctrl+C / X 时取）：选中节点 + 分组底板范围内的成员，只拷用户内容（剔除运行态，
 * 生成 / 工具节点的成品也不带）+ 两端都在集合里的连线。深拷贝，之后原节点被删 / 被改都不影响粘贴。
 */
function snapshotForClipboard(ids: string[]): ICanvasClipboard | null {
  const picked = new Set<string>()
  for (const id of ids) {
    const node = findNode(id)
    if (!node) continue
    picked.add(id)
    if (node.type === 'module') for (const child of moduleChildren(id)) picked.add(child.id)
  }
  if (!picked.size) return null
  // 按画布里的原顺序取：底板仍在成员前面
  const list = nodes.value.filter((node) => picked.has(node.id))
  return {
    nodes: list.map((node) => {
      const data = JSON.parse(JSON.stringify(slimData(node))) as CanvasEditorNodeData
      if (node.type === 'model' || node.type === 'tool') data.status = 'idle'
      return {
        id: node.id,
        type: node.type,
        position: { x: node.position.x, y: node.position.y },
        data,
        ...(node.draggable === false || node.data.locked ? { draggable: false } : {}),
        ...(node.selectable === false ? { selectable: false } : {}),
        ...(typeof node.zIndex === 'number' ? { zIndex: node.zIndex } : {}),
      }
    }),
    edges: edges.value
      .filter((edge) => picked.has(edge.source) && picked.has(edge.target))
      .map((edge) => ({
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

/**
 * 按剪贴板快照粘贴：新 id、组内连线重映射；整组当作一个整体，保持组内相对布局，
 * 落在原位置右侧第一块不与现有节点重叠（间距 ≥ NODE_GAP）的空位。返回新节点 id（底板在前）
 */
function pasteClipboard(clip: ICanvasClipboard): string[] {
  if (!ready.value || !clip.nodes.length) return []
  const out = remapClipboard(clip, 0, (node) => nextNodeId(ID_PREFIX[node.type]), nextEdgeId)
  const members = out.nodes.filter((node) => node.type !== 'module')
  const rects = (members.length ? members : out.nodes).map(rectOfNode)
  const shift = findFreeBlockShift(rects, { dx: 0, dy: 0 }, obstacleRects(nodes.value), { flow: 'right-first' })
  if (shift.dx || shift.dy) {
    for (const node of out.nodes) node.position = { x: node.position.x + shift.dx, y: node.position.y + shift.dy }
  }
  const plates = out.nodes.filter((node) => node.type === 'module')
  const others = out.nodes.filter((node) => node.type !== 'module')
  nodes.value = [...plates, ...nodes.value, ...others]
  renumberDefaultTitles(nodes.value)
  // 节点先挂载（Handle 就绪）再补连线，同加载时的顺序
  if (out.edges.length) {
    void nextTick(() => {
      edges.value = [...edges.value, ...out.edges.filter((edge) => findNode(edge.source) && findNode(edge.target))]
    })
  }
  return [...plates, ...others].map((node) => node.id)
}

/** 再制 / 复制（多选操作条、右键、Ctrl+D）：取快照立即粘贴 */
function duplicateNodes(ids: string[]): string[] {
  const clip = snapshotForClipboard(ids)
  return clip ? pasteClipboard(clip) : []
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
/** 页面隐藏时放慢 run 轮询（切回前台的下一轮即恢复 1.2s；超时按墙钟算，不受影响） */
const POLL_HIDDEN_INTERVAL = 5000
const pollDelay = () => (document.visibilityState === 'hidden' ? POLL_HIDDEN_INTERVAL : POLL_INTERVAL)
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
  const max = catalogOf(node)?.countMax ?? 4
  return Math.min(max, Math.max(1, Math.round(Number((node.data as { count?: number }).count) || 1)))
}

function catalogOf(node: CanvasEditorNode): ICanvasCatalogModel | undefined {
  const data = node.data
  if (data.kind !== 'model' && data.kind !== 'video') return undefined
  const list = data.kind === 'video' ? catalog.value?.video_models : catalog.value?.imageModels
  return list?.find((item) => item.modelId === data.modelId) ?? list?.find((item) => item.model === data.model)
}

const QUALITY_MAP: Record<string, string> = { 低: 'low', 中: 'medium', 高: 'high', 超高: 'xhigh', 极致: 'max' }

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
          model: normalizeModelTier(data.tryonModel) || '通用',
          resolution: data.tryonResolution || '1k',
          aspectRatio: data.tryonAspectRatio || '3:4',
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

/** 视频生成：服务端要求「提示词或首帧图」其一即可（只有首帧也能生成） */
function hasVideoDriver(refs: ICanvasRunRef[]): boolean {
  return refs.some(
    (ref) => (ref.handle === 'image1' || ref.handle === 'first' || ref.handle === 'image') && Boolean(ref.image),
  )
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
        runId: createSafeUuid(),
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
  const modelId = data.modelId || catalogOf(node)?.modelId || ''
  if (!model || !modelId) return { error: '请先在卡片上选择模型' }
  const refs = buildReferences(nodes.value, edges.value, node.id)
  // body.prompt 只放节点自带的提示词；连线文字走 references，服务端把两者拼成「连线文本 + 换行 + 节点提示词」
  if (!hasPromptText(node, refs) && !(isVideo && hasVideoDriver(refs))) {
    return {
      error: isVideo
        ? '请连接文字节点、在节点菜单「提示词与参考」里填写提示词，或连接首帧图'
        : '提示词为空：请连接文字节点，或在节点菜单「提示词与参考」里填写',
    }
  }
  const req: ICanvasRunReq = {
    runId: createSafeUuid(),
    kind: isVideo ? 'video' : 'image',
    model,
    modelId: modelId,
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

const TERMINAL_RUN_STATUS = new Set(['succeeded', 'failed', 'cancelled'])

/**
 * 提交前先落地待保存改动：服务端按已保存快照核对 references（先保存、再执行）。
 * @param reuse 重试「结果未知」的那次提交时原样重发（同 run_id + 同 body，服务端幂等重放，不重复扣点）
 */
async function runNode(nodeId: string, reuse?: ICanvasRunReq, opts?: { quiet?: boolean }): Promise<boolean> {
  const node = findNode(nodeId)
  if (!node || !ready.value) return false
  // 状态在 await flushSave 之后才置 queued：连点 / 双击要靠在途集合挡住第二次提交
  if (submittingNodes.has(nodeId)) return false
  if (node.data.status === 'running' || node.data.status === 'queued') return false
  if (node.data.kind === 'tool' && catalog.value?.tools?.find((t) => t.tool === node.data.tool)?.ready === false) {
    message.warning(`「${node.data.title}」暂未开放`)
    return false
  }
  let req = reuse
  if (!req) {
    // 上游产物是取到超过 5 分钟的现签地址：先换新签名再组请求（图片引用服务端按 candidate_index 现取，
    // 视频引用只认请求里的地址，过期就会失败）
    const stale = staleUpstreamIds(nodeId)
    if (stale.length) {
      const targetId = canvasId
      submittingNodes.add(nodeId)
      try {
        await Promise.all(stale.map((id) => fetchProductMedia(id)))
      } finally {
        submittingNodes.delete(nodeId)
      }
      if (targetId !== canvasId) return false
    }
    // await 期间节点对象可能被撤销 / 重做整体替换：按 id 重新取
    const fresh = findNode(nodeId)
    if (!fresh) return false
    const built = buildRunRequest(fresh)
    if (!built.req) {
      message.warning(`「${node.data.title}」${built.error ?? '参数不完整'}`)
      return false
    }
    req = built.req
    // 新的一次点击 = 新 run_id；之前结果未知的那次不再重发
    pendingUnknownRuns.delete(nodeId)
  }
  const targetId = canvasId
  submittingNodes.add(nodeId)
  if (opts?.quiet) quietNodes.add(nodeId)
  else quietNodes.delete(nodeId)
  try {
    const saved = await flushSave()
    if (!saved || targetId !== canvasId) return false
    const live = findNode(nodeId)
    if (!live) return false
    live.data.runId = req.runId
    // 清掉上一次 run 的 request_id：提交在途时点停止不能去取消上一次（已结束）的 run
    live.data.requestId = undefined
    live.data.status = 'queued'
    live.data.errorMessage = undefined
    live.data.errorCode = undefined
    live.data.retryable = undefined
    live.data.progress = 0
    live.data.requestedCount = runCountOf(live)
    let requestId = ''
    try {
      const res = await canvasNodeRun(targetId, nodeId, req, req.runId)
      if (targetId !== canvasId) return false
      requestId = res.data?.requestId ?? ''
      if (!requestId) throw new Error('提交结果未知')
      pendingUnknownRuns.delete(nodeId)
      const current = findNode(nodeId)
      if (!current) return false
      current.data.requestId = requestId
      if (res.data.warnings?.length) message.warning(res.data.warnings.join('；'))
      // 计费（2026-11-06 二轮）：网关执行的 run 会在提交时冻结点数，记下预扣额（Java / studio 计价的回包 credits=0，
      // 没有预扣，失败时也就不提示「退回」）
      const credits = Number(res.data.credits) || 0
      if (credits > 0) {
        chargedRuns.set(requestId, credits)
        if (!quietNodes.has(nodeId)) {
          const actual =
            settleModes.get(req.modelId ?? '') === 'actual_cost' || settleModes.get(req.model ?? '') === 'actual_cost'
          message.info(actual ? `已预扣 ${credits} 点，按实际用量结算，多退少补` : `已预扣 ${credits} 点`)
        }
      }
      startPolling(current)
    } catch (err) {
      if (targetId !== canvasId) return false
      handleSubmitError(nodeId, req, err)
      return false
    }
    submittingNodes.delete(nodeId)
    if (cancelRequested.delete(nodeId)) await cancelRun(nodeId)
    return true
  } finally {
    submittingNodes.delete(nodeId)
    cancelRequested.delete(nodeId)
  }
}

/**
 * 提交失败分流（契约 1.3 / 1.5 / 3.1）：
 * - 传输层失败 / 5001 / 5xx：结果未知，保留原请求，「重试」原样重发；
 * - 4002：该节点已有进行中的 run（另一窗口或上次未知结果其实已受理），接上它继续轮询；
 * - 其它业务失败（1003 / 3003 / 4001 …）：确定没建 run，展示原因，下次点击用新 run_id。
 */
function handleSubmitError(nodeId: string, req: ICanvasRunReq, err: unknown): void {
  const node = findNode(nodeId)
  if (!node) return
  const apiErr = toApiError(err)
  const code = apiErr?.code ?? -1
  if (code === 4002) {
    void adoptActiveRun(nodeId, apiErr?.message ?? '')
    return
  }
  const unknown = code === -1 || code === 5001 || (apiErr?.httpStatus ?? 0) >= 500
  node.data.status = 'error'
  node.data.errorCode = undefined
  if (unknown) {
    pendingUnknownRuns.set(nodeId, req)
    node.data.errorMessage = '提交结果未知（网络异常或服务繁忙），请点「重试」：沿用同一请求，不会重复扣点'
    node.data.retryable = true
  } else {
    pendingUnknownRuns.delete(nodeId)
    node.data.errorMessage = apiErr?.message || (err instanceof Error ? err.message : '提交失败')
    node.data.retryable = undefined
  }
}

/** 提交回 4002（同一节点已有未结束的 run）：查出那条 run 并接着轮询，查不到才报错 */
async function adoptActiveRun(nodeId: string, fallbackMsg: string): Promise<void> {
  const targetId = canvasId
  try {
    const res = await canvasRuns(targetId, 5, nodeId)
    if (targetId !== canvasId) return
    const node = findNode(nodeId)
    if (!node) return
    const active = res.data?.items?.find((item) => item.nodeId === nodeId && !TERMINAL_RUN_STATUS.has(item.status))
    if (active?.requestId) {
      pendingUnknownRuns.delete(nodeId)
      node.data.requestId = active.requestId
      applyRunResult(nodeId, active)
      startPolling(node)
      message.info('该节点已有进行中的执行，已继续跟踪')
      return
    }
  } catch {
    // 查询失败走下面的兜底
  }
  if (targetId !== canvasId) return
  const node = findNode(nodeId)
  if (!node) return
  node.data.status = 'error'
  node.data.errorMessage = fallbackMsg || '提交冲突，请稍后刷新画布查看'
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
        if (applyRunResult(live.nodeId, res.data)) stopPolling(requestId)
        else live.timer = setTimeout(tick, pollDelay())
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
  // 写回前先记下「这批候选里移除了哪些、来自哪个成功 run」：转存后 URL 整体换掉时据此保留
  const before = productStateOf(nodeId)
  data.requestId = run.requestId || data.requestId
  data.runId = run.runId || data.runId
  if (run.status === 'succeeded') {
    writeProduct(nodeId, run, before)
    data.status = 'done'
    data.progress = 100
    data.requestedCount = run.requestedCount ?? data.requestedCount
    data.errorMessage = undefined
    data.errorCode = undefined
    data.retryable = undefined
    stopPolling(run.requestId)
    return true
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    data.status = 'error'
    data.errorMessage = run.error || (run.status === 'cancelled' ? '已取消执行' : '执行失败')
    data.errorCode = run.errorCode || undefined
    data.retryable = run.status === 'failed' && run.retryable === true
    stopPolling(run.requestId)
    // 计费（2026-11-06 二轮）：失败 / 取消由服务端退回预扣点数。只有本会话提交时确实预扣过（credits>0）才提示退回；
    // Java 工具（credits=0）、刷新后恢复轮询的旧 run 不知道有没有扣，不说「退回」
    const charged = chargedRuns.get(run.requestId || data.requestId || '') ?? 0
    if (!quietNodes.has(nodeId)) {
      if (charged > 0) {
        message.info(`${run.status === 'cancelled' ? '已取消' : '执行失败'}：预扣的 ${charged} 点将退回`)
      } else if (run.status === 'cancelled') {
        message.info('已取消执行')
      }
    }
    return true
  }
  // submitting / queued / running / 未知状态都按未结束处理
  data.status = run.status === 'running' ? 'running' : 'queued'
  data.progress = run.progress ?? data.progress
  return false
}

/** 写回产物前的快照：当前有效的移除下标 + 产出它们的成功 run（hiddenCandidates.rid / 本会话缓存） */
function productStateOf(nodeId: string): { hidden: Set<number>; rid?: string } {
  const node = findNode(nodeId)
  if (!node) return { hidden: new Set() }
  return {
    hidden: hiddenCandidatesOf(node.data),
    rid: productRunIds.get(nodeId) ?? node.data.hiddenCandidates?.rid,
  }
}

/**
 * 成功 run 的产物写回节点（候选 / 选中 / 成品图 / 视频 / 反推文本 / 转存素材库状态），
 * 不碰 status / requestId / runId（由调用方决定：执行轮询会一并改，转存刷新不改）。
 */
function writeProduct(nodeId: string, run: ICanvasRunResult, before: { hidden: Set<number>; rid?: string }): void {
  const node = findNode(nodeId)
  if (!node) return
  const data = node.data
  const urls = (run.candidates ?? []).map((item) => item.url)
  const selected = Math.min(Math.max(run.selectedIndex ?? 0, 0), Math.max(urls.length - 1, 0))
  data.candidates = urls
  data.selectedCandidate = selected
  if (data.kind === 'video') {
    // 视频 run 的 candidates[0] 是封面图
    if (run.videoUrl) data.video = run.videoUrl
    data.image = urls[selected] ?? urls[0]
  } else if (data.kind === 'model' || data.kind === 'tool') {
    data.image = urls[selected] ?? urls[0]
  }
  if (run.text && data.kind === 'tool') data.resultText = run.text
  const sameRun = Boolean(run.runId) && before.rid === run.runId
  if (sameRun && before.hidden.size) {
    // 同一个成功 run（转存后现签地址换成长期地址）：移除过的候选照旧隐藏，指纹跟着新地址走
    const fp = candidatesFingerprint(urls)
    const hidden = data.hiddenCandidates
    if (!hidden || hidden.fp !== fp || hidden.rid !== run.runId) {
      // 这是程序跟着换地址，不是用户改动：没有待落定的用户改动时顺手挪基线，不记成一步撤销
      const rebase = Boolean(historyBase) && !historyRestoring && historyBase?.signature === contentSignature()
      data.hiddenCandidates = { fp, rid: run.runId, indices: [...before.hidden].sort((a, b) => a - b) }
      if (rebase) historyBase = captureHistory()
    }
  } else if (data.hiddenCandidates && hiddenCandidatesOf(data).size === 0) {
    // 换了一批候选（新的一次成功运行）：之前移除的候选作废；同一批（轮询重复写回）保留
    data.hiddenCandidates = undefined
  }
  const libraryStatus = normalizeLibraryStatus(
    run.libraryStatus ?? (run as { library_status?: unknown }).library_status,
  )
  if (libraryStatus) data.libraryStatus = libraryStatus
  else delete data.libraryStatus
  // 换了一批产物才重置换签名次数（同一批反复失败不会无限换）
  if (!sameRun) mediaRefreshLog.delete(nodeId)
  mediaFetchedAt.set(nodeId, Date.now())
  if (run.runId) productRunIds.set(nodeId, run.runId)
  if (run.requestId) productRequestIds.set(nodeId, run.requestId)
  syncLibraryWatch(nodeId, run.requestId)
}

// ---------------- 产物转存素材库（先交付、后进素材库，契约 3.3） ----------------

interface ILibraryWatch {
  timer: ReturnType<typeof setTimeout> | null
  requestId: string
  delay: number
  startedAt: number
  errors: number
}

/**
 * 成功后低频跟转存状态：3s 起、每次 ×1.5、封顶 10s；页面隐藏时不查。
 * 跟满 10 分钟仍是 pending 时不放弃，改为每 60s 查一次（后端转存重试累计约 50 分钟），
 * 直到状态变空 / failed、节点删除或切画布，否则只认地址的入口会一直禁用到重新打开画布。
 */
const LIBRARY_POLL_FIRST = 3000
const LIBRARY_POLL_MAX = 10_000
const LIBRARY_POLL_LIMIT = 10 * 60_000
const LIBRARY_POLL_SLOW = 60_000
/** 现签地址 10 分钟有效：取到超过 5 分钟的，提交下游前先换新签名 */
const SIGNED_URL_SAFE_MS = 5 * 60_000
/** 地址过期（图片 / 视频加载失败）换签名：同一节点 20 秒内只换一次，同一批产物最多换 3 次 */
const MEDIA_REFRESH_COOLDOWN = 20_000
const MEDIA_REFRESH_MAX = 3

const libraryWatches = new Map<string, ILibraryWatch>()
/** 节点 id → 最近一次成功 run 的 request_id（转存刷新 / 换签名用；节点上的 requestId 可能已是更新的一次失败 / 在跑的 run） */
const productRequestIds = new Map<string, string>()
/** 节点 id → 现签地址取到的时间 */
const mediaFetchedAt = new Map<string, number>()
/** 节点 id → 换签名记录（限流） */
const mediaRefreshLog = new Map<string, { at: number; count: number }>()

function stopLibraryWatch(nodeId: string): void {
  const entry = libraryWatches.get(nodeId)
  if (entry?.timer) clearTimeout(entry.timer)
  libraryWatches.delete(nodeId)
}

function stopAllLibraryWatches(): void {
  for (const nodeId of [...libraryWatches.keys()]) stopLibraryWatch(nodeId)
}

/** 节点产物转存中就跟着查，状态变空 / failed 即停 */
function syncLibraryWatch(nodeId: string, requestId: string | undefined): void {
  const node = findNode(nodeId)
  if (node && requestId && isLibraryPending(node.data)) startLibraryWatch(nodeId, requestId)
  else stopLibraryWatch(nodeId)
}

function startLibraryWatch(nodeId: string, requestId: string): void {
  if (libraryWatches.get(nodeId)?.requestId === requestId) return
  stopLibraryWatch(nodeId)
  const entry: ILibraryWatch = { timer: null, requestId, delay: LIBRARY_POLL_FIRST, startedAt: Date.now(), errors: 0 }
  libraryWatches.set(nodeId, entry)
  const targetId = canvasId
  const tick = (): void => {
    if (libraryWatches.get(nodeId) !== entry) return
    if (targetId !== canvasId || !findNode(nodeId)) {
      stopLibraryWatch(nodeId)
      return
    }
    const slow = Date.now() - entry.startedAt > LIBRARY_POLL_LIMIT
    if (document.visibilityState === 'hidden') {
      entry.timer = setTimeout(tick, LIBRARY_POLL_MAX)
      return
    }
    canvasRunGet(requestId)
      .then((res) => {
        if (libraryWatches.get(nodeId) !== entry || targetId !== canvasId) return
        entry.errors = 0
        if (res.data) applyProductRefresh(nodeId, res.data)
        if (libraryWatches.get(nodeId) !== entry) return
        entry.delay = slow ? LIBRARY_POLL_SLOW : Math.min(LIBRARY_POLL_MAX, Math.round(entry.delay * 1.5))
        entry.timer = setTimeout(tick, entry.delay)
      })
      .catch(() => {
        if (libraryWatches.get(nodeId) !== entry) return
        entry.errors += 1
        // 查询失败退避重试（10s → 20s → … 封顶 60s），不放弃：
        // 否则 pending 停住，只认地址的入口会一直禁用到重新打开画布
        entry.timer = setTimeout(tick, Math.min(LIBRARY_POLL_MAX * 2 ** (entry.errors - 1), 60_000))
      })
  }
  entry.timer = setTimeout(tick, entry.delay)
}

/**
 * 转存刷新 / 换签名拿到的产物 run 写回节点：只换地址与转存状态，不碰节点执行状态
 * （节点上可能已有更新的一次 run 在跑或失败了）；本会话已知有更新的成功 run 时丢弃。
 */
function applyProductRefresh(nodeId: string, run: ICanvasRunResult): void {
  const node = findNode(nodeId)
  if (!node || run.status !== 'succeeded') return
  const known = productRunIds.get(nodeId)
  if (known && run.runId && known !== run.runId) return
  writeProduct(nodeId, run, productStateOf(nodeId))
}

/** 节点最近一次成功 run 的 request_id：本会话缓存 → 节点最近一次 run 就是成功的 → 查运行历史 */
async function resolveProductRequestId(nodeId: string): Promise<string | undefined> {
  const cached = productRequestIds.get(nodeId)
  if (cached) return cached
  const node = findNode(nodeId)
  if (!node) return undefined
  if (node.data.status === 'done' && node.data.requestId) return node.data.requestId
  if (!canvasId) return undefined
  const targetId = canvasId
  try {
    const res = await canvasRuns(targetId, 50, nodeId)
    if (targetId !== canvasId) return undefined
    const hit = res.data?.items?.find((item) => item.nodeId === nodeId && item.status === 'succeeded')
    if (hit?.requestId) {
      productRequestIds.set(nodeId, hit.requestId)
      if (hit.runId && !productRunIds.has(nodeId)) productRunIds.set(nodeId, hit.runId)
      return hit.requestId
    }
  } catch {
    // 查不到就算了：产物照常显示
  }
  return undefined
}

/** 重新 GET 产物 run，换上新签名 / 长期地址（不限流，调用方自己控频） */
async function fetchProductMedia(nodeId: string): Promise<boolean> {
  const targetId = canvasId
  const requestId = await resolveProductRequestId(nodeId)
  if (!requestId || targetId !== canvasId) return false
  try {
    const res = await canvasRunGet(requestId)
    if (targetId !== canvasId || !res.data) return false
    applyProductRefresh(nodeId, res.data)
    return true
  } catch {
    return false
  }
}

/**
 * 现签地址过期（节点图片 / 视频加载失败、403）时重新 GET 产物 run 换一次签名。转存中 / 转存失败的产物、
 * 视频成品（video_url 读时现签）、免费档水印视图都会过期，所以不按 libraryStatus 拦，只认执行类节点的产物；
 * 同一节点 20 秒内只换一次、同一批最多 3 次，不会因为对象真的没了而无限重试。
 */
function refreshNodeMedia(nodeId: string): void {
  const node = findNode(nodeId)
  if (!node || (node.type !== 'model' && node.type !== 'tool') || node.data.inputOnly) return
  if (!node.data.candidates?.length && !node.data.video) return
  const now = Date.now()
  const log = mediaRefreshLog.get(nodeId)
  if (log && (now - log.at < MEDIA_REFRESH_COOLDOWN || log.count >= MEDIA_REFRESH_MAX)) return
  mediaRefreshLog.set(nodeId, { at: now, count: (log?.count ?? 0) + 1 })
  void fetchProductMedia(nodeId)
}

/**
 * 「重新存入素材库」（契约 3.4.3）：只对转存失败的节点产物有意义。成功后按返回 run 写回（一般是 pending），
 * writeProduct → syncLibraryWatch 接上原有的低频转存轮询；失败原样抛出，由按钮提示（4002 = 太频繁）。
 * 返回的 run 已不是 failed（幂等：已在转存 / 已入库）也照样写回，界面跟着服务端走。
 */
async function retryLibrary(nodeId: string): Promise<void> {
  const node = findNode(nodeId)
  if (!node || node.data.libraryStatus !== 'failed') return
  const targetId = canvasId
  const requestId = await resolveProductRequestId(nodeId)
  if (!requestId || targetId !== canvasId) throw new Error('找不到这条产物的运行记录，请刷新后再试')
  const res = await canvasRunLibraryRetry(requestId)
  if (targetId !== canvasId || !res.data) return
  // 先清掉旧的 watch 记录（failed 时已停），保证 pending 时会重新起轮询
  stopLibraryWatch(nodeId)
  applyProductRefresh(nodeId, res.data)
}

/** 加载后：转存中的节点接着低频跟到状态变空 */
function resumeLibraryWatches(): void {
  const targetId = canvasId
  for (const node of nodes.value) {
    if (!isLibraryPending(node.data)) continue
    const nodeId = node.id
    void resolveProductRequestId(nodeId).then((requestId) => {
      if (targetId === canvasId && requestId) syncLibraryWatch(nodeId, requestId)
    })
  }
}

/**
 * 节点产物地址是否是读时现签（会过期）：转存中 / 转存失败的产物，以及视频成品（video_url 读时现签；
 * 视频引用服务端不按 candidate_index 现取，只认请求里的地址）
 */
function signedProductOf(node: CanvasEditorNode): boolean {
  if ((node.type !== 'model' && node.type !== 'tool') || node.data.inputOnly) return false
  return hasTransientMedia(node.data) || (node.data.kind === 'video' && Boolean(node.data.video))
}

/** 目标节点的直接上游里，产物是现签地址且已取到超过 5 分钟的节点 */
function staleUpstreamIds(nodeId: string): string[] {
  const now = Date.now()
  const ids = new Set(edges.value.filter((edge) => edge.target === nodeId).map((edge) => edge.source))
  const sourceNodeId = findNode(nodeId)?.data.sourceNodeId
  if (sourceNodeId) ids.add(sourceNodeId)
  return [...ids].filter((id) => {
    const node = findNode(id)
    return node && signedProductOf(node) && now - (mediaFetchedAt.get(id) ?? 0) > SIGNED_URL_SAFE_MS
  })
}

/**
 * 节点产物的地址能否被复制进别的节点内容（拖成新节点、按地址设为参考 / 编辑等只认地址的入口）。
 * 转存中返回提示文案（入口禁用、悬停看原因）；可用返回空串。转存失败的地址同样是现签，但不会再变成长期地址，
 * 只允许即时使用（看、下载、即时提交），不写进节点内容。
 */
function mediaBlockReason(nodeId: string): string {
  const node = findNode(nodeId)
  return node && isLibraryPending(node.data) ? LIBRARY_PENDING_TIP : ''
}

/**
 * 等节点这次执行落定（批量执行按依赖提交下游用）：done / error；画布切走、节点被删、
 * 轮询超时停掉（状态停在 running 但没人再查）都按 unknown 返回，不会永远挂起。
 */
function waitForSettled(nodeId: string): Promise<'done' | 'error' | 'unknown'> {
  const targetId = canvasId
  return new Promise((resolve) => {
    const check = (): 'done' | 'error' | 'unknown' | null => {
      if (targetId !== canvasId || !ready.value) return 'unknown'
      const node = findNode(nodeId)
      if (!node) return 'unknown'
      if (submittingNodes.has(nodeId)) return null
      const status = node.data.status
      if (status === 'done') return 'done'
      if (status === 'error') return 'error'
      if (status === 'running' || status === 'queued') {
        const requestId = node.data.requestId
        return requestId && pollers.has(requestId) ? null : 'unknown'
      }
      return 'unknown'
    }
    const tick = (): void => {
      const result = check()
      if (result) resolve(result)
      else setTimeout(tick, 600)
    }
    tick()
  })
}

/** 节点是否正在提交 / 排队 / 运行（批量执行据此跳过，不重复提交，也不算失败） */
function isNodeBusy(nodeId: string): boolean {
  if (submittingNodes.has(nodeId)) return true
  const status = findNode(nodeId)?.data.status
  return status === 'running' || status === 'queued'
}

/** 节点当前这次 run 在提交时预扣的点数（0 = 没预扣 / 不知道） */
function runChargeOf(nodeId: string): number {
  const requestId = findNode(nodeId)?.data.requestId
  return requestId ? (chargedRuns.get(requestId) ?? 0) : 0
}

/** 批量执行结束：恢复逐条提示 */
function endQuiet(ids: string[]): void {
  for (const id of ids) quietNodes.delete(id)
}

async function cancelRun(nodeId: string): Promise<void> {
  const node = findNode(nodeId)
  if (!node) return
  // 提交还在途（还没有 request_id）：记下来，拿到 request_id 立即取消，不能只改本地状态
  if (submittingNodes.has(nodeId)) {
    cancelRequested.add(nodeId)
    message.info('正在提交，提交完成后将立即取消')
    return
  }
  const requestId = node.data.requestId
  if (!requestId) {
    node.data.status = 'idle'
    return
  }
  try {
    await canvasRunCancel(requestId)
  } catch {
    // 已是终态（4002）等：下面按服务端状态刷新
  }
  if (pollers.has(requestId)) return // 轮询继续，下一拍拿终态
  try {
    const res = await canvasRunGet(requestId)
    const current = findNode(nodeId)
    // Java 工具取消可能回 running（后台重试取消）：没到终态就接着轮询
    if (current && !applyRunResult(nodeId, res.data)) startPolling(current)
  } catch {
    const current = findNode(nodeId)
    if (!current) return
    current.data.status = 'error'
    current.data.errorMessage = '已请求取消，请稍后刷新画布确认结果'
  }
}

/**
 * 重试：提交结果未知的那次原样重发（同 run_id，服务端幂等重放）；
 * 服务端判定失败（retryable）的 run 重新组装请求、换新 run_id（契约 3.3）。
 */
function retryNode(nodeId: string): Promise<void> {
  const node = findNode(nodeId)
  if (node) {
    node.data.errorCode = undefined
    node.data.retryable = undefined
  }
  return runNode(nodeId, pendingUnknownRuns.get(nodeId)).then(() => undefined)
}

// ---------------- 候选选择 ----------------

async function resolveProductRunId(nodeId: string): Promise<string | undefined> {
  const cached = productRunIds.get(nodeId)
  if (cached) return cached
  if (!canvasId) return undefined
  try {
    const res = await canvasRuns(canvasId, 50, nodeId)
    const hit = res.data?.items?.find((item) => item.nodeId === nodeId && item.status === 'succeeded')
    if (hit?.runId) {
      productRunIds.set(nodeId, hit.runId)
      return hit.runId
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
  const prevIndex = node.data.selectedCandidate
  const prevImage = node.data.image
  node.data.selectedCandidate = index
  const data = node.data
  const isVideoModel = data.kind === 'video'
  if (data.kind === 'model' || data.kind === 'tool') {
    if (!isVideoModel) data.image = url
  }
  try {
    const res = await canvasSelectCandidate(canvasId, nodeId, { runId: runId, index })
    const selected = res.data?.selectedIndex
    if (typeof selected === 'number' && node.data.candidates?.[selected]) {
      node.data.selectedCandidate = selected
      if (!isVideoModel && (data.kind === 'model' || data.kind === 'tool')) {
        data.image = node.data.candidates[selected]
      }
    }
  } catch {
    // 拦截器已 toast；写回失败就回滚，避免下游按「看起来选中」的那张图执行而刷新后又变回去
    node.data.selectedCandidate = prevIndex
    if (!isVideoModel && (data.kind === 'model' || data.kind === 'tool')) data.image = prevImage
  }
}

// ---------------- 目录 ----------------

async function loadCatalog(): Promise<void> {
  try {
    const res = await canvasCatalog()
    catalog.value = res.data ?? null
    registerCatalogLabels(catalog.value)
    reconcileCatalogLimits()
  } catch {
    catalog.value = null
    message.warning('模型目录加载失败，生成节点暂时无法选择模型，请刷新重试')
  }
}

/**
 * 目录下发的完整模型名登记进 modelLabelOf 的目录表：节点 data.model / data.modelId 是 wire 值（Image / banana-v1 …），
 * 画布各处（节点头、下拉、素材面板、运行记录）经 modelLabelOf 显示时就拿到服务端的完整名。不改节点数据。
 */
function registerCatalogLabels(cat: ICanvasCatalog | null): void {
  for (const item of [...(cat?.imageModels ?? []), ...(cat?.video_models ?? [])]) {
    const label = item.label?.trim()
    if (!label) continue
    if (item.model) catalogModelLabels[item.model] = label
    if (item.modelId) catalogModelLabels[item.modelId] = label
  }
}

/**
 * 快照里的 maxImageRefs 可能比当前 catalog 宽（目录后来收窄）：服务端保存 / 执行按两者较小值校验，
 * 前端连线校验只看 maxImageRefs，不收窄就会让用户连上之后保存被 1003 拒。
 */
function reconcileCatalogLimits(): void {
  if (!catalog.value || !ready.value) return
  // 目录收窄是系统修正、不是用户操作：先落定待记的改动，修正后重设基线，不产生撤销步
  commitHistory()
  let changed = false
  for (const node of nodes.value) {
    const cap = catalogOf(node)?.maxImageRefs ?? 0
    if (cap > 0 && (node.data.maxImageRefs ?? 0) > cap) {
      node.data.maxImageRefs = cap
      changed = true
    }
  }
  if (changed && historyBase) historyBase = captureHistory()
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
    revision,
    mergePending,
    remoteHighlight,
    remoteNotice,
    flashNodes,
    selectedNodeId,
    selectedNode,
    runningCount,
    catalog,
    canUndo,
    canRedo,
    // 生命周期
    init,
    loadCatalog,
    /** 离开编辑器时停掉轮询等后台活动（服务端 run 会继续跑，重进时按 requestId 恢复轮询） */
    dispose: () => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      stopAllPollers()
      stopAllLibraryWatches()
      settling.clear()
      mergePending.value = null
      pendingHints.length = 0
      ready.value = false
      selectedNodeId.value = ''
      resetHistory()
    },
    // 选择 / 编辑
    selectNode,
    findNode,
    updateNodeData,
    addNode,
    releasePlacement,
    changeModel,
    connect,
    removeEdgeById,
    removeNode,
    removeNodes,
    moduleChildren,
    removeModule,
    duplicateNodes,
    snapshotForClipboard,
    pasteClipboard,
    toggleLock,
    setLocked,
    isLocked,
    createModule,
    ungroup,
    /** 删除分组底板连同组内成员（右键菜单「删除分组（含成员）」） */
    deleteGroupWithMembers,
    /** 从图片类节点新建下游工具节点并自动连线 */
    addConnectedToolNode,
    /** 在节点右侧新建文字节点（可带初始文本） */
    addTextNodeNear,
    /** 请求图片 / 视频节点打开文件框更换素材（节点组件响应 replaceMediaRequest） */
    replaceNodeImage,
    replaceMediaRequest,
    outputHandleOf,
    removeCandidate,
    hiddenCandidatesOf,
    /** 产物现签地址过期（加载失败 / 403）时换一次签名（限流） */
    refreshNodeMedia,
    retryLibrary,
    /** 产物地址能否复制进别的节点内容：转存中返回提示文案，可用返回空串 */
    mediaBlockReason,
    reorderReference,
    addReferenceFrom,
    // 撤销 / 重做
    undo,
    redo,
    // 保存
    saveNow: () => enqueueSave(),
    reloadLatest,
    flushSave,
    // 实时同步
    handleRemoteEvent,
    /** 轮询 / 重连后补查：服务端 revision 与本地不同就当作一次远端变更 */
    checkRemoteRevision: (rev: string) => {
      if (rev && rev !== revision.value && !ownRevisions.includes(rev)) requestSync({ revision: rev })
    },
    resolveMerge,
    discardLocalChanges,
    // 执行
    runNode: (nodeId: string, opts?: { quiet?: boolean }) => runNode(nodeId, undefined, opts),
    waitForSettled,
    isNodeBusy,
    runChargeOf,
    endQuiet,
    retryNode,
    cancelRun,
    selectCandidate,
  }
}

export type CanvasEditorStore = ReturnType<typeof useCanvasEditor>
