<script setup lang="ts">
/**
 * 画布节点编辑器（对齐原型 CanvasView + canvas-v31 皮肤）：
 * 顶栏（返回 / 标题✎ / 保存状态 / 运行数 / 模板 · 保存 · 另存为 · 执行模型）
 * + 左侧「画布资产」栏 + Vue Flow 画布（左竖工具条 / 底横工具条）+ 浮动控制台（选中节点时出现在节点下方）
 * + 添加节点面板（工具条「+」/ 双击空白画布 / 端口「+」）+ 多选操作条 + 节点缩放 + 模块删除。
 * 接口契约见 fusion_aigc_go/docs/api/api-canvas.md；快照 {nodes, edges} 整段存取 + 乐观锁保存。
 */
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ConnectionMode, VueFlow, useVueFlow, type EdgeMouseEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
// Vue Flow 必需的基础样式：节点绝对定位、变换原点、连线 SVG overflow:visible、Handle 贴边定位。
// 缺了它连线会被 SVG 裁掉（看不到线），节点 / 端口也会落回文档流而错位。
import '@vue-flow/core/dist/style.css'
import { llTheme } from '@/views/local-life/theme.ts'
import EditorIcon from './EditorIcon.vue'
import EditorBezierEdge from './EditorBezierEdge.vue'
import EditorTextNode from './nodes/EditorTextNode.vue'
import EditorImageNode from './nodes/EditorImageNode.vue'
import EditorVideoNode from './nodes/EditorVideoNode.vue'
import EditorModelNode from './nodes/EditorModelNode.vue'
import EditorToolNode from './nodes/EditorToolNode.vue'
import EditorModuleNode from './nodes/EditorModuleNode.vue'
import NodeParamsPanel from './NodeParamsPanel.vue'
import NodeAddPanel from './NodeAddPanel.vue'
import ImageActionPanel from './ImageActionPanel.vue'
import { activeImageAction } from './imageActions.ts'
import EditorAssetPanel from './EditorAssetPanel.vue'
import TitleModal from '../TitleModal.vue'
import TemplatePicker from '../TemplatePicker.vue'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { canvasSaveAs } from '@/api/canvasHome.ts'
import { downloadImage } from '@/utils/download.ts'
import { takeCanvasImport } from '@/utils/canvasImportHandoff.ts'
import { normalizeHandle, spawnPosition, validateConnection } from './graph.ts'
import { editorDialog, editorMessage, useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasEditorNode, CanvasToolKind } from './types.ts'
import {
  FOCUS_RING,
  POP_FADE,
  SELECTION_BTN,
  TOOLBAR,
  TOOLBAR_BTN,
  TOP_BTN,
  TOP_BTN_PRIMARY,
  type AddPanelKind,
  type IQuickAddRequest,
  type QuickAddKind,
} from './ui.ts'

defineOptions({ name: 'canvas-editor' })

const route = useRoute()
const router = useRouter()
const store = useCanvasEditor()
const FLOW_ID = 'canvas-editor-flow'
const {
  fitView,
  zoomIn,
  zoomOut,
  setCenter,
  viewport,
  getSelectedNodes,
  removeSelectedElements,
  screenToFlowCoordinate,
} = useVueFlow(FLOW_ID)

/**
 * 点阵背景（原型 CanvasView dotGrid）：基准间距 24，按缩放翻倍 / 减半，使屏幕间距保持在 13–42px；
 * 点径 1.15px（除以缩放，屏幕上恒定）。
 */
const dotGrid = computed(() => {
  const zoom = viewport.value.zoom || 1
  let gap = 24
  while (gap * zoom < 13) gap *= 2
  while (gap * zoom > 42) gap /= 2
  return { gap, size: 1.15 / zoom }
})

const canvasId = computed(() => String(route.params.id ?? ''))

const {
  nodes,
  edges,
  title,
  loading,
  loadError,
  saveState,
  saveError,
  lastSavedAt,
  dirty,
  selectedNode,
  runningCount,
  canUndo,
  canRedo,
} = store

// ---------------- 加载 ----------------

onMounted(() => {
  void store.loadCatalog()
  const id = canvasId.value
  void store.init(id).then((ok) => {
    if (ok) importFromHandoff(id)
  })
})

/** 智能体「在画布中打开」的交接：首次加载完取走一次，一张图一个图片节点排成一行，交给自动保存 */
function importFromHandoff(id: string) {
  const handoff = takeCanvasImport(id)
  if (!handoff) return
  const base = spawnPosition(nodes.value)
  let last: CanvasEditorNode | undefined
  handoff.urls.forEach((url, i) => {
    const created = store.addNode('image', undefined, { x: base.x + i * 300, y: base.y })
    if (!created) return
    store.updateNodeData(created.id, { image: url })
    last = created
  })
  if (last) {
    const at = last.position
    void nextTick(() => setCenter(at.x + 120, at.y + 100, { zoom: 0.86, duration: 220 }))
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (id && route.name === 'canvas-editor') void store.init(String(id))
  },
)

// 节点先挂载、连线后补：Handle 尺寸就绪前加边会被 Vue Flow 丢弃
watch(loading, async (value) => {
  if (value || !nodes.value.length) return
  await nextTick()
  if (edges.value.length) void fitView({ padding: 0.15, maxZoom: 1 })
})

// ---------------- 选中 ----------------

const selectedEdgeId = ref('')

function onNodeClick(event: NodeMouseEvent) {
  selectedEdgeId.value = ''
  closeAddPanel()
  store.selectNode(event.node.id)
}

function onPaneClick() {
  selectedEdgeId.value = ''
  closeAddPanel()
  store.selectNode('')
}

function onEdgeClick(event: EdgeMouseEvent) {
  store.selectNode('')
  selectedEdgeId.value = event.edge.id
}

// ---------------- 连线 ----------------

/** 拖拽过程中的实时校验（提示词口按「新线替换旧线」算容量） */
function isValidConnection(connection: {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}) {
  if (!connection.source || !connection.target) return false
  const conn = {
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  }
  const pool =
    normalizeHandle(conn.targetHandle) === 'prompt'
      ? edges.value.filter((edge) => !(edge.target === conn.target && normalizeHandle(edge.targetHandle) === 'prompt'))
      : edges.value
  return validateConnection(nodes.value, pool, conn).ok
}

function onConnect(connection: {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}) {
  if (!connection.source || !connection.target) return
  const ok = store.connect({
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  })
  if (ok) selectedEdgeId.value = ''
}

/** 拖到节点主体（未命中端口）时按来源类型自动挑输入口 */
let connectStart: { nodeId?: string | null; handleId?: string | null } | null = null

function onConnectStart(payload: { nodeId?: string | null; handleId?: string | null }) {
  connectStart = payload
}

function onConnectEnd(event?: MouseEvent) {
  const start = connectStart
  connectStart = null
  if (!start?.nodeId || !event) return
  const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  const nodeEl = under?.closest<HTMLElement>('.vue-flow__node')
  const targetId = nodeEl?.dataset.id
  if (!targetId || targetId === start.nodeId) return
  const source = store.findNode(start.nodeId)
  const target = store.findNode(targetId)
  if (!source || !target) return
  const sourceHandle =
    start.handleId ?? (source.type === 'text' ? 'text' : source.type === 'video' ? 'video' : 'image-out')
  const targetHandle = autoTargetHandle(source, target)
  store.connect({ source: source.id, target: targetId, sourceHandle, targetHandle })
}

/** 未命中端口时按来源 / 目标类型挑输入口（拖到节点主体、「+」快捷添加共用） */
function autoTargetHandle(source: CanvasEditorNode, target: CanvasEditorNode): string {
  const targetId = target.id
  let targetHandle = 'image'
  if (source.type === 'text' || (source.data.kind === 'tool' && source.data.tool === 'i2p')) targetHandle = 'prompt'
  else if (target.data.kind === 'video' && source.type === 'model' && source.data.kind === 'video') {
    targetHandle = 'video'
  } else if (target.data.kind === 'video') {
    const usedFirst = edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'image1')
    targetHandle = usedFirst ? 'image2' : 'image1'
  } else if (target.data.kind === 'tool' && target.data.tool === 'tryon') {
    const usedGarment = edges.value.some((edge) => edge.target === targetId && edge.targetHandle === 'garment')
    targetHandle = usedGarment ? 'models' : 'garment'
  }
  return targetHandle
}

/** 节点的输出口 id（与各节点组件里 source Handle 的 id 一致） */
function outputHandleOf(node: CanvasEditorNode): string {
  if (node.type === 'text') return 'text'
  if (node.type === 'video') return 'video'
  if (node.type === 'image') return 'image'
  if (node.type === 'tool') return node.data.tool === 'i2p' ? 'text' : 'image-out'
  return node.data.inputOnly ? 'video' : 'image-out'
}

/** 新建节点后自动从来源节点连过去（端口「+」→ 添加面板；新建 / 连线 / 校验全走 store 既有方法） */
function connectFrom(sourceId: string, targetId: string) {
  const source = store.findNode(sourceId)
  const target = store.findNode(targetId)
  if (!source || !target) return
  store.connect({
    source: source.id,
    target: target.id,
    sourceHandle: outputHandleOf(source),
    targetHandle: autoTargetHandle(source, target),
  })
}

// ---------------- 删除 / 快捷键 ----------------

function deleteSelection() {
  if (selectedFlowNodes.value.length > 1) {
    confirmDeleteNodes()
    return
  }
  if (selectedEdgeId.value) {
    store.removeEdgeById(selectedEdgeId.value)
    selectedEdgeId.value = ''
    return
  }
  if (selectedNode.value) store.removeNode(selectedNode.value.id)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void store.saveNow()
    return
  }
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  // 控制台 / 添加面板里的下拉、开关等控件聚焦时，按键归控件（避免 Backspace 误删节点）
  if (target?.closest('[data-canvas-console], [data-canvas-popover]')) return
  if (event.key === 'Escape') {
    if (addPanel.value) {
      closeAddPanel()
      return
    }
    selectedEdgeId.value = ''
    clearFlowSelection()
    store.selectNode('')
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) void redoCanvas()
    else void undoCanvas()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    void redoCanvas()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
  }
}

// ---------------- 撤销 / 重做 / 批量下载（对齐原型 CanvasView undoCanvas / redoCanvas / downloadAll） ----------------

async function undoCanvas() {
  if (!(await store.undo())) return
  if (selectedEdgeId.value && !edges.value.some((edge) => edge.id === selectedEdgeId.value)) selectedEdgeId.value = ''
  editorMessage.success('已撤销')
}

async function redoCanvas() {
  if (!(await store.redo())) return
  if (selectedEdgeId.value && !edges.value.some((edge) => edge.id === selectedEdgeId.value)) selectedEdgeId.value = ''
  editorMessage.success('已重做')
}

const downloading = ref(false)

/** 原型 downloadAll：画布上所有带图片 / 视频的节点逐个下载（视频节点优先下视频） */
async function downloadAll() {
  if (downloading.value) return
  const urls = nodes.value
    .map((node) => node.data.video || node.data.image || '')
    .filter((url): url is string => Boolean(url))
  if (!urls.length) {
    editorMessage.warning('画布上还没有图片或视频输出')
    return
  }
  downloading.value = true
  editorMessage.success(`开始批量下载 ${urls.length} 个输出`)
  try {
    for (const url of urls) {
      await downloadImage(url)
      await new Promise((resolve) => setTimeout(resolve, 180))
    }
  } finally {
    downloading.value = false
  }
}

// ---------------- 离开保护 ----------------

const leaveConfirmed = ref(false)

function confirmLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    editorDialog.warning({
      title: '有未保存的修改',
      content: '离开前将尝试自动保存，也可以直接离开（改动会丢失）。',
      positiveText: '保存并离开',
      negativeText: '直接离开',
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
      // Esc 关闭不走上面任何回调：兜底按「留下」处理，避免导航守卫永远挂起
      onAfterLeave: () => resolve(false),
      // 先等保存真正落地再放行：离开后 dispose 会让排队中的保存直接放弃，改动就丢了
      onPositiveClick: async () => {
        const ok = await store.flushSave()
        if (!ok) {
          editorMessage.error('保存未成功，已留在当前页面')
          resolve(false)
          return
        }
        resolve(true)
      },
      onNegativeClick: () => resolve(true),
    })
  })
}

onBeforeRouteLeave(async () => {
  if (!dirty.value || leaveConfirmed.value) return true
  const ok = await confirmLeave()
  leaveConfirmed.value = ok
  return ok
})

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
  void store.flushSave()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  consoleObserver?.disconnect()
  cancelAnimationFrame(consoleFrame)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  store.dispose()
})
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))

function backToList() {
  void router.push({ name: 'canvas' })
}

// ---------------- 顶栏展示 ----------------

const saveText = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'conflict') return '版本冲突'
  if (saveState.value === 'error') return saveError.value || '保存失败'
  if (saveState.value === 'dirty') return '未保存更改'
  if (lastSavedAt.value) {
    const d = new Date(lastSavedAt.value)
    const p = (n: number) => String(n).padStart(2, '0')
    return `已保存 ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return '已保存'
})

/** 保存状态小标（原型 .wf-save-state：surface-3 底 / muted / 11px；失败红、冲突琥珀、待存琥珀字） */
const saveStateClass = computed(() => {
  if (saveState.value === 'error') return 'bg-[#fbeeed] text-danger'
  if (saveState.value === 'conflict') return 'bg-[#f8f1e4] text-warning'
  if (saveState.value === 'saving' || saveState.value === 'dirty') return 'bg-surface3 text-warning'
  return 'bg-surface3 text-muted'
})

// 标题：原型是「标题 + ✎」按钮，点开变输入框（回车 / 失焦收起）；写的仍是 store.title
const titleEditing = ref(false)
const titleInputRef = ref<HTMLInputElement | null>(null)

function startTitleEdit() {
  titleEditing.value = true
  void nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

function commitTitle() {
  titleEditing.value = false
}

// ---------------- 执行（只调既有 runNode，不新增编排） ----------------

/** 可执行的选中节点：生成节点 / 工具节点 */
const runTarget = computed(() => {
  const node = selectedNode.value
  return node && (node.type === 'model' || node.type === 'tool') ? node : undefined
})

const runHint = computed(() =>
  runTarget.value
    ? `执行选中的「${runTarget.value.data.title}」（暂不支持一键按依赖执行全部）`
    : '先在画布上选中一个生成或工具节点（暂不支持一键执行全部）',
)

function runSelected() {
  if (runTarget.value) void store.runNode(runTarget.value.id)
}

// ---------------- 另存为 / 模板（只接既有接口与弹层） ----------------

const showSaveAs = ref(false)
const savingAs = ref(false)
const saveAsInitial = computed(() => `${title.value || '未命名画布'} - 副本`)

async function doSaveAs(newTitle: string) {
  if (savingAs.value) return
  savingAs.value = true
  try {
    // 服务端按已保存快照复制：先把待保存改动落地
    const saved = await store.flushSave()
    if (!saved) {
      editorMessage.error('当前改动未保存成功，暂不能另存为')
      return
    }
    const res = await canvasSaveAs(canvasId.value, newTitle || undefined)
    showSaveAs.value = false
    editorMessage.success('已另存为副本')
    const id = res.data?.id
    if (id) void router.push({ name: 'canvas-editor', params: { id } })
  } catch (error) {
    editorMessage.error(error instanceof Error && error.message ? error.message : '另存为失败，请稍后重试')
  } finally {
    savingAs.value = false
  }
}

const showTemplates = ref(false)

function onCreatedFromTemplate(id: string) {
  if (id) void router.push({ name: 'canvas-editor', params: { id } })
}

// ---------------- 资产栏 / 素材库 ----------------

function locateNode(id: string) {
  const node = store.findNode(id)
  if (!node) return
  selectedEdgeId.value = ''
  store.selectNode(id)
  void setCenter(node.position.x + 160, node.position.y + 150, { zoom: 1, duration: 300 })
}

const showAssetPicker = ref(false)

/** 素材库选中的图片：逐张新建图片节点并写入地址（同上传后的写法） */
function addLibraryImages(urls: string[]) {
  let last: CanvasEditorNode | undefined
  for (const url of urls) {
    const created = store.addNode('image')
    if (!created) break
    store.updateNodeData(created.id, { image: url })
    last = created
  }
  if (last) {
    const at = last.position
    void nextTick(() => setCenter(at.x + 120, at.y + 100, { zoom: 0.86, duration: 220 }))
  }
}

// ---------------- 画布工具条 ----------------

/** 原型默认「选择」：拖拽框选，滚轮 / 触控板平移；「拖动」：拖拽平移画布 */
const toolMode = ref<'select' | 'pan'>('select')
const snapEnabled = ref(false)

/**
 * 新建节点：不给落点时沿用 spawnPosition 自动排布并把视图移过去；
 * 给了落点（双击画布 / 端口「+」打开的添加面板）就落在那里，视图不动（同原型 addFromPanel）。
 */
function spawn(kind: AddPanelKind, tool?: CanvasToolKind, at?: { x: number; y: number }) {
  const created = store.addNode(kind, tool, at)
  if (!created) return undefined
  if (!at) {
    void nextTick(() => {
      setCenter(created.position.x + 170, created.position.y + 160, { zoom: 0.86, duration: 220 })
    })
  }
  return created
}

// ---------------- 添加节点面板（原型 CanvasAddPanel：工具条「+」/ 双击空白画布 / 端口「+」） ----------------

const stageRef = ref<HTMLElement | null>(null)
/** 面板位置（相对舞台）+ 新节点落点（画布坐标）+ 端口「+」的来源节点与可选种类 */
const addPanel = ref<{
  x: number
  y: number
  spawnAt?: { x: number; y: number }
  anchorId?: string
  kinds?: QuickAddKind[]
} | null>(null)

const ADD_PANEL_W = 300

/** 把视口坐标换成舞台内的面板左上角，并夹在舞台里 */
function panelPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect) return { x: 60, y: 28 }
  const panelH = Math.min(640, rect.height - 40)
  return {
    x: Math.round(Math.max(12, Math.min(clientX - rect.left + 8, rect.width - ADD_PANEL_W - 12))),
    y: Math.round(Math.max(12, Math.min(clientY - rect.top - 24, rect.height - panelH - 20))),
  }
}

/** 左工具条「+」：面板贴着工具条，新节点按自动排布 */
function openAddPanel() {
  selectedEdgeId.value = ''
  addPanel.value = addPanel.value && !addPanel.value.spawnAt ? null : { x: 60, y: 28 }
}

/** 双击空白画布：面板与新节点都落在双击处 */
function onStageDblClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.vue-flow__pane')) return
  if (target.closest('.vue-flow__node, .vue-flow__edge, [data-canvas-console], [data-canvas-popover]')) return
  if (loading.value || !store.ready.value) return
  selectedEdgeId.value = ''
  addPanel.value = {
    ...panelPoint(event.clientX, event.clientY),
    spawnAt: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
  }
}

/** 端口「+」：面板开在「+」旁，只列可接到下游的种类；新节点落在「+」右侧并自动连线 */
function openQuickAdd(sourceId: string, request: IQuickAddRequest) {
  selectedEdgeId.value = ''
  store.selectNode(sourceId)
  const flow = screenToFlowCoordinate({ x: request.clientX + 60, y: request.clientY })
  addPanel.value = {
    ...panelPoint(request.clientX + 8, request.clientY),
    spawnAt: { x: flow.x, y: flow.y - 40 },
    anchorId: sourceId,
    kinds: request.kinds,
  }
}

function closeAddPanel() {
  addPanel.value = null
}

function addFromPanel(kind: AddPanelKind, tool?: CanvasToolKind) {
  const panel = addPanel.value
  closeAddPanel()
  const created = spawn(kind, tool, panel?.spawnAt)
  if (created && panel?.anchorId) connectFrom(panel.anchorId, created.id)
}

// ---------------- 多选操作条（原型 .wf-selection-bar：执行 / 复制 / 删除 / 取消选择） ----------------

/** Vue Flow 框选 / 多选出来的节点（只认仍在画布上的） */
const selectedFlowNodes = computed(() =>
  (getSelectedNodes.value ?? [])
    .map((node) => store.findNode(node.id))
    .filter((node): node is CanvasEditorNode => Boolean(node)),
)

function clearFlowSelection() {
  removeSelectedElements()
}

/** 选中节点里可执行的（生成 / 工具，参考素材节点除外），有上下游时按拓扑顺序 */
function executableInOrder(list: CanvasEditorNode[]): string[] {
  const ids = list
    .filter((node) => (node.type === 'model' && !node.data.inputOnly) || node.type === 'tool')
    .map((node) => node.id)
  const set = new Set(ids)
  const indegree = new Map(ids.map((id) => [id, 0]))
  for (const edge of edges.value) {
    if (set.has(edge.source) && set.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = ids.filter((id) => !indegree.get(id))
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() ?? ''
    order.push(id)
    for (const edge of edges.value) {
      if (edge.source !== id || !set.has(edge.target)) continue
      const left = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, left)
      if (left === 0) queue.push(edge.target)
    }
  }
  return [...order, ...ids.filter((id) => !order.includes(id))]
}

async function runSelectionNodes() {
  const order = executableInOrder(selectedFlowNodes.value)
  if (!order.length) {
    editorMessage.warning('选中的节点里没有可执行的生成或工具节点')
    return
  }
  for (const id of order) await store.runNode(id)
}

function duplicateSelectionNodes() {
  const created = store.duplicateNodes(selectedFlowNodes.value.map((node) => node.id))
  if (!created.length) return
  clearFlowSelection()
  editorMessage.success(`已复制 ${created.length} 个节点`)
}

function confirmDeleteNodes() {
  const ids = selectedFlowNodes.value.map((node) => node.id)
  if (!ids.length) return
  editorDialog.warning({
    title: `删除 ${ids.length} 个节点？`,
    content: '与这些节点相连的连线也会一起删除，可以用 Ctrl+Z 撤销。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      const removed = store.removeNodes(ids)
      clearFlowSelection()
      editorMessage.success(`已删除 ${removed} 个节点`)
    },
  })
}

// ---------------- 模块删除（底板 + 模块内节点） ----------------

function confirmRemoveModule(id: string) {
  const module = store.findNode(id)
  if (!module || module.type !== 'module') return
  const count = store.moduleChildren(id).length
  const name = module.data.title || '模块'
  editorDialog.warning({
    title: `删除模块「${name}」？`,
    content: count
      ? `模块内的 ${count} 个节点及相连连线会一起删除，可以用 Ctrl+Z 撤销。`
      : '模块内没有节点，只删除底板，可以用 Ctrl+Z 撤销。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      const removed = store.removeModule(id)
      if (removed) editorMessage.success(removed > 1 ? `已删除模块及 ${removed - 1} 个节点` : '已删除模块')
    },
  })
}

// ---------------- 浮动控制台定位（原型 consoleFlowStyle：节点下方 12px、放不下翻到上方、左右夹在舞台内） ----------------

const CONSOLE_W = 520
const CONSOLE_H = 360
const consoleBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)

function placeConsole() {
  const node = selectedNode.value
  const stage = stageRef.value
  if (!node || !stage) {
    consoleBox.value = null
    return
  }
  const s = stage.getBoundingClientRect()
  const width = Math.max(280, Math.min(CONSOLE_W, s.width - 16))
  const height = Math.max(220, Math.min(CONSOLE_H, s.height - 16))
  // 底部留出底横工具条（bottom 16 + 40 高）
  const bottomLimit = s.height - 64
  const el = stage.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(node.id)}"]`)
  let top = bottomLimit - height
  let left = (s.width - width) / 2
  if (el) {
    const r = el.getBoundingClientRect()
    top = r.bottom - s.top + 12
    if (top + height > bottomLimit) {
      const above = r.top - s.top - 12 - height
      top = above >= 8 ? above : Math.max(8, bottomLimit - height)
    }
    left = r.left - s.left + r.width / 2 - width / 2
  }
  left = Math.max(8, Math.min(s.width - 8 - width, left))
  consoleBox.value = { left: Math.round(left), top: Math.round(Math.max(8, top)), width, height }
}

let consoleFrame = 0
function schedulePlaceConsole() {
  cancelAnimationFrame(consoleFrame)
  consoleFrame = requestAnimationFrame(placeConsole)
}

watch(
  () => {
    const node = selectedNode.value
    const vp = viewport.value
    return [node?.id, node?.position.x, node?.position.y, node?.data.width, node?.data.height, vp.x, vp.y, vp.zoom]
  },
  () => void nextTick(schedulePlaceConsole),
  { flush: 'post' },
)

/** 节点自身高度会变（图片加载后按比例撑开、缩放）、舞台也会随窗口变：都要重新定位 */
let consoleObserver: ResizeObserver | null = null
watch(
  () => selectedNode.value?.id,
  async (id) => {
    consoleObserver?.disconnect()
    if (!id || typeof ResizeObserver === 'undefined') return
    await nextTick()
    consoleObserver = new ResizeObserver(schedulePlaceConsole)
    if (stageRef.value) consoleObserver.observe(stageRef.value)
    const el = stageRef.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(id)}"]`)
    if (el) consoleObserver.observe(el)
  },
)

function openPromptLibrary() {
  window.open(router.resolve({ name: 'prompt-library' }).href, '_blank', 'noopener')
}

function openHelp() {
  const line = (text: string, cls = 'm-0 mb-6px text-ink-2 text-13px leading-20px') => h('p', { class: cls }, text)
  editorDialog.info({
    title: '画布缩放说明',
    positiveText: '我知道了',
    content: () =>
      h('div', [
        line('macOS：按住 ⌘，同时滚动鼠标滚轮；触控板可双指捏合'),
        line('Windows：按住 Ctrl，同时滚动鼠标滚轮'),
        line('也可以用下方工具条的放大 / 缩小 / 适应画布按钮。'),
        line('提示：默认滚轮是上下平移画布，只有配合组合键时才会缩放。', 'm-0 mt-8px text-muted text-12px'),
      ]),
  })
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="flex flex-col h-100vh overflow-hidden bg-page">
      <header class="flex shrink-0 items-center gap-8px h-48px px-12px border-b border-b-solid border-line bg-white">
        <button
          type="button"
          class="grid shrink-0 w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-ink-2 cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
          :class="FOCUS_RING"
          title="返回画布首页"
          aria-label="返回画布首页"
          @click="backToList"
        >
          <EditorIcon name="arrowBack" :size="18" />
        </button>
        <input
          v-if="titleEditing"
          ref="titleInputRef"
          v-model="title"
          class="w-240px h-30px px-8px border border-solid border-violet rounded-4px bg-white text-ink text-14px font-600 leading-20px outline-none shadow-[0_0_0_3px_rgba(135,95,154,0.14),inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
          maxlength="100"
          placeholder="未命名画布"
          aria-label="画布标题"
          @keydown.enter="commitTitle"
          @blur="commitTitle"
        />
        <button
          v-else
          type="button"
          class="flex min-w-0 items-center gap-6px h-30px px-8px border border-solid border-transparent rounded-4px bg-transparent text-ink text-14px font-600 leading-20px cursor-pointer hover:border-line hover:bg-surface2"
          :class="FOCUS_RING"
          title="重新命名"
          :aria-label="`重新命名：${title || '未命名画布'}`"
          @click="startTitleEdit"
        >
          <span class="overflow-hidden text-ellipsis whitespace-nowrap max-w-320px">{{ title || '未命名画布' }}</span>
          <EditorIcon name="pencil" :size="14" />
        </button>
        <span
          class="shrink-0 px-7px py-2px rounded-4px text-11px whitespace-nowrap"
          :class="saveStateClass"
          :title="saveState === 'error' ? saveError : undefined"
          >{{ saveText }}</span
        >
        <span
          v-if="runningCount"
          class="shrink-0 px-7px py-2px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-11px whitespace-nowrap"
          >运行中 {{ runningCount }}</span
        >

        <div class="flex items-center gap-6px ml-auto">
          <button
            type="button"
            :class="TOP_BTN"
            title="模板库：从模板新建一张画布（不改动当前画布）"
            @click="showTemplates = true"
          >
            <EditorIcon name="card" :size="16" /> 模板
          </button>
          <button
            type="button"
            :class="TOP_BTN"
            :aria-disabled="saveState === 'saving' || undefined"
            title="保存当前画布（Ctrl/Cmd+S）"
            @click="saveState !== 'saving' && store.saveNow()"
          >
            {{ saveState === 'saving' ? '保存中…' : '保存' }}
          </button>
          <button type="button" :class="TOP_BTN" title="复制当前画布到一张新画布" @click="showSaveAs = true">
            另存为
          </button>
          <button
            type="button"
            :class="TOP_BTN_PRIMARY"
            :aria-disabled="!runTarget || undefined"
            :title="runHint"
            @click="runSelected"
          >
            执行模型
          </button>
        </div>
      </header>

      <div class="flex flex-1 min-h-0">
        <EditorAssetPanel @locate="locateNode" @add-from-library="showAssetPicker = true" />

        <!-- 舞台：原型 .wf-canvas 底色 #f5f5f5；框选框藤紫描边 + 8% 浅底；非法连线红色虚线 -->
        <div ref="stageRef" class="relative flex-1 min-w-0 overflow-hidden bg-[#f5f5f5]" @dblclick="onStageDblClick">
          <VueFlow
            :id="FLOW_ID"
            v-model:nodes="nodes"
            v-model:edges="edges"
            class="w-full h-full [&_.vue-flow\_\_pane]:cursor-default [&_.vue-flow\_\_selection]:border [&_.vue-flow\_\_selection]:border-solid [&_.vue-flow\_\_selection]:border-violet [&_.vue-flow\_\_selection]:bg-[rgba(135,95,154,0.08)] [&_.vue-flow\_\_connection-path.invalid]:!stroke-[#b4433e] [&_.vue-flow\_\_connection-path.invalid]:[stroke-dasharray:5_4]"
            :default-viewport="{ x: 40, y: 20, zoom: 0.86 }"
            :min-zoom="0.2"
            :max-zoom="2"
            :zoom-on-scroll="false"
            :pan-on-scroll="true"
            :pan-on-drag="toolMode === 'pan'"
            :selection-key-code="toolMode === 'select' ? true : 'Shift'"
            :snap-to-grid="snapEnabled"
            :snap-grid="[20, 20]"
            :zoom-on-double-click="false"
            :delete-key-code="null"
            :connect-on-click="false"
            :connection-mode="ConnectionMode.Strict"
            :connection-line-style="{ stroke: '#875f9a', strokeWidth: 2, strokeLinecap: 'round' }"
            :is-valid-connection="isValidConnection"
            @node-click="onNodeClick"
            @pane-click="onPaneClick"
            @edge-click="onEdgeClick"
            @connect="onConnect"
            @connect-start="onConnectStart"
            @connect-end="onConnectEnd"
          >
            <Background :gap="dotGrid.gap" :size="dotGrid.size" pattern-color="rgba(31, 35, 41, 0.20)" />

            <template #edge-canvas-bezier="edgeProps">
              <EditorBezierEdge v-bind="edgeProps" />
            </template>
            <template #node-text="nodeProps">
              <EditorTextNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @locate="locateNode"
                @quick-add="(request: IQuickAddRequest) => openQuickAdd(nodeProps.id, request)"
              />
            </template>
            <template #node-image="nodeProps">
              <EditorImageNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(request: IQuickAddRequest) => openQuickAdd(nodeProps.id, request)"
              />
            </template>
            <template #node-video="nodeProps">
              <EditorVideoNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(request: IQuickAddRequest) => openQuickAdd(nodeProps.id, request)"
              />
            </template>
            <template #node-model="nodeProps">
              <EditorModelNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(request: IQuickAddRequest) => openQuickAdd(nodeProps.id, request)"
              />
            </template>
            <template #node-tool="nodeProps">
              <EditorToolNode
                v-bind="nodeProps"
                @remove="store.removeNode(nodeProps.id)"
                @quick-add="(request: IQuickAddRequest) => openQuickAdd(nodeProps.id, request)"
              />
            </template>
            <template #node-module="nodeProps">
              <EditorModuleNode v-bind="nodeProps" @remove="confirmRemoveModule(nodeProps.id)" />
            </template>
          </VueFlow>

          <!-- 空态 / 加载态（原型 .wf-canvas-empty + v3.1：虚线 r8、白 94%、轻投影，按钮藤紫浅底） -->
          <div
            v-if="loading || !nodes.length"
            class="absolute top-50% left-50% z-6 flex flex-col items-center gap-6px px-24px py-20px border border-dashed border-line-strong rounded-8px bg-white/94 text-muted text-center shadow-[0_1px_2px_rgba(16,24,40,0.06)] -translate-x-50% -translate-y-50% pointer-events-none"
            :role="loading ? 'status' : undefined"
          >
            <strong class="text-ink text-14px">{{
              loading ? '正在加载画布…' : loadError ? '画布加载失败' : '这是一张新画布'
            }}</strong>
            <template v-if="!loading">
              <p v-if="loadError" class="m-0 text-13px">{{ loadError }}</p>
              <p v-else class="m-0 text-13px">双击空白处或点左侧工具条「+」添加节点，也可「从素材库添加」放入素材。</p>
              <button
                v-if="loadError"
                type="button"
                class="h-30px mt-4px px-12px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-13px cursor-pointer pointer-events-auto hover:border-[#c9b2d8] hover:bg-violet-soft-2"
                :class="FOCUS_RING"
                @click="store.init(canvasId)"
              >
                重试
              </button>
            </template>
          </div>

          <!-- 连线选中条（原型 .wf-selection-bar--edge：顶部居中 36px、r8、浮层投影） -->
          <div
            v-if="selectedEdgeId"
            class="absolute top-10px left-50% z-6 flex h-36px items-center gap-2px px-6px py-4px border border-solid border-line rounded-8px bg-white/98 text-ink-2 text-13px shadow-[0_12px_28px_rgba(58,38,72,0.14),0_2px_6px_rgba(31,35,41,0.06)] -translate-x-50%"
            :class="POP_FADE"
            role="toolbar"
            aria-label="连线操作"
            @click.stop
          >
            <span class="px-5px text-ink-2 text-13px whitespace-nowrap">已选中连线</span>
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              class="h-28px px-8px border border-solid border-transparent rounded-4px bg-transparent text-danger text-13px cursor-pointer hover:bg-[#fbeeed] hover:text-[#9b3935]"
              :class="FOCUS_RING"
              @click="deleteSelection"
            >
              断开
            </button>
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              class="grid w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted text-14px cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
              :class="FOCUS_RING"
              aria-label="取消选中"
              title="取消选中"
              @click="selectedEdgeId = ''"
            >
              ×
            </button>
          </div>

          <!-- 多选操作条（原型 .wf-selection-bar：顶部居中 36px、r8；执行 / 复制 / 删除 / 取消选择） -->
          <div
            v-else-if="selectedFlowNodes.length > 1"
            class="absolute top-10px left-50% z-6 flex h-36px items-center gap-2px px-6px py-4px border border-solid border-line rounded-8px bg-white/98 text-ink-2 text-13px shadow-[0_12px_28px_rgba(58,38,72,0.14),0_2px_6px_rgba(31,35,41,0.06)] -translate-x-50%"
            :class="POP_FADE"
            role="toolbar"
            aria-label="多选节点操作"
            @click.stop
          >
            <span class="px-5px text-ink-2 text-13px whitespace-nowrap" aria-live="polite"
              >已选中 {{ selectedFlowNodes.length }} 个节点</span
            >
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              :class="SELECTION_BTN"
              title="按上下游顺序执行选中的生成 / 工具节点"
              @click="runSelectionNodes"
            >
              <EditorIcon name="play" :size="12" /> 执行
            </button>
            <button
              type="button"
              :class="SELECTION_BTN"
              title="复制选中节点（含它们之间的连线）"
              @click="duplicateSelectionNodes"
            >
              <EditorIcon name="copy" :size="12" /> 复制
            </button>
            <button
              type="button"
              :class="SELECTION_BTN"
              class="!text-danger hover:!border-[#e4b7b4] hover:!bg-[#fbeeed] hover:!text-[#9b3935]"
              title="删除选中节点（Delete）"
              @click="confirmDeleteNodes"
            >
              <EditorIcon name="trash" :size="12" /> 删除
            </button>
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              class="grid w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted text-14px cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
              :class="FOCUS_RING"
              aria-label="取消选择"
              title="取消选择（Esc）"
              @click="clearFlowSelection"
            >
              ×
            </button>
          </div>

          <!-- 左竖工具条（原型 .wf-toolbar-left：left 12 / 垂直居中） -->
          <div
            :class="TOOLBAR"
            class="left-12px top-50% -translate-y-50% flex-col"
            role="toolbar"
            aria-label="画布工具"
          >
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': toolMode === 'pan' }]"
              title="拖动模式（平移画布）"
              aria-label="拖动模式"
              :aria-pressed="toolMode === 'pan'"
              @click="toolMode = 'pan'"
            >
              <EditorIcon name="hand" :size="19" />
            </button>
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': toolMode === 'select' }]"
              title="选择模式（框选节点）"
              aria-label="选择模式"
              :aria-pressed="toolMode === 'select'"
              @click="toolMode = 'select'"
            >
              <EditorIcon name="pointer" :size="18" />
            </button>
            <span class="h-1px mx-6px my-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': addPanel && !addPanel.spawnAt }]"
              title="添加节点（也可双击空白画布）"
              aria-label="添加节点"
              aria-haspopup="dialog"
              :aria-expanded="Boolean(addPanel)"
              @click="openAddPanel"
            >
              <EditorIcon name="plus" :size="20" />
            </button>
            <span class="h-1px mx-6px my-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              :class="TOOLBAR_BTN"
              title="从素材库导入"
              aria-label="从素材库导入"
              @click="showAssetPicker = true"
            >
              <EditorIcon name="albums" :size="18" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              title="提示词库（新标签页打开）"
              aria-label="提示词库（新标签页打开）"
              @click="openPromptLibrary"
            >
              <EditorIcon name="book" :size="18" />
            </button>
          </div>

          <!-- 底横工具条（原型 .wf-toolbar-bottom：bottom 16 / 水平居中） -->
          <div
            :class="TOOLBAR"
            class="bottom-16px left-50% -translate-x-50% items-center"
            role="toolbar"
            aria-label="画布视图"
          >
            <button
              type="button"
              :class="TOOLBAR_BTN"
              :aria-disabled="!runTarget || undefined"
              :title="runTarget ? '执行选中节点' : '先选中一个生成或工具节点'"
              aria-label="执行选中节点"
              @click.stop="runSelected"
            >
              <EditorIcon name="play" :size="16" />
            </button>
            <button
              type="button"
              :class="[TOOLBAR_BTN, { 'is-on': snapEnabled }]"
              title="对齐网格（20px，默认关）"
              aria-label="对齐网格"
              :aria-pressed="snapEnabled"
              @click.stop="snapEnabled = !snapEnabled"
            >
              <EditorIcon name="grid" :size="16" />
            </button>
            <button type="button" :class="TOOLBAR_BTN" title="放大" aria-label="放大" @click.stop="zoomIn()">
              <EditorIcon name="plus" :size="16" />
            </button>
            <button type="button" :class="TOOLBAR_BTN" title="缩小" aria-label="缩小" @click.stop="zoomOut()">
              <EditorIcon name="minus" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              title="适应画布"
              aria-label="适应画布"
              @click.stop="fitView({ padding: 0.18, duration: 200 })"
            >
              <EditorIcon name="fit" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              :aria-disabled="!canUndo || undefined"
              title="撤销（Ctrl/Cmd+Z）"
              aria-label="撤销"
              @click.stop="canUndo && undoCanvas()"
            >
              <EditorIcon name="undo" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              :aria-disabled="!canRedo || undefined"
              title="重做（Shift+Ctrl/Cmd+Z）"
              aria-label="重做"
              @click.stop="canRedo && redoCanvas()"
            >
              <EditorIcon name="redo" :size="16" />
            </button>
            <button
              type="button"
              :class="TOOLBAR_BTN"
              :aria-disabled="downloading || undefined"
              :aria-busy="downloading || undefined"
              title="批量下载所有图片/视频输出"
              aria-label="批量下载所有图片/视频输出"
              @click.stop="downloadAll"
            >
              <EditorIcon name="download" :size="16" />
            </button>
            <button type="button" :class="TOOLBAR_BTN" title="缩放说明" aria-label="缩放说明" @click.stop="openHelp">
              <EditorIcon name="help" :size="16" />
            </button>
          </div>

          <!-- 浮动控制台（原型 CanvasConsolePanel：约 520×360，节点下方，放不下翻到上方） -->
          <div
            v-if="selectedNode && consoleBox && selectedFlowNodes.length <= 1"
            class="absolute z-15"
            :style="{
              left: `${consoleBox.left}px`,
              top: `${consoleBox.top}px`,
              width: `${consoleBox.width}px`,
              height: `${consoleBox.height}px`,
            }"
          >
            <NodeParamsPanel :key="selectedNode.id" :node="selectedNode" @locate="locateNode" />
          </div>

          <NodeAddPanel
            v-if="addPanel"
            :x="addPanel.x"
            :y="addPanel.y"
            :kinds="addPanel.kinds"
            @close="closeAddPanel"
            @add="addFromPanel"
          />

          <!-- 图片动作面板（节点「…」菜单：识别 / 图片编辑 / 多视图 / 图层） -->
          <ImageActionPanel v-if="activeImageAction" :key="activeImageAction.nodeId" />
        </div>
      </div>

      <TitleModal
        v-model:show="showSaveAs"
        title="另存为副本"
        label="副本标题"
        :initial="saveAsInitial"
        placeholder="留空则自动命名为「原标题 - 副本」"
        :loading="savingAs"
        @confirm="doSaveAs"
      />
      <TemplatePicker v-model:show="showTemplates" @created="onCreatedFromTemplate" />
      <AssetPickerModal v-model:show="showAssetPicker" :limit="10" @select="addLibraryImages" />
    </div>
  </n-config-provider>
</template>

<!--
  浮层淡入关键帧（原型 canvas-v31 §9 canvas-v31-fade：140ms ease-out、2px 下落）。
  UnoCSS 只能引用关键帧（animate-[canvas-editor-fade_140ms_ease-out]，见 ui.ts POP_FADE），定义不了 @keyframes；
  scoped 样式会把关键帧改名，所以放在非 scoped 块里并用画布专属名字。用独立的 translate 属性而非 transform，
  不覆盖操作条自身的 -translate-x-50% 居中。减少动态效果时由 motion-reduce:animate-none 关掉。
-->
<style>
@keyframes canvas-editor-fade {
  from {
    opacity: 0;
    translate: 0 -2px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
</style>
