<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 画布节点编辑器（对齐原型 CanvasView + canvas-v31 皮肤）：
 * 顶栏（返回 / 标题✎ / 保存状态 / 运行数 / 模板 · 保存 · 另存为 · 执行模型）
 * + 左侧「画布资产」栏 + Vue Flow 画布（左竖工具条 / 底横工具条）+ 浮动控制台（选中节点时出现在节点下方）
 * + 添加节点面板（工具条「+」/ 双击空白画布 / 端口「+」）+ 多选操作条 + 节点缩放 + 模块删除。
 * 接口契约见 fusion_aigc_go/docs/api/api-canvas.md；快照 {nodes, edges} 整段存取 + 乐观锁保存。
 */
import { computed, h, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, type VNode } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ConnectionMode, VueFlow, useVueFlow, type EdgeMouseEvent, type NodeMouseEvent } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/minimap/dist/style.css'
import PointsBalanceChip from '@/components/Points/PointsBalanceChip.vue'
import IconButton from '@/components/IconButton/index.vue'
import { useUserInfoStore } from '@/stores/user-info'
import PromptLibraryFlyout from '@/components/Creation/PromptLibraryFlyout.vue'
import { getPointsBalance } from '@/api/points.ts'
import { Background } from '@vue-flow/background'
// Vue Flow 必需的基础样式：节点绝对定位、变换原点、连线 SVG overflow:visible、Handle 贴边定位。
// 缺了它连线会被 SVG 裁掉（看不到线），节点 / 端口也会落回文档流而错位。
import '@vue-flow/core/dist/style.css'
import { llTheme } from '@/views/local-life/theme.ts'
import { activeTheme } from '@/utils/themePrefs.ts'
import { palettes } from '@/theme/tokens.ts'
import EditorIcon from './EditorIcon.vue'
import CanvasTip from './CanvasTip.vue'
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
import { IMAGE_ACTIONS, activeImageAction, collectImageSources, openImageAction } from './image-actions.ts'
import CanvasColorFixDialog from './CanvasColorFixDialog.vue'
import { activeColorFix, colorFixSources, openColorFix } from './color-fix-action.ts'
import { hasTransientMedia } from './library-status.ts'
import EditorAssetPanel from './EditorAssetPanel.vue'
import TitleModal from '../TitleModal.vue'
import TemplateInsertDialog from './TemplateInsertDialog.vue'
import { buildTemplateClipboard } from './template-insert.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import {
  canvasSaveAs,
  canvasUploadMedia,
  type ICanvasCatalogModel,
  type ICanvasTemplateDetail,
} from '@/api/canvas-home.ts'
import { downloadImage } from '@/utils/download.ts'
import { takeCanvasImport } from '@/utils/canvas-import-handoff.ts'
import { isGroupPlate, normalizeHandle, spawnPosition, validateConnection } from './graph.ts'
import { viewportKeepingCenter, type ICanvasClipboard } from './clipboard.ts'
import { editorDialog, editorMessage, useCanvasEditor } from './useCanvasEditor.ts'
import { MAX_IMAGE_UPLOAD_MB, uploadSizeError } from './nodes/useNodeUpload.ts'
import { clipboardFiles, useFileDropPaste } from '@/composables/useFileDropPaste'
import type { CanvasEditorNode, CanvasToolKind } from './types.ts'
import {
  FOCUS_RING,
  NODE_MENU_HOST,
  POP_FADE,
  SELECTION_BTN,
  TOOLBAR,
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
  setViewport,
  viewport,
  getSelectedNodes,
  getNodes,
  onNodesInitialized,
  removeSelectedElements,
  screenToFlowCoordinate,
} = useVueFlow(FLOW_ID)

/** 缩放读数点回 100%：保持舞台中心对着的画布点不动（点击时现量舞台尺寸，资产栏收起 / 窗口变化都准） */
function resetZoom() {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect) return
  void setViewport(viewportKeepingCenter(viewport.value, rect.width, rect.height, 1), { duration: 200 })
}

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
/**
 * 点阵与小地图蒙版随主题：SVG 的 fill 属性不认 CSS 变量，取真色值。
 * 浅色保持原型墨色 20% 点 / 藤紫 8% 蒙版；深色点用 canvas-dot 令牌（压在 page 底上刚好可见、不抢节点），蒙版提亮成藤紫 14%。
 */
const dotColor = computed(() => (activeTheme.value === 'dark' ? palettes.dark['canvas-dot'] : 'rgba(31, 35, 41, 0.20)'))
const minimapMaskColor = computed(() =>
  activeTheme.value === 'dark' ? 'rgba(150, 119, 170, 0.14)' : 'rgba(106, 72, 123, 0.08)',
)

const canvasId = computed(() => String(route.params.id ?? ''))

/** 快捷键修饰键的显示名：macOS 显示 ⌘，其余 Ctrl（快捷键表 / 菜单右侧提示用） */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

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
  // 视频接在图片后面同一行（资产库「用于画布」可带视频）
  const offset = handoff.urls.length
  ;(handoff.videos ?? []).forEach((url, i) => {
    const created = store.addNode('video', undefined, { x: base.x + (offset + i) * 300, y: base.y })
    if (!created) return
    store.updateNodeData(created.id, { video: url })
    last = created
  })
  if (last) {
    // 交接自己定位到新加的那一排，进页的整体居中让给它
    pendingFit = false
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

// ---------------- 进页居中 ----------------
// 每次加载完把全部节点居中显示一次（不论有没有连线）。必须等节点量完尺寸再算：
// 节点先挂载、连线后补，加载结束那一刻节点宽高可能还是 0，这时 fitView 会按空包围盒算，工作区停在左上角。
// 所以：加载结束时节点都已量好就立刻居中，否则等 Vue Flow 的 nodesInitialized 再居中；只做一次，之后不打扰用户的视角。
let pendingFit = false

function nodesMeasured(): boolean {
  const list = getNodes.value
  return list.length > 0 && list.every((n) => (n.dimensions?.width ?? 0) > 0 && (n.dimensions?.height ?? 0) > 0)
}

function fitOnce() {
  if (!pendingFit) return
  pendingFit = false
  void fitView({ padding: 0.15, maxZoom: 1 })
}

watch(loading, async (value) => {
  if (value || !nodes.value.length) return
  pendingFit = true
  await nextTick()
  requestAnimationFrame(() => {
    if (nodesMeasured()) fitOnce()
  })
})

onNodesInitialized(() => fitOnce())

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
  connectedThisDrag = true
}

/**
 * 拖到节点主体（未命中端口）时按来源类型自动挑输入口；拖到空白处则从来源节点打开添加面板，新节点落在松手处并自动连线。
 */
let connectStart: {
  nodeId?: string | null
  handleId?: string | null
  handleType?: string | null
  x?: number
  y?: number
} | null = null
/** 本次拖线已经由 Vue Flow 命中端口连上（connect 先于 connect-end 触发），connect-end 不再兜底 */
let connectedThisDrag = false

function onConnectStart(payload: {
  event?: MouseEvent | TouchEvent
  nodeId?: string | null
  handleId?: string | null
  handleType?: string | null
}) {
  const ev = payload.event
  const p = ev && 'touches' in ev ? ev.touches[0] : (ev as MouseEvent | undefined)
  connectStart = {
    nodeId: payload.nodeId,
    handleId: payload.handleId,
    handleType: payload.handleType,
    x: p?.clientX,
    y: p?.clientY,
  }
  connectedThisDrag = false
}

/**
 * 「空白画布」的判定（拖线松手、拖文件松手共用）：最上层命中必须落在 Vue Flow 画布底板里，
 * 且不在节点 / 连线 / 小地图 / 浮动面板 / 工具条 / 弹层上——盖在画布上的浮层不算空白。
 */
const NOT_BLANK_SELECTOR = [
  '.vue-flow__node',
  '.vue-flow__edge',
  '.vue-flow__minimap',
  '.vue-flow__panel',
  '.vue-flow__controls',
  '[data-canvas-console]',
  '[data-canvas-popover]',
  '[role="toolbar"]',
  '[role="menu"]',
  '[role="dialog"]',
].join(', ')

function isBlankCanvasEl(el: Element | null | undefined): boolean {
  if (!el?.closest('.vue-flow__pane')) return false
  return !el.closest(NOT_BLANK_SELECTOR)
}

/**
 * 选出指针下最上层的元素与它所在的节点 / 端口：拖线时连接线那层 SVG 盖在光标下面，elementFromPoint 只会拿到它，
 * 要先把它滤掉；之后只认最上层那个元素（被浮层盖住的节点不算命中）。
 */
function pickUnderPointer(
  clientX: number,
  clientY: number,
): { top?: HTMLElement; nodeEl?: HTMLElement; handleEl?: HTMLElement } {
  const top = document
    .elementsFromPoint(clientX, clientY)
    .find((el) => !el.closest('.vue-flow__connectionline, .vue-flow__connection')) as HTMLElement | undefined
  return {
    top,
    handleEl: top?.closest<HTMLElement>('.vue-flow__handle') ?? undefined,
    nodeEl: top?.closest<HTMLElement>('.vue-flow__node') ?? undefined,
  }
}

function onConnectEnd(event?: MouseEvent | TouchEvent) {
  const start = connectStart
  connectStart = null
  const justConnected = connectedThisDrag
  connectedThisDrag = false
  if (!start?.nodeId || !event || justConnected) return
  const point = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent)
  if (!point) return
  const { top, nodeEl, handleEl } = pickUnderPointer(point.clientX, point.clientY)
  // 落在空白画布：只有从输出口拖出来时才「接着建」（从输入口反向拖到空白不知道该建什么）
  if (!nodeEl) {
    // 松手处是小地图 / 浮动面板 / 工具条等盖在画布上的东西：不算空白
    if (!isBlankCanvasEl(top)) return
    if (start.handleType && start.handleType !== 'source') return
    // 只是点了一下端口（没拖开）：不当成「拖到空白」
    if (start.x != null && start.y != null && Math.hypot(point.clientX - start.x, point.clientY - start.y) < 12) return
    const stage = stageRef.value?.getBoundingClientRect()
    if (
      !stage ||
      point.clientX < stage.left ||
      point.clientX > stage.right ||
      point.clientY < stage.top ||
      point.clientY > stage.bottom
    )
      return
    const source = store.findNode(start.nodeId)
    if (!source || loading.value || !store.ready.value) return
    openQuickAdd(
      source.id,
      { kinds: quickAddKindsOf(source), clientX: point.clientX, clientY: point.clientY },
      { atPoint: true, sourceHandle: start.handleId ?? undefined },
    )
    return
  }
  // 落在端口上但没连成：Vue Flow 的校验已经拒了（isValidConnection），不再按主体兜底
  if (handleEl) return
  const hoveredId = nodeEl.dataset.id
  if (!hoveredId || hoveredId === start.nodeId) return
  const startNode = store.findNode(start.nodeId)
  const hovered = store.findNode(hoveredId)
  if (!startNode || !hovered) return
  if (start.handleType && start.handleType !== 'source') {
    // 从输入口反向拖到另一个节点主体：反过来连——被悬停的节点当来源（它的输出口），起点节点的这个输入口当目标；
    // 能不能连由 store.connect 里的 validateConnection 判（不合规会提示原因）
    if (!start.handleId) return
    store.connect({
      source: hovered.id,
      target: startNode.id,
      sourceHandle: outputHandleOf(hovered),
      targetHandle: start.handleId,
    })
    return
  }
  const sourceHandle = start.handleId ?? outputHandleOf(startNode)
  const targetHandle = autoTargetHandle(startNode, hovered)
  store.connect({ source: startNode.id, target: hoveredId, sourceHandle, targetHandle })
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

/** 端口「+」可接的下游种类（与各节点组件里 NodeQuickAdd 的 kinds 一致；拖线到空白处打开添加面板用） */
function quickAddKindsOf(node: CanvasEditorNode): QuickAddKind[] {
  if (node.type === 'text') return ['image-model', 'video-model']
  if (node.type === 'video') return ['video-model']
  if (node.type === 'model' && node.data.inputOnly) return ['video-model']
  if (node.type === 'tool' && node.data.tool === 'i2p') return ['image-model', 'video-model']
  return ['image-model', 'video-model', 'tool']
}

/** 节点的输出口 id（与各节点组件里 source Handle 的 id 一致） */
function outputHandleOf(node: CanvasEditorNode): string {
  if (node.type === 'text') return 'text'
  if (node.type === 'video') return 'video'
  if (node.type === 'image') return 'image'
  if (node.type === 'tool') return node.data.tool === 'i2p' ? 'text' : 'image-out'
  return node.data.inputOnly ? 'video' : 'image-out'
}

/**
 * 新建节点后自动从来源节点连过去（端口「+」→ 添加面板；新建 / 连线 / 校验全走 store 既有方法）。
 * sourceHandle：拖线起点的具体输出口（候选单独连出的 candidate-N 等），不传按节点默认输出口。
 */
function connectFrom(sourceId: string, targetId: string, sourceHandle?: string) {
  const source = store.findNode(sourceId)
  const target = store.findNode(targetId)
  if (!source || !target) return
  store.connect({
    source: source.id,
    target: target.id,
    sourceHandle: sourceHandle || outputHandleOf(source),
    targetHandle: autoTargetHandle(source, target),
  })
}

// ---------------- 删除 / 快捷键 ----------------

function deleteSelection() {
  ctxMenu.value = null
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
  // 校色弹窗（含点选 / 涂抹子弹窗）开着、或焦点在任一弹窗里：其余快捷键归弹窗，不碰画布（⌘Z / Backspace 误删节点）
  if (activeColorFix.value) return
  const eventTarget = event.target as HTMLElement | null
  if (eventTarget?.closest?.('.n-modal, .n-dialog, [role="dialog"]')) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  // 控制台 / 添加面板里的下拉、开关等控件聚焦时，按键归控件（避免 Backspace 误删节点）
  if (target?.closest('[data-canvas-console], [data-canvas-popover]')) return
  if (event.key === 'Escape') {
    if (ctxMenu.value) {
      closeCtxMenu()
      return
    }
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
  // 剪贴板（2026-11-06 二轮）：C 复制 / V 粘贴 / X 剪切 / D 再制
  // 焦点在可编辑区，或页面上有选中的文字（如节点里的提示词）：复制 / 剪切 / 粘贴交还浏览器原生行为
  if ((event.ctrlKey || event.metaKey) && ['c', 'v', 'x'].includes(event.key.toLowerCase())) {
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
    if (event.key.toLowerCase() !== 'v' && window.getSelection()?.toString()) return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    // 不拦默认：让浏览器派发 copy 事件，onWindowCopy 借它把系统剪贴板换成节点标记（见 markNodeCopy）
    markNodeCopy(copySelection())
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
    // 不在 keydown 拦默认：浏览器要照常派发 paste 事件，剪贴板里有图片文件时交给上传区（节点上传块 / 舞台）。
    // 粘贴节点改在 onWindowPaste 里做；个别浏览器在非可编辑区不派发 paste，120ms 兜底照样粘贴节点
    if (event.repeat) return
    window.clearTimeout(nodePasteTimer)
    nodePasteTimer = window.setTimeout(() => {
      nodePasteTimer = 0
      pasteClipboard()
    }, 120)
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
    const before = clipboard.value
    cutSelection()
    markNodeCopy(clipboard.value !== before)
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    duplicateSelection()
    return
  }
  if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    openHelp()
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

/** Ctrl/⌘+V 之后等 paste 事件的计时器（见 onKeydown） */
let nodePasteTimer = 0

/**
 * 复制 / 剪切节点后，把系统剪贴板换成一条画布内部标记（不带文字，粘到别处是空的）：
 * 否则系统剪贴板里还留着之前截的图，Ctrl+V 会被上传区当图片接走，节点粘贴不出来——以最后一次复制为准。
 * 个别浏览器无选区时不派发 copy 事件，此时系统剪贴板不变（退回旧行为）
 */
const NODE_CLIPBOARD_MIME = 'application/x-fusion-canvas-nodes'
let nodeCopyPending = false
function markNodeCopy(copied: boolean) {
  if (!copied) return
  nodeCopyPending = true
  window.setTimeout(() => (nodeCopyPending = false))
}
function onWindowCopy(event: ClipboardEvent) {
  if (!nodeCopyPending || !event.clipboardData) return
  nodeCopyPending = false
  event.clipboardData.setData(NODE_CLIPBOARD_MIME, '1')
  event.preventDefault()
}

/** window 冒泡阶段：上传区（document 级粘贴路由）已接走文件时不再粘贴节点；剪贴板只有文字 / 为空时粘贴节点 */
function onWindowPaste(event: ClipboardEvent) {
  if (!nodePasteTimer) return
  window.clearTimeout(nodePasteTimer)
  nodePasteTimer = 0
  if (event.defaultPrevented || clipboardFiles(event.clipboardData).length) return
  pasteClipboard()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onWindowPaste)
  window.addEventListener('copy', onWindowCopy)
  window.addEventListener('cut', onWindowCopy)
})
onBeforeUnmount(() => {
  window.clearTimeout(nodePasteTimer)
  window.removeEventListener('paste', onWindowPaste)
  window.removeEventListener('copy', onWindowCopy)
  window.removeEventListener('cut', onWindowCopy)
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
  // 失败原因可能很长：小标只写「未保存」，原因放进悬停 title
  if (saveState.value === 'error') return '未保存'
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
  if (saveState.value === 'error') return 'bg-danger-soft text-danger'
  if (saveState.value === 'conflict') return 'bg-warning-soft text-warning'
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
  return node && ((node.type === 'model' && !node.data.inputOnly) || node.type === 'tool') ? node : undefined
})

/** 画布上全部可执行的节点（生成 / 工具，参考素材节点除外）：没有选中时「执行模型」跑这些 */
const runnableAll = computed(() =>
  nodes.value.filter((node) => (node.type === 'model' && !node.data.inputOnly) || node.type === 'tool'),
)

/** 当前「执行」的范围：多选 → 选区；单选了可执行节点 → 它；否则 → 全部可执行节点 */
const runScope = computed<'selection' | 'single' | 'all'>(() => {
  if (selectedFlowNodes.value.length > 1) return 'selection'
  if (runTarget.value) return 'single'
  return 'all'
})

const runDisabled = computed(() => batchRunning.value || (runScope.value === 'all' && !runnableAll.value.length))

const runHint = computed(() => {
  if (runScope.value === 'selection') return `按上下游顺序执行选中的 ${selectedFlowNodes.value.length} 个节点`
  if (runScope.value === 'single') return `执行选中的「${runTarget.value?.data.title ?? ''}」`
  return runnableAll.value.length
    ? `执行画布上全部 ${runnableAll.value.length} 个模型 / 工具节点（按依赖顺序）；选中节点则只执行选中的`
    : '画布上还没有可执行的生成或工具节点'
})

/** 顶栏 / 底栏「执行」：多选按选区、单选执行该节点、没有选中执行全部（同一个费用确认） */
function runSelected() {
  if (runDisabled.value) return
  if (runScope.value === 'selection') {
    void confirmAndRun(selectedFlowNodes.value.map((node) => node.id))
    return
  }
  if (runScope.value === 'single' && runTarget.value) {
    void confirmAndRun([runTarget.value.id])
    return
  }
  void confirmAndRun(
    runnableAll.value.map((node) => node.id),
    'all',
  )
}

// ---------------- 计费（2026-11-06 二轮）：执行前费用确认 + 余额不足拦截；预扣 / 退回由 store toast ----------------

const balance = ref<number | null>(null)
const userInfoStore = useUserInfoStore()

/** 刷新余额：本页确认弹窗用 balance，顶栏余额胶囊读 userInfo store，两边一起回写 */
async function refreshBalance() {
  try {
    const res = await getPointsBalance()
    const value = res.data?.balance
    balance.value = typeof value === 'number' ? value : null
    if (typeof value === 'number' && userInfoStore.userInfo) userInfoStore.userInfo.availablePoints = value
  } catch {
    balance.value = null
  }
}
onMounted(() => void refreshBalance())

/** 单节点预估：按 catalog 价目表匹配尺寸 / 时长 × 张数（与控制台价格提示同一口径） */
function estimateNodeCredits(nodeId: string): number {
  const node = store.findNode(nodeId)
  if (!node || node.type !== 'model') return 0
  const list = node.data.kind === 'video' ? store.catalog.value?.video_models : store.catalog.value?.imageModels
  const model = list?.find((m) => m.modelId === (node.data.modelId || m.modelId))
  const prices = model?.prices ?? []
  if (!prices.length) return 0
  const size = node.data.size
  const duration = node.data.duration
  const hit =
    prices.find((p) => (size ? p.size === size : true) && (duration ? p.duration === duration : true)) ?? prices[0]
  if (!hit) return 0
  const count = node.data.kind === 'video' ? 1 : Math.max(1, node.data.count ?? 1)
  return hit.points * count
}

/** 执行占用中（从点「执行」那一刻起，到费用确认取消 / 提交结束 / 批量收尾）：期间再点一律忽略 */
const batchRunning = ref(false)
/** 真的在跑批量（确认之后）：只用于按钮文案 / 转圈，占用判断看 batchRunning */
const batchActive = ref(false)
/** 每次执行一个令牌：收尾只释放自己那一次，不会把后一批的占用状态清掉 */
let runToken = 0
function releaseRun(token: number) {
  if (token !== runToken) return
  batchRunning.value = false
  batchActive.value = false
}

/**
 * 执行前确认（2026-11-06 二轮）：先刷新余额，点数不足直接拦下不弹窗；够就弹确认（节点数 / 预计消耗 / 余额）。
 * 已在提交 / 排队 / 运行的节点不重复提交（汇总里记「已在运行」，不算失败），预计点数也不算它们。
 * 一个节点直接执行；多个节点走 runBatch（按依赖提交 + 一条会自更新的进度提示 + 一条汇总）。
 */
async function confirmAndRun(ids: string[], scope: 'pick' | 'all' = 'pick'): Promise<void> {
  // 入口就占住（在 await 刷新余额之前），双击 / 连点第二下直接忽略
  if (batchRunning.value) {
    editorMessage.warning('上一批还在执行，请等它结束')
    return
  }
  const token = ++runToken
  batchRunning.value = true
  let handedOff = false
  try {
    const executable = executableInOrder(
      ids.map((id) => store.findNode(id)).filter((node): node is CanvasEditorNode => Boolean(node)),
    )
    if (!executable.length) {
      editorMessage.warning(
        scope === 'all' ? '画布上还没有可执行的生成或工具节点' : '选中的节点里没有可执行的生成或工具节点',
      )
      return
    }
    const running = executable.filter((id) => store.isNodeBusy(id))
    const toRun = executable.filter((id) => !store.isNodeBusy(id))
    if (!toRun.length) {
      editorMessage.info(
        running.length === 1
          ? `「${store.findNode(running[0]!)?.data.title ?? '节点'}」已在运行`
          : `这 ${running.length} 个节点都已在运行`,
      )
      return
    }
    const estimate = toRun.reduce((sum, id) => sum + estimateNodeCredits(id), 0)
    const hasVideo = toRun.some((id) => store.findNode(id)?.data.kind === 'video')
    const hasTool = toRun.some((id) => store.findNode(id)?.type === 'tool')
    await refreshBalance()
    // 点数不足：直接拦下不弹确认（与提交时服务端口径一致，避免确认后才失败）
    if (balance.value != null && balance.value < estimate) {
      editorMessage.error(`点数不足：本次预计需要 ${estimate} 点，当前余额 ${balance.value} 点`)
      return
    }
    const notes = [
      running.length ? `另有 ${running.length} 个节点已在运行，不重复提交。` : '',
      hasVideo ? '视频按所选时长计费，已计入上方预计点数。' : '',
      hasTool ? '工具节点按功能单独计价，未计入上方预计。' : '',
      '提交即预扣，失败 / 取消自动退回。',
    ].filter(Boolean)
    /** 三格数据（原型 .wf-runconfirm__facts：min-h 56 / r12 / 0.8px #ececef / #fbfbfc；数字 16/600 tabular） */
    const fact = (value: string, label: string): VNode =>
      h(
        'span',
        {
          class:
            'flex min-h-56px flex-col justify-center gap-2px px-10px py-8px border-[0.8px] border-solid border-line rounded-12px bg-surface2 text-muted text-11px',
        },
        [h('b', { class: 'text-ink text-16px font-600 tabular-nums leading-22px' }, value), label],
      )
    const countLabel = hasTool ? '个待执行节点' : '个模型节点'
    const title = scope === 'all' ? '执行全部模型节点' : toRun.length > 1 ? `执行 ${toRun.length} 个节点` : '执行前确认'
    const lead =
      toRun.length > 1
        ? '按依赖顺序执行，上游完成后才提交下游。'
        : `执行「${store.findNode(toRun[0]!)?.data.title ?? '节点'}」。`
    await new Promise<void>((resolve) => {
      editorDialog.info({
        title,
        style: { width: '380px', maxWidth: 'calc(100vw - 32px)' },
        content: () =>
          h('div', [
            h('p', { class: 'm-0 text-muted text-12px leading-18px' }, lead),
            h('div', { class: 'grid grid-cols-3 gap-8px mt-14px mb-4px' }, [
              fact(String(toRun.length), countLabel),
              fact(estimate.toLocaleString(), '预计点数'),
              fact(balance.value != null ? balance.value.toLocaleString() : '—', '当前余额'),
            ]),
            ...notes.map((note) => h('p', { class: 'm-0 mt-8px text-muted text-11px leading-[1.5]' }, note)),
          ]),
        positiveText: '开始执行',
        negativeText: '取消',
        onPositiveClick: () => {
          handedOff = true
          resolve()
          if (toRun.length === 1 && !running.length) {
            void store
              .runNode(toRun[0]!)
              .then(() => refreshBalance())
              .finally(() => releaseRun(token))
          } else {
            void runBatch(toRun, running, token)
          }
        },
        onNegativeClick: () => resolve(),
        onClose: () => resolve(),
        onMaskClick: () => resolve(),
        onAfterLeave: () => resolve(),
      })
    })
  } finally {
    if (!handedOff) releaseRun(token)
  }
}

type BatchState = 'done' | 'error' | 'unknown' | 'skipped'

/**
 * 批量执行（原型 runAll）：每个节点是一个独立的异步任务，只等自己在本批（含已在运行）里的上游落定——
 * 上游成功才提交，上游失败 / 跳过则跳过；互不依赖的链各走各的，不互相阻塞。
 * running = 确认时已在运行的节点：不重复提交，但下游照样等它们的结果；汇总里记「已在运行」。
 * 退回提示只算本批提交成功、之后失败的节点（提交就失败的没扣点，已在运行的不是本批扣的）。
 */
async function runBatch(order: string[], running: string[], token: number) {
  batchActive.value = true
  const inSet = new Set([...order, ...running])
  const tasks = new Map<string, Promise<BatchState>>()
  const submittedIds = new Set<string>()
  let submitted = 0
  let finished = 0
  const progress = editorMessage.loading('准备执行…', { duration: 0 })
  const updateProgress = (title?: string) => {
    const head = title ? `正在提交「${title}」 · ` : ''
    progress.content = `${head}已提交 ${submitted}/${order.length} · 已完成 ${finished}`
  }
  const runOne = async (id: string): Promise<BatchState> => {
    // 先让出一拍：所有任务都登记进 tasks 之后再取上游，登记顺序不影响依赖
    await Promise.resolve()
    const deps = edges.value.filter((edge) => edge.target === id && inSet.has(edge.source)).map((edge) => edge.source)
    const upstream = await Promise.all(deps.map((dep) => tasks.get(dep) ?? Promise.resolve<BatchState>('unknown')))
    if (upstream.some((state) => state !== 'done')) return 'skipped'
    updateProgress(store.findNode(id)?.data.title)
    const ok = await store.runNode(id, { quiet: true })
    if (!ok) return 'error'
    submittedIds.add(id)
    submitted += 1
    updateProgress()
    const state = await store.waitForSettled(id)
    finished += 1
    updateProgress()
    return state
  }
  try {
    for (const id of running) tasks.set(id, store.waitForSettled(id))
    for (const id of order) tasks.set(id, runOne(id))
    const states = await Promise.all(order.map((id) => tasks.get(id) ?? Promise.resolve<BatchState>('unknown')))
    const done = states.filter((state) => state === 'done').length
    const failedIds = order.filter((_, index) => states[index] === 'error')
    const unknown = states.filter((state) => state === 'unknown').length
    const skipped = states.filter((state) => state === 'skipped').length
    const refunded = failedIds.filter((id) => submittedIds.has(id)).reduce((sum, id) => sum + store.runChargeOf(id), 0)
    const parts = [`成功 ${done}`]
    if (failedIds.length) parts.push(`失败 ${failedIds.length}`)
    if (skipped) parts.push(`跳过 ${skipped}（上游未成功）`)
    if (running.length) parts.push(`已在运行 ${running.length}（未重复提交）`)
    if (unknown) parts.push(`${unknown} 个仍在运行，稍后刷新查看`)
    const tail = refunded > 0 ? `；失败节点预扣的 ${refunded} 点将退回` : ''
    if (failedIds.length || skipped) editorMessage.warning(`执行结束：${parts.join('，')}${tail}`, { duration: 6000 })
    else editorMessage.success(`执行完成：${parts.join('，')}`)
  } finally {
    progress.destroy()
    store.endQuiet(order)
    releaseRun(token)
    void refreshBalance()
  }
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

/**
 * 从模板插入（templateInsert.ts）：模板整块放到现有节点下方（空画布放视口左上），节点 / 连线换新 id，
 * 插入后视口对准插入的那一块。画布首页的「从模板新建画布」不走这里。
 */
function onInsertTemplate(template: ICanvasTemplateDetail) {
  if (!store.ready.value) return
  const rect = stageRef.value?.getBoundingClientRect()
  const emptyAt = rect
    ? screenToFlowCoordinate({ x: rect.left + Math.max(80, rect.width / 2 - 260), y: rect.top + 120 })
    : undefined
  const clip = buildTemplateClipboard(template.snapshot, store.nodes.value, template.title, emptyAt)
  if (!clip) {
    editorMessage.warning('这个模板没有可插入的节点')
    return
  }
  const ids = store.pasteClipboard(clip, 0)
  if (!ids.length) return
  editorMessage.success(`已插入模板「${template.title}」`)
  void nextTick(() => fitView({ nodes: ids, padding: 0.2, duration: 220, minZoom: 0.2, maxZoom: 1 }))
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
/** 整页容器：CanvasTip 在这里面找 data-tip */
const pageEl = ref<HTMLElement | null>(null)
/** 面板位置（相对舞台）+ 新节点落点（画布坐标）+ 端口「+」的来源节点与可选种类 */
const addPanel = ref<{
  x: number
  y: number
  spawnAt?: { x: number; y: number }
  anchorId?: string
  /** 来源节点上的具体输出口（拖线松手时起点端口，如 candidate-2）；不传按节点默认输出口 */
  anchorHandle?: string
  /** 拖线到空白处打开：「添加文字」也落在松手点 */
  dropped?: boolean
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
  // 横向贴着左竖工具条右缘 + 12（工具条 left 12 + 宽 46 ≈ 58）
  addPanel.value = addPanel.value && !addPanel.value.spawnAt ? null : { x: 72, y: 28 }
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

/**
 * 端口「+」：面板开在「+」旁，只列可接到下游的种类；新节点落在「+」右侧并自动连线。
 * atPoint = 拖线松手在空白处：新节点就落在松手点（不再右移 60）。
 */
function openQuickAdd(
  sourceId: string,
  request: IQuickAddRequest,
  opts: { atPoint?: boolean; sourceHandle?: string } = {},
) {
  selectedEdgeId.value = ''
  store.selectNode(sourceId)
  const atPoint = Boolean(opts.atPoint)
  const flow = screenToFlowCoordinate({ x: request.clientX + (atPoint ? 0 : 60), y: request.clientY })
  addPanel.value = {
    ...panelPoint(request.clientX + 8, request.clientY),
    spawnAt: { x: flow.x, y: flow.y - 40 },
    anchorId: sourceId,
    anchorHandle: opts.sourceHandle,
    dropped: atPoint,
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
  if (created && panel?.anchorId) connectFrom(panel.anchorId, created.id, panel.anchorHandle)
}

/**
 * 端口「+」/ 拖线到空白处的「添加文字」：文字节点没有输入口，不连线。
 * 拖线松手打开的面板落在松手点；点「+」打开的沿用来源节点右侧的空位。
 */
function addQuickText() {
  const panel = addPanel.value
  closeAddPanel()
  if (!panel?.anchorId) return
  const created =
    panel.dropped && panel.spawnAt
      ? store.addNode('text', undefined, panel.spawnAt)
      : store.addTextNodeNear(panel.anchorId)
  if (created) store.selectNode(created.id)
}

// ---------------- 多选操作条（原型 .wf-selection-bar：执行 / 复制 / 删除 / 取消选择） ----------------

/** Vue Flow 框选 / 多选出来的节点（只认仍在画布上的） */
const showAlignPop = ref(false)

const selectedFlowNodes = computed(() =>
  (getSelectedNodes.value ?? [])
    .map((node) => store.findNode(node.id))
    .filter((node): node is CanvasEditorNode => Boolean(node)),
)

/** 多选条出现与否的信号（对齐弹层跟着收） */
const selectedFlowNodesCount = computed(() => selectedFlowNodes.value.length)
// 写在 selectedFlowNodesCount 定义之后：watch 创建时会立即求值一次 getter，提前写会 TDZ 报错白屏
watch(selectedFlowNodesCount, () => {
  showAlignPop.value = false
})

function clearFlowSelection() {
  showAlignPop.value = false
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

function runSelectionNodes() {
  void confirmAndRun(selectedFlowNodes.value.map((node) => node.id))
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

// ---------------- 剪贴板（2026-11-06 二轮：Ctrl+C/V/X/D，带组内连线，新 id、偏移 48、清运行态） ----------------

/**
 * 剪贴板：复制 / 剪切那一刻的深拷贝（节点 + 组内连线，选中分组底板时连成员一起），粘贴从快照生成新 id，
 * 剪切后原节点已删也能粘贴；同一份快照每粘一次多错开 48px，连粘不叠在一起。
 */
const clipboard = ref<ICanvasClipboard | null>(null)
let pasteTimes = 0

function selectionIds(): string[] {
  if (selectedFlowNodes.value.length) return selectedFlowNodes.value.map((node) => node.id)
  return selectedNode.value ? [selectedNode.value.id] : []
}

/** 选区里的普通节点数（不含分组底板），提示文案用 */
function countMembers(ids: string[]): number {
  return ids.filter((id) => store.findNode(id)?.type !== 'module').length
}

function copySelection(): boolean {
  const snap = store.snapshotForClipboard(selectionIds())
  if (!snap) {
    editorMessage.warning('先选中节点再复制')
    return false
  }
  clipboard.value = snap
  pasteTimes = 0
  editorMessage.success(`已复制 ${countMembers(snap.nodes.map((node) => node.id))} 个节点，Ctrl+V 粘贴`)
  return true
}

function cutSelection() {
  const ids = selectionIds()
  const snap = store.snapshotForClipboard(ids)
  if (!snap) return
  clipboard.value = snap
  // 剪切后第一次粘贴落回原位附近（偏移 0 起算），之后照常错开
  pasteTimes = -1
  const removed = store.removeNodes(snap.nodes.map((node) => node.id))
  clearFlowSelection()
  if (removed)
    editorMessage.success(`已剪切 ${countMembers(snap.nodes.map((node) => node.id)) || removed} 个节点，Ctrl+V 粘贴`)
}

function pasteClipboard() {
  const snap = clipboard.value
  if (!snap) {
    editorMessage.warning('剪贴板里还没有节点')
    return
  }
  pasteTimes += 1
  const created = store.pasteClipboard(snap, 48 * pasteTimes)
  if (!created.length) return
  clearFlowSelection()
  const first = created.find((id) => store.findNode(id)?.type !== 'module') ?? created[0]
  if (first) store.selectNode(first)
  editorMessage.success(`已粘贴 ${countMembers(created) || created.length} 个节点`)
}

/** 再制（Ctrl+D / 多选条「复制」/ 右键「复制」）：不占剪贴板，原地偏移 48 生成一份 */
function duplicateSelection(ids = selectionIds()) {
  if (!ids.length) return
  const created = store.duplicateNodes(ids, 48)
  if (!created.length) return
  clearFlowSelection()
  const first = created.find((id) => store.findNode(id)?.type !== 'module') ?? created[0]
  if (first) store.selectNode(first)
  editorMessage.success(`已复制 ${countMembers(created) || created.length} 个节点`)
}

// ---------------- 对齐分布（2026-11-06 二轮：6 种对齐 + 水平 / 垂直等距，锁定节点跳过） ----------------

type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 参与对齐 / 分布的节点（尺寸从 Vue Flow 运行时 dimensions 读，读不到按 data / 常见值兜底） */
function alignableNodes(): { node: CanvasEditorNode; x: number; y: number; w: number; h: number }[] {
  return selectedFlowNodes.value
    .filter((node) => node.type !== 'module' && !store.isLocked(node.id))
    .map((node) => {
      const dims = (node as unknown as { dimensions?: { width?: number; height?: number } }).dimensions
      return {
        node,
        x: node.position.x,
        y: node.position.y,
        w: dims?.width ?? node.data.width ?? 260,
        h: dims?.height ?? node.data.height ?? 160,
      }
    })
}

function alignSelection(kind: AlignKind) {
  const items = alignableNodes()
  if (items.length < 2) return
  const minX = Math.min(...items.map((it) => it.x))
  const maxX = Math.max(...items.map((it) => it.x + it.w))
  const minY = Math.min(...items.map((it) => it.y))
  const maxY = Math.max(...items.map((it) => it.y + it.h))
  for (const it of items) {
    let nx = it.x
    let ny = it.y
    if (kind === 'left') nx = minX
    else if (kind === 'hcenter') nx = (minX + maxX) / 2 - it.w / 2
    else if (kind === 'right') nx = maxX - it.w
    else if (kind === 'top') ny = minY
    else if (kind === 'vcenter') ny = (minY + maxY) / 2 - it.h / 2
    else if (kind === 'bottom') ny = maxY - it.h
    it.node.position = { x: Math.round(nx), y: Math.round(ny) }
  }
  editorMessage.success('已对齐')
}

function distributeSelection(axis: 'h' | 'v') {
  const items = alignableNodes()
  if (items.length < 3) {
    editorMessage.warning('等距分布至少要选 3 个节点')
    return
  }
  const sorted = [...items].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y))
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const spanOf = (it: { x: number; y: number; w: number; h: number }) => (axis === 'h' ? it.w : it.h)
  const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y
  const occupied = sorted.reduce((sum, it) => sum + spanOf(it), 0)
  const gap = (total - occupied) / (sorted.length - 1)
  let cursor = axis === 'h' ? first.x : first.y
  for (const it of sorted) {
    if (axis === 'h') {
      it.node.position = { x: Math.round(cursor), y: it.y }
      cursor += it.w + gap
    } else {
      it.node.position = { x: it.x, y: Math.round(cursor) }
      cursor += it.h + gap
    }
  }
  editorMessage.success('已等距分布')
}

// ---------------- 锁定 / 成组 / 解组 / 缩放到选区（多选操作条 + 右键菜单共用） ----------------

/** 选区是否全部已锁（多选条按钮文案：全锁 → 解锁，否则 → 锁定） */
const selectionAllLocked = computed(() => {
  const ids = selectedFlowNodes.value.map((node) => node.id)
  return ids.length > 0 && ids.every((id) => store.isLocked(id))
})

function toggleLockSelection() {
  const ids = selectionIds()
  if (!ids.length) return
  const lock = !ids.every((id) => store.isLocked(id))
  store.setLocked(ids, lock)
  editorMessage.success(lock ? `已锁定 ${ids.length} 个节点` : `已解锁 ${ids.length} 个节点`)
}

function groupSelection() {
  const ids = selectionIds().filter((id) => store.findNode(id)?.type !== 'module')
  if (ids.length < 2) {
    editorMessage.warning('选择两个及以上节点再成组')
    return
  }
  const id = store.createModule(ids)
  if (id) editorMessage.success('已成组：拖动虚线底板可整组移动')
}

/** 选区里恰好有一块成组底板时给「解组」 */
const singleGroupId = computed(() => {
  const plates = selectedFlowNodes.value.filter((node) => isGroupPlate(node))
  return plates.length === 1 ? (plates[0]?.id ?? '') : ''
})

function ungroupSelection() {
  const id = singleGroupId.value
  if (!id) return
  if (store.ungroup(id)) editorMessage.success('已解组，成员原位保留')
}

/** 缩放到选区（多选条「聚焦」/ 右键）：没有多选时用当前选中节点 */
function zoomToSelection(ids = selectionIds()) {
  if (!ids.length) return
  void fitView({ nodes: ids, padding: 0.2, duration: 220, minZoom: 0.2, maxZoom: 1.2 })
}

// ---------------- 模块拖动带成员（锁定成员也跟着走；node-drag 实时同步，落点即成员落点） ----------------

let moduleDrag: {
  id: string
  baseX: number
  baseY: number
  members: { node: CanvasEditorNode; x: number; y: number }[]
} | null = null

function onNodeDragStart(payload: { node: { id: string; position: { x: number; y: number } } }) {
  const full = store.findNode(payload.node.id)
  if (!full || !isGroupPlate(full)) return
  moduleDrag = {
    id: payload.node.id,
    baseX: payload.node.position.x,
    baseY: payload.node.position.y,
    members: store
      .moduleChildren(payload.node.id)
      .map((child) => ({ node: child, x: child.position.x, y: child.position.y })),
  }
}

function onNodeDrag(payload: { node: { id: string; position: { x: number; y: number } } }) {
  const drag = moduleDrag
  if (!drag || drag.id !== payload.node.id) return
  const dx = payload.node.position.x - drag.baseX
  const dy = payload.node.position.y - drag.baseY
  for (const member of drag.members) {
    member.node.position = { x: member.x + dx, y: member.y + dy }
  }
}

function onNodeDragStop(payload: { node: { id: string; position: { x: number; y: number } } }) {
  if (moduleDrag?.id === payload.node.id) moduleDrag = null
}

// ---------------- 画布右键菜单 + 节点菜单（右键与节点「…」共用 nodeMenuGroups 一份定义） ----------------

interface CtxMenu {
  x: number
  y: number
  kind: 'pane' | 'node'
  nodeId?: string
  /** 节点菜单的二级视图：模型替换列表 */
  view?: 'models'
  /** 画布右键处的视口坐标（「添加节点」面板与新节点落在这里） */
  clientX?: number
  clientY?: number
}

const ctxMenu = ref<CtxMenu | null>(null)
const CTX_MENU_W = 208

function stagePoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect) return { x: clientX, y: clientY }
  return {
    x: Math.max(8, Math.min(clientX - rect.left, rect.width - CTX_MENU_W - 8)),
    y: Math.max(8, clientY - rect.top),
  }
}

/** 菜单渲染后按实际高度夹回舞台（节点菜单最多十几行，固定估高会出底），并把焦点给第一项 */
function settleCtxMenu() {
  void nextTick(() => {
    const el = ctxMenuEl.value
    const rect = stageRef.value?.getBoundingClientRect()
    const menu = ctxMenu.value
    if (!el || !rect || !menu) return
    const maxY = Math.max(8, rect.height - el.offsetHeight - 8)
    if (menu.y > maxY) ctxMenu.value = { ...menu, y: maxY }
    el.querySelector<HTMLElement>(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemradio"]:not(:disabled)',
    )?.focus({ preventScroll: true })
  })
}

/** 菜单关闭后焦点还给谁：节点「…」= 那个按钮；右键 = 打开前的焦点（是 body 就不还） */
let menuReturnFocus: HTMLElement | null = null
function rememberMenuFocus(trigger?: HTMLElement | null) {
  const active = trigger ?? (document.activeElement as HTMLElement | null)
  menuReturnFocus = active && active !== document.body && !ctxMenuEl.value?.contains(active) ? active : null
}

function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  rememberMenuFocus()
  ctxMenu.value = {
    kind: 'pane',
    clientX: event.clientX,
    clientY: event.clientY,
    ...stagePoint(event.clientX, event.clientY),
  }
  settleCtxMenu()
}

function onNodeContextMenu(event: NodeMouseEvent) {
  event.event.preventDefault()
  const source = event.event as MouseEvent
  store.selectNode(event.node.id)
  rememberMenuFocus()
  ctxMenu.value = { kind: 'node', nodeId: event.node.id, ...stagePoint(source.clientX, source.clientY) }
  settleCtxMenu()
}

/** 节点「…」：菜单开在「…」下方 4px、右缘对齐（再次点同一个「…」收起） */
function openNodeMenuAt(nodeId: string, anchor: DOMRect, trigger?: HTMLElement) {
  if (ctxMenu.value?.kind === 'node' && ctxMenu.value.nodeId === nodeId && !ctxMenu.value.view) {
    closeCtxMenu()
    return
  }
  selectedEdgeId.value = ''
  closeAddPanel()
  store.selectNode(nodeId)
  rememberMenuFocus(trigger ?? null)
  ctxMenu.value = { kind: 'node', nodeId, ...stagePoint(anchor.right - CTX_MENU_W, anchor.bottom + 4) }
  settleCtxMenu()
}
provide(NODE_MENU_HOST, { open: openNodeMenuAt })

/**
 * 收起菜单（Esc / 选了一项 / 再点「…」/ Tab 移出）：焦点还给打开它的「…」或原焦点。
 * 点菜单外部收起不走这里（onOutsidePointerDown 直接置空），不抢用户刚点到的地方的焦点。
 */
function closeCtxMenu() {
  if (!ctxMenu.value) return
  ctxMenu.value = null
  const back = menuReturnFocus
  menuReturnFocus = null
  if (back?.isConnected) back.focus({ preventScroll: true })
}

/** 二级视图（模型替换）退回主菜单 */
function ctxMenuBack() {
  if (!ctxMenu.value?.view) return
  ctxMenu.value = { ...ctxMenu.value, view: undefined }
  settleCtxMenu()
}

/** 菜单内上下键移动焦点（Home / End 到首尾）；Esc 先退一级（二级视图 → 主菜单）再关闭；Tab 移出即收起 */
function onCtxMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    if (ctxMenu.value?.view) ctxMenuBack()
    else closeCtxMenu()
    return
  }
  if (event.key === 'Tab') {
    // 焦点先还给「…」，再让浏览器的 Tab 从它往后走（不拦默认行为）
    closeCtxMenu()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = Array.from(
    ctxMenuEl.value?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemradio"]:not(:disabled)',
    ) ?? [],
  )
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  let next = 0
  if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length
  else if (event.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1
  items[next]?.focus()
}

// 点外部收起浮层（右键菜单 / 导出菜单 / 对齐弹层）：在 document 捕获阶段判断，不铺全屏遮罩，
// 这样滚轮缩放照常、在别处右键会先收起旧菜单再由画布在新位置弹出
const ctxMenuEl = ref<HTMLElement | null>(null)
const exportWrapEl = ref<HTMLElement | null>(null)
const alignWrapEl = ref<HTMLElement | null>(null)
const alignPopEl = ref<HTMLElement | null>(null)
function onOutsidePointerDown(event: PointerEvent) {
  const target = event.target as Element | null
  if (!target) return
  // 点节点「…」由 openNodeMenuAt 自己开关，这里不先收（否则收起后又被同一次点击重新打开）
  if (ctxMenu.value && !ctxMenuEl.value?.contains(target) && !target.closest?.('[data-node-menu-trigger]')) {
    ctxMenu.value = null
  }
  if (showExportMenu.value && !exportWrapEl.value?.contains(target)) showExportMenu.value = false
  if (showAlignPop.value && !alignWrapEl.value?.contains(target) && !alignPopEl.value?.contains(target)) {
    showAlignPop.value = false
  }
}
onMounted(() => document.addEventListener('pointerdown', onOutsidePointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutsidePointerDown, true))

const ctxNode = computed(() => (ctxMenu.value?.nodeId ? store.findNode(ctxMenu.value.nodeId) : undefined))

/** 右键「添加节点」：关菜单，面板开在右键处，新节点也落在那里 */
function ctxMenuAdd() {
  const menu = ctxMenu.value
  closeCtxMenu()
  if (!menu || menu.clientX == null || menu.clientY == null || loading.value || !store.ready.value) {
    openAddPanel()
    return
  }
  selectedEdgeId.value = ''
  addPanel.value = {
    ...panelPoint(menu.clientX, menu.clientY),
    spawnAt: screenToFlowCoordinate({ x: menu.clientX, y: menu.clientY }),
  }
}

function ctxMenuTemplates() {
  closeCtxMenu()
  showTemplates.value = true
}

function ctxMenuPaste() {
  closeCtxMenu()
  pasteClipboard()
}

function ctxMenuFit() {
  closeCtxMenu()
  void fitView({ padding: 0.18, duration: 200 })
}

function ctxMenuUndo() {
  closeCtxMenu()
  void undoCanvas()
}

function ctxMenuRedo() {
  closeCtxMenu()
  void redoCanvas()
}

// ---------- 节点菜单定义 ----------

interface INodeMenuItem {
  key: string
  label: string
  icon: string
  danger?: boolean
  disabled?: boolean
  /** 置灰原因 / 补充说明（悬停 title） */
  hint?: string
  /** 右侧快捷键提示 */
  kbd?: string
  run: () => void
}

/** 模板承接的结果图节点不可删（与节点组件里 NodeMenu removable 同口径） */
function isRemovable(node: CanvasEditorNode): boolean {
  return !(node.type === 'image' && node.data.kind === 'result' && !node.data.actionOrigin)
}

/** 节点是否挂图片动作（识别 / 图片编辑 / 多视图 / 图层；与各节点组件 imageActionsFor 同口径） */
function hasImageActions(node: CanvasEditorNode): boolean {
  if (node.type === 'image') return true
  if (node.type === 'tool') return node.data.tool !== 'i2p'
  if (node.type === 'model') return node.data.kind !== 'video' && !node.data.inputOnly
  return false
}

/** 先关菜单再做事（动作里可能弹窗 / 改选中） */
function menuAction(fn: (node: CanvasEditorNode) => void): () => void {
  return () => {
    const node = ctxNode.value
    closeCtxMenu()
    if (node) fn(node)
  }
}

const nodeMenuGroups = computed<INodeMenuItem[][]>(() => {
  const node = ctxNode.value
  if (!node) return []
  if (node.type === 'module') {
    const plate = isGroupPlate(node)
    const locked = store.isLocked(node.id)
    return [
      [
        { key: 'rename', label: '编辑名称', icon: 'rename', run: menuAction(openRename) },
        {
          key: 'copy',
          label: '复制（连成员）',
          icon: 'copy',
          kbd: `${MOD_KEY} D`,
          run: menuAction((n) => duplicateSelection([n.id])),
        },
        {
          key: 'lock',
          label: locked ? '解锁' : '锁定',
          icon: locked ? 'unlock' : 'lock',
          run: menuAction((n) => editorMessage.success(store.toggleLock(n.id) ? '已锁定' : '已解锁')),
        },
        {
          key: 'focus',
          label: '聚焦',
          icon: 'target',
          run: menuAction((n) => zoomToSelection([n.id, ...store.moduleChildren(n.id).map((c) => c.id)])),
        },
      ],
      [
        ...(plate
          ? [
              {
                key: 'ungroup',
                label: '解组',
                icon: 'folderOpen',
                run: menuAction((n) => store.ungroup(n.id) && editorMessage.success('已解组，成员原位保留')),
              },
            ]
          : []),
        {
          key: 'delete-group',
          label: plate ? '删除分组（含成员）' : '删除模块（含成员）',
          icon: 'trash',
          danger: true,
          run: menuAction((n) => confirmRemoveModule(n.id)),
        },
      ],
    ]
  }
  const media: INodeMenuItem[] = []
  if (node.data.video || node.data.image) {
    media.push({
      key: 'download',
      label: node.data.video ? '下载视频' : '下载原图',
      icon: 'download',
      run: menuAction(downloadNodeOutput),
    })
  }
  if (node.type === 'image') {
    const isResult = node.data.kind === 'result'
    media.push(
      {
        key: 'replace',
        label: node.data.image ? '替换图片' : '上传图片',
        icon: 'replace',
        disabled: isResult,
        hint: isResult ? '结果图由上游生成，不能手动替换' : undefined,
        // 交给节点自己的上传通道（useNodeUpload）：上传中遮罩 / 可取消 / 清 assetId·mediaId / 30MB 校验都在那里
        run: menuAction((n) => store.replaceNodeImage(n.id)),
      },
      { key: 'crop', label: '裁剪', icon: 'crop', run: menuAction((n) => spawnToolFrom(n, 'crop')) },
      { key: 'upscale', label: '高清放大', icon: 'sparkles', run: menuAction((n) => spawnToolFrom(n, 'upscale')) },
    )
  }
  const locked = store.isLocked(node.id)
  const edit: INodeMenuItem[] = [
    { key: 'rename', label: '编辑名称', icon: 'rename', run: menuAction(openRename) },
    {
      key: 'lock',
      label: locked ? '解锁节点' : '锁定节点',
      icon: locked ? 'unlock' : 'lock',
      run: menuAction((n) => editorMessage.success(store.toggleLock(n.id) ? '已锁定节点' : '已解锁节点')),
    },
  ]
  if (node.type === 'model' && !node.data.inputOnly) {
    edit.push({
      key: 'models',
      label: '模型替换',
      icon: 'swap',
      disabled: !modelOptionsOf(node).length,
      hint: modelOptionsOf(node).length ? undefined : '模型列表还没加载好',
      run: () => {
        if (ctxMenu.value) ctxMenu.value = { ...ctxMenu.value, view: 'models' }
        settleCtxMenu()
      },
    })
  }
  edit.push({
    key: 'copy',
    label: '复制',
    icon: 'copy',
    kbd: `${MOD_KEY} D`,
    run: menuAction((n) => duplicateSelection([n.id])),
  })

  const act: INodeMenuItem[] = []
  if (hasImageActions(node)) {
    const hasImage = collectImageSources(node.id).length > 0
    // 产物还在转存素材库：这些动作只认地址，等转存完（几秒）再用
    const blocked = store.mediaBlockReason(node.id)
    for (const item of IMAGE_ACTIONS) {
      act.push({
        key: `action:${item.kind}`,
        label: item.label,
        icon: item.icon,
        disabled: !hasImage,
        hint: hasImage ? undefined : blocked || '先上传或生成图片',
        run: menuAction((n) => openImageAction(n.id, item.kind)),
      })
    }
    const ownImage = colorFixSources(node.id).length > 0
    act.push({
      key: 'colorfix',
      label: '校色',
      icon: 'sliders',
      disabled: !ownImage,
      hint: ownImage ? '调整偏色（支持局部选区），生成新的结果图节点' : blocked || '这个节点还没有图片',
      run: menuAction((n) => openColorFix(n.id)),
    })
  }
  if ((node.type === 'model' && !node.data.inputOnly) || node.type === 'tool') {
    act.push({
      key: 'run',
      label: '执行节点',
      icon: 'play',
      disabled: batchRunning.value,
      run: menuAction((n) => void confirmAndRun([n.id])),
    })
  }
  act.push({ key: 'focus', label: '聚焦', icon: 'target', run: menuAction((n) => zoomToSelection([n.id])) })

  const removable = isRemovable(node)
  const danger: INodeMenuItem[] = [
    {
      key: 'delete',
      label: '删除',
      icon: 'trash',
      danger: true,
      kbd: 'Delete',
      disabled: !removable,
      hint: removable ? undefined : '模板结果节点不可删',
      run: menuAction((n) => store.removeNode(n.id)),
    },
  ]
  return [media, edit, act, danger].filter((group) => group.length)
})

function runMenuItem(item: INodeMenuItem) {
  if (item.disabled) return
  item.run()
}

function downloadNodeOutput(node: CanvasEditorNode) {
  const url = node.data.video || node.data.image
  if (!url) {
    editorMessage.warning('这个节点还没有可下载的输出')
    return
  }
  if (node.data.video) window.open(url, '_blank', 'noopener')
  else void downloadImage(url)
}

/** 裁剪 / 高清放大：在节点右侧新建对应工具节点并从它连过去（新建 / 连线都走 store 既有方法） */
function spawnToolFrom(node: CanvasEditorNode, tool: CanvasToolKind) {
  const width = node.data.width ?? 260
  const created = spawn('tool', tool, { x: node.position.x + width + 80, y: node.position.y })
  if (!created) return
  connectFrom(node.id, created.id)
  void nextTick(() => setCenter(created.position.x + 170, created.position.y + 160, { duration: 220 }))
}

// ---------- 图片类型（拖文件到空白画布用；大小上限与节点上传同一口径，见 useNodeUpload） ----------

const IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp']

// ---------- 编辑名称（复用 TitleModal） ----------

const renameTarget = ref<{ id: string; title: string } | null>(null)
const renameShow = computed({
  get: () => Boolean(renameTarget.value),
  set: (value: boolean) => {
    if (!value) renameTarget.value = null
  },
})

function openRename(node: CanvasEditorNode) {
  renameTarget.value = { id: node.id, title: node.data.title || '' }
}

function confirmRename(value: string) {
  const target = renameTarget.value
  renameTarget.value = null
  const next = value.trim().slice(0, 40)
  if (!target || !next || next === target.title) return
  store.updateNodeData(target.id, { title: next })
}

// ---------- 模型替换（节点菜单二级视图） ----------

function modelOptionsOf(node: CanvasEditorNode): ICanvasCatalogModel[] {
  const list = node.data.kind === 'video' ? store.catalog.value?.video_models : store.catalog.value?.imageModels
  return list ?? []
}

const ctxModelOptions = computed(() => (ctxNode.value ? modelOptionsOf(ctxNode.value) : []))

/**
 * 节点副标题：生成节点按当前模型重算（「Nano Banana 2.1 · 1K」）。旧画布存的 subtitle 可能是简称（「Banana · 1K」），
 * 只在显示时换成完整名，不改存量数据。
 */
function nodeSubtitleOf(node: CanvasEditorNode): string {
  const data = node.data
  if ((data.kind === 'model' || data.kind === 'video') && data.model) {
    return `${modelLabelOf(data.model)} · ${data.kind === 'video' ? (data.duration ?? '4s') : (data.size ?? '1K')}`
  }
  return data.subtitle || '节点'
}

function applyModelPick(model: ICanvasCatalogModel) {
  const node = ctxNode.value
  closeCtxMenu()
  if (!node || !model.ready) return
  store.changeModel(node.id, model)
  editorMessage.success(`已切换为 ${model.label || modelLabelOf(model.model)}`)
}

// ---------------- 导出（2026-11-06 二轮）：工程 JSON + 整张画布 PNG（SVG 2× 渲染，跨域图留灰块） ----------------

const showExportMenu = ref(false)

/** 节点数据的用户内容副本（剔除运行态；与复制节点的 slim 同口径） */
function slimDataOf(node: CanvasEditorNode): Record<string, unknown> {
  const data = { ...node.data } as Record<string, unknown>
  for (const key of [
    'status',
    'progress',
    'errorMessage',
    'errorCode',
    'retryable',
    'requestId',
    'runId',
    'candidates',
    'selectedCandidate',
    'requestedCount',
    'libraryStatus',
    'library_status',
  ]) {
    delete data[key]
  }
  // 产物还是现签临时地址（转存素材库中 / 失败）：10 分钟后失效，不写进导出文件
  if (hasTransientMedia(node.data) && (node.type === 'model' || node.type === 'tool') && !node.data.inputOnly) {
    for (const key of ['image', 'video', 'resultImage']) delete data[key]
  }
  return data
}

function exportWorkflowJson() {
  showExportMenu.value = false
  const payload = {
    format: 'xiaoqi-canvas',
    version: 1,
    canvasId: canvasId.value,
    title: title.value,
    exportedAt: new Date().toISOString(),
    viewport: { x: viewport.value.x, y: viewport.value.y, zoom: viewport.value.zoom },
    nodes: nodes.value.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      width: node.data.width,
      height: node.data.height,
      data: slimDataOf(node),
    })),
    edges: edges.value.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      data: edge.data ?? undefined,
    })),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.value || 'canvas'}-${Date.now()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  editorMessage.success('已导出工程 JSON')
}

const exportingPng = ref(false)

function escapeXml(text: string): string {
  return text.replace(
    /[<>&'"]/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch] ?? ch,
  )
}

/** 按像素宽度折行（中文逐字、英文按词），用 2D 画布量字宽 */
function wrapText(text: string, maxWidth: number, font: string): string[] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return text.split('\n')
  ctx.font = font
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const token of paragraph.match(/[A-Za-z0-9_\-.,:;!?'"()]+\s*|\s+|./gu) ?? []) {
      if (ctx.measureText(line + token).width > maxWidth && line) {
        lines.push(line.trimEnd())
        line = token.trimStart()
      } else {
        line += token
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** 图片转 dataURL（跨域取不到就返回空，对应节点画占位块；SVG 里引外链图会被浏览器拦） */
async function imageToDataUrl(url?: string): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return ''
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return ''
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

/**
 * 导出整张画布 PNG（原型 exportCanvasPng 同法）：不克隆 DOM（克隆件不带样式，导出来是裸 HTML），
 * 而是按节点实际尺寸 + 数据重画一张 SVG——底色、分组底板（先画，不盖成员）、连线、节点卡（标题 / 副标题 /
 * 图片或文字或占位），再以 2× 栅格化成 PNG。范围取所有节点外接框外扩 80px，与当前视口无关。
 */
async function exportCanvasPng() {
  if (exportingPng.value) return
  showExportMenu.value = false
  const stage = stageRef.value
  if (!stage) return
  const host = stage.getBoundingClientRect()
  const vp = viewport.value
  const zoom = vp.zoom || 1
  type Item = { node: CanvasEditorNode; x: number; y: number; w: number; h: number }
  const items = nodes.value
    .map((node): Item | null => {
      const el = stage.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(node.id)}"]`)
      const rect = el?.getBoundingClientRect()
      if (!rect || !rect.width) return null
      return {
        node,
        x: (rect.left - host.left - vp.x) / zoom,
        y: (rect.top - host.top - vp.y) / zoom,
        w: rect.width / zoom,
        h: rect.height / zoom,
      }
    })
    .filter((item): item is Item => Boolean(item))
  if (!items.length) {
    editorMessage.warning('画布上还没有可导出的节点')
    return
  }
  exportingPng.value = true
  try {
    const pad = 80
    const minX = Math.min(...items.map((it) => it.x)) - pad
    const minY = Math.min(...items.map((it) => it.y)) - pad
    const width = Math.round(Math.max(...items.map((it) => it.x + it.w)) + pad - minX)
    const height = Math.round(Math.max(...items.map((it) => it.y + it.h)) + pad - minY)
    // 浏览器画布单边上限约 16384：超大画布按比例降低倍率
    const scale = Math.max(0.25, Math.min(2, 16000 / Math.max(width, height)))
    const pos = new Map(items.map((it) => [it.node.id, it]))
    const font = "'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif"

    const edgePaths = edges.value
      .map((edge) => {
        const from = pos.get(edge.source)
        const to = pos.get(edge.target)
        if (!from || !to) return ''
        const x1 = from.x + from.w
        const y1 = from.y + from.h / 2
        const x2 = to.x
        const y2 = to.y + to.h / 2
        const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
        const raw = String(edge.data?.color ?? '')
        const color = /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : '#875f9a'
        return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-opacity="0.7" stroke-width="2"/>`
      })
      .join('')

    const plates = items.filter((it) => it.node.type === 'module')
    const cards = items.filter((it) => it.node.type !== 'module')
    const plateSvg = plates
      .map(
        ({ node, x, y, w, h }) =>
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#875f9a" fill-opacity="0.06" stroke="#875f9a" stroke-opacity="0.35" stroke-dasharray="8 6"/>` +
          `<text x="${x + 14}" y="${y + 26}" font-family="${font}" font-size="13" font-weight="600" fill="#1f2329" fill-opacity="0.66">${escapeXml(node.data.title || '模块')}</text>`,
      )
      .join('')

    const cardSvg = await Promise.all(
      cards.map(async ({ node, x, y, w, h }, index) => {
        const headerH = 36
        const bx = x + 8
        const by = y + headerH + 4
        const bw = Math.max(20, w - 16)
        const bh = Math.max(20, h - headerH - 12)
        const image = await imageToDataUrl(node.data.image || node.data.resultImage)
        let body = ''
        if (image) {
          body =
            `<clipPath id="clip-${index}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6"/></clipPath>` +
            `<image href="${image}" x="${bx}" y="${by}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${index})"/>`
        } else if (node.type === 'text' || node.data.resultText) {
          const text = String(node.type === 'text' ? node.data.text || '（空文字）' : node.data.resultText)
          const maxLines = Math.max(1, Math.floor(bh / 18))
          body = wrapText(text, Math.max(60, bw - 8), `12px ${font}`)
            .slice(0, maxLines)
            .map(
              (line, i) =>
                `<text x="${bx + 4}" y="${by + 14 + i * 18}" font-family="${font}" font-size="12" fill="#4b5563">${escapeXml(line)}</text>`,
            )
            .join('')
        } else {
          const label = node.data.model
            ? `模型 · ${modelLabelOf(node.data.model)}`
            : node.type === 'model'
              ? '生成结果'
              : '空节点'
          body =
            `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="#f3f4f5" stroke="#e5e1e4" stroke-dasharray="5 5"/>` +
            `<text x="${bx + bw / 2}" y="${by + bh / 2 + 4}" text-anchor="middle" font-family="${font}" font-size="12" fill="#8a9099">${escapeXml(label)}</text>`
        }
        return (
          `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#ffffff" stroke="#e5e1e4" filter="url(#card-shadow)"/>` +
          `<text x="${x + 10}" y="${y + 23}" font-family="${font}" font-size="13" font-weight="600" fill="#1f2329">${escapeXml(node.data.title || '节点')}</text>` +
          `<line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="#eef0f2"/>${body}</g>`
        )
      }),
    )

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs><filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#101828" flood-opacity="0.10"/></filter></defs>` +
      `<rect width="100%" height="100%" fill="#f5f5f5"/>` +
      `<g transform="translate(${-minX} ${-minY})">${plateSvg}${edgePaths}${cardSvg.join('')}</g></svg>`

    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('render fail'))
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画布不可用')
    ctx.fillStyle = '#f5f5f5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('export fail')
    const pngUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = pngUrl
    a.download = `${title.value || 'canvas'}-${Date.now()}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(pngUrl), 1000)
    editorMessage.success(`已导出画布 PNG（${canvas.width}×${canvas.height}）`)
  } catch {
    editorMessage.error('导出画布图片失败，可改用「下载所有输出」')
  } finally {
    exportingPng.value = false
  }
}

// ---------------- 首启引导（2026-11-06 二轮）：一次即退，localStorage 记忆 ----------------

const ONBOARD_KEY = 'fusion-canvas-onboarded'
const showOnboard = ref(false)
onMounted(() => {
  try {
    showOnboard.value = !localStorage.getItem(ONBOARD_KEY)
  } catch {
    showOnboard.value = false
  }
})
function dismissOnboard() {
  showOnboard.value = false
  try {
    localStorage.setItem(ONBOARD_KEY, '1')
  } catch {
    /* 隐私模式：每次进编辑器都会再看到一次，可接受 */
  }
}

// ---------------- 提示词库浮层（2026-11-06 二轮：画布内直开，插入选中节点） ----------------

const promptFlyoutOpen = ref(false)
const promptAnchorEl = ref<HTMLElement | null>(null)

function insertPrompt(text: string) {
  const node = selectedNode.value
  if (!node) {
    // 没选中节点：在视口中心新建一个「提示词」文字节点并填入
    const rect = stageRef.value?.getBoundingClientRect()
    const at = rect
      ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : undefined
    const created = store.addNode('text', undefined, at)
    if (!created) return
    store.updateNodeData(created.id, { title: '提示词', text: text.slice(0, 3000) })
    store.selectNode(created.id)
    editorMessage.success('已新建文字节点并插入提示词')
    return
  }
  const key = node.type === 'text' ? 'text' : 'prompt'
  const base = String(node.data[key] ?? '')
  const merged = (base ? `${base}${base.endsWith('\n') ? '' : '\n'}` : '') + text
  store.updateNodeData(node.id, { [key]: merged.slice(0, 3000) })
  editorMessage.success('提示词已填入选中节点')
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

/**
 * 快捷键与画布操作（原型 .wf-help：两列网格 gap 8×20，左列 12px #7d767b；kbd 白底 2px 底边）。
 * 只列真实可用的：缩放只有 Ctrl/⌘ + 滚轮（未做 Alt 缩放，不列）；本页额外的粘贴 / 再制 / ? 保留。
 */
function openHelp() {
  const M = MOD_KEY
  type Part = string | { k: string }
  const rows: [string, Part[]][] = [
    ['撤销 / 重做', [{ k: M }, { k: 'Z' }, ' · ', { k: M }, { k: 'Y' }]],
    ['复制 / 粘贴', [{ k: M }, { k: 'C' }, ' · ', { k: M }, { k: 'V' }]],
    ['剪切 / 再制', [{ k: M }, { k: 'X' }, ' · ', { k: M }, { k: 'D' }]],
    ['删除选中', [{ k: 'Delete' }, ' / ', { k: 'Backspace' }]],
    ['多选 / 框选加选', [{ k: 'Shift' }, ' + 点击 / 拖框']],
    ['临时平移', ['按住 ', { k: 'Space' }, ' 拖动']],
    ['保存', [{ k: M }, { k: 'S' }]],
    ['缩放', [{ k: M }, ' + 滚轮']],
    ['取消选择 / 关闭', [{ k: 'Esc' }]],
    ['快捷键表', [{ k: '?' }]],
    ['更多', ['右键画布或节点']],
  ]
  const kbd = (text: string) =>
    h(
      'kbd',
      {
        class:
          'inline-block min-w-20px px-6px py-1px border border-solid border-line-strong border-b-2 rounded-5px bg-surface text-ink-2 text-11px leading-[1.5] text-center',
        style: "font-family:'SFMono-Regular',Consolas,monospace",
      },
      text,
    )
  editorDialog.info({
    title: '快捷键与画布操作',
    positiveText: '我知道了',
    style: { width: '420px', maxWidth: 'calc(100vw - 32px)' },
    content: () =>
      h('div', [
        h(
          'div',
          {
            class:
              'grid grid-cols-[auto_1fr] items-center gap-x-20px gap-y-8px mt-4px mb-14px text-ink-2 text-13px',
          },
          rows.flatMap(([label, parts]) => [
            h('span', { class: 'text-muted text-12px' }, label),
            h(
              'span',
              { class: 'flex flex-wrap items-center gap-3px' },
              parts.map((part) => (typeof part === 'string' ? h('span', part) : kbd(part.k))),
            ),
          ]),
        ),
        h(
          'p',
          { class: 'm-0 text-muted text-12px leading-[1.5]' },
          `默认滚轮是上下平移画布，只有按住 ${M} 滚动时才会缩放；触控板可双指捏合。`,
        ),
      ]),
  })
}

// ---------------- 小地图节点配色（原型 minimapNodeColor：模块 / 生成 / 其他三档） ----------------

// 深色：同一三档的明度台阶反过来（模块最暗、生成最亮带藤紫），压在深色小地图底上依旧分得清
const MINIMAP_NODE_COLORS = {
  light: { module: '#ece5f0', model: '#cbb7d6', other: '#ded5e2' },
  dark: { module: '#2a2530', model: '#6f5a80', other: '#454150' },
} as const
function minimapNodeColor(node: { type?: string }): string {
  const c = MINIMAP_NODE_COLORS[activeTheme.value]
  if (node.type === 'module') return c.module
  if (node.type === 'model') return c.model
  return c.other
}

// ---------------- 拖文件 / 资产到空白画布：逐张上传并在落点建图片节点（错开 24px） ----------------

/** 资产栏若支持拖拽，约定用这个 dataTransfer 类型携带 {url} 或 {urls}（JSON） */
const ASSET_DRAG_TYPE = 'application/x-canvas-asset'
const stageDropActive = ref(false)

/** 拖放事件的 target 就是最上层命中的元素：与拖线松手同一套「空白画布」判定（小地图 / 浮动面板 / 工具条不算） */
function isEmptyStageTarget(target: EventTarget | null): boolean {
  return target instanceof Element && isBlankCanvasEl(target)
}

function dragCarriesUsable(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes('Files') || types.includes(ASSET_DRAG_TYPE)
}

function onStageDragOver(event: DragEvent) {
  if (!dragCarriesUsable(event)) return
  // 一律拦住浏览器默认「打开文件」；落到节点上传块时由节点自己的拖入处理接管
  event.preventDefault()
  const ok = isEmptyStageTarget(event.target) && store.ready.value && !loading.value
  if (event.dataTransfer) event.dataTransfer.dropEffect = ok ? 'copy' : 'none'
  stageDropActive.value = ok
}

function onStageDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null
  if (next && stageRef.value?.contains(next)) return
  stageDropActive.value = false
}

async function onStageDrop(event: DragEvent) {
  stageDropActive.value = false
  if (!dragCarriesUsable(event)) return
  event.preventDefault()
  // 落点不是空白画布（如节点里的上传块，它自己会接管）：不再重复建节点
  if (!isEmptyStageTarget(event.target) || !store.ready.value || loading.value) return
  const base = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const at = (i: number) => ({ x: base.x + i * 24, y: base.y + i * 24 })

  const assetRaw = event.dataTransfer?.getData(ASSET_DRAG_TYPE)
  if (assetRaw) {
    let urls: string[] = []
    try {
      const parsed = JSON.parse(assetRaw) as { url?: string; urls?: string[] }
      urls = parsed.urls ?? (parsed.url ? [parsed.url] : [])
    } catch {
      urls = []
    }
    urls
      .filter((url) => /^https?:\/\//i.test(url))
      .forEach((url, i) => {
        const created = store.addNode('image', undefined, at(i))
        if (created) store.updateNodeData(created.id, { image: url })
      })
    return
  }

  await placeImageFiles(Array.from(event.dataTransfer?.files ?? []), at)
}

/** 拖入 / 粘贴共用：逐张校验、上传，在 at(i) 建图片节点 */
async function placeImageFiles(files: File[], at: (i: number) => { x: number; y: number }) {
  const images = files.filter((file) => IMAGE_ACCEPT.includes(file.type))
  const tooBig = images.filter((file) => uploadSizeError(file))
  const usable = images.filter((file) => !uploadSizeError(file))
  if (files.length > images.length) editorMessage.warning('只支持 JPG / PNG / WebP 图片，其他文件已跳过')
  if (tooBig.length) editorMessage.warning(`${tooBig.length} 张图片超过 ${MAX_IMAGE_UPLOAD_MB}MB，已跳过`)
  if (!usable.length) return
  const progress = editorMessage.loading(`正在上传 ${usable.length} 张图片…`, { duration: 0 })
  let done = 0
  let failed = 0
  try {
    await Promise.all(
      usable.map(async (file, i) => {
        try {
          const url = await canvasUploadMedia(file)
          const created = store.addNode('image', undefined, at(i))
          if (created) store.updateNodeData(created.id, { image: url })
          done += 1
        } catch {
          failed += 1
        }
      }),
    )
  } finally {
    progress.destroy()
  }
  if (failed) editorMessage.error(`${failed} 张图片上传失败${done ? `，已放入 ${done} 张` : ''}`)
  else editorMessage.success(`已放入 ${done} 张图片`)
}

/** 鼠标最后停在舞台上的位置（粘贴落点）；没有时用舞台中心 */
let stagePointer: { x: number; y: number } | null = null
function onStagePointerMove(event: PointerEvent) {
  stagePointer = { x: event.clientX, y: event.clientY }
}
function onStagePointerLeave() {
  stagePointer = null
}

// 舞台也是粘贴目标（拖入仍走上面的 onStageDrop）：悬停在节点上传块上时交给节点，其余时候在鼠标处 / 视口中心建图片节点
useFileDropPaste(stageRef, {
  accept: 'image',
  multiple: true,
  drop: false,
  pastePrimary: true,
  disabled: () => !store.ready.value || loading.value,
  disabledMessage: '画布还在加载，请稍候再粘贴',
  rejectMessage: () => '只支持 JPG / PNG / WebP 图片',
  onFiles: (files) => {
    const rect = stageRef.value?.getBoundingClientRect()
    const point =
      stagePointer ?? (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 })
    const base = screenToFlowCoordinate(point)
    void placeImageFiles(files, (i) => ({ x: base.x + i * 24, y: base.y + i * 24 }))
  },
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div ref="pageEl" class="flex flex-col h-100vh overflow-hidden bg-page">
      <header class="flex shrink-0 items-center gap-8px h-48px px-12px border-b border-b-solid border-line bg-surface">
        <IconButton label="返回画布首页" variant="quiet" class="shrink-0" @click="backToList">
          <EditorIcon name="arrowBack" :size="18" />
        </IconButton>
        <input
          v-if="titleEditing"
          ref="titleInputRef"
          v-model="title"
          class="w-240px h-30px px-8px border border-solid border-violet rounded-4px bg-surface text-ink text-14px font-600 leading-20px outline-none shadow-[var(--xq-shadow-focus),var(--xq-shadow-inset-input)]"
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
          :title="saveState === 'error' ? `保存失败：${saveError || '请稍后重试'}` : undefined"
          role="status"
          >{{ saveText }}</span
        >
        <span
          v-if="runningCount"
          class="shrink-0 px-7px py-2px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-11px whitespace-nowrap"
          >运行中 {{ runningCount }}</span
        >

        <div class="flex items-center gap-6px ml-auto">
          <button type="button" :class="TOP_BTN" title="模板库：套用现成画布结构" @click="showTemplates = true">
            <EditorIcon name="card" :size="16" /> 模板
          </button>
          <button
            type="button"
            :class="TOP_BTN"
            :aria-disabled="saveState === 'saving' || undefined"
            data-tip="保存当前画布"
            data-tip-key="Mod+S"
            aria-keyshortcuts="Control+S Meta+S"
            @click="saveState !== 'saving' && store.saveNow()"
          >
            {{ saveState === 'saving' ? '保存中…' : '保存' }}
          </button>
          <button type="button" :class="TOP_BTN" title="复制当前画布到一张新画布" @click="showSaveAs = true">
            另存为
          </button>
          <!-- 余额 pill（原型顶栏 credit pill）：胶囊本身只展示（失败态它自带重试按钮），刷新是旁边的独立图标钮，不嵌套按钮 -->
          <div class="flex flex-none items-center gap-2px">
            <PointsBalanceChip />
            <IconButton label="刷新余额" size="sm" variant="quiet" @click="refreshBalance">
              <EditorIcon name="refresh" :size="14" />
            </IconButton>
          </div>
          <!-- 导出下拉（原型 .wf-export：下载所有输出 / 导出工程 JSON / 导出画布 PNG） -->
          <div ref="exportWrapEl" class="relative flex-none">
            <button
              type="button"
              :class="TOP_BTN"
              :aria-expanded="showExportMenu"
              aria-haspopup="menu"
              title="导出"
              @click="showExportMenu = !showExportMenu"
            >
              <EditorIcon name="download" :size="16" /> 导出
            </button>
            <div
              v-if="showExportMenu"
              class="sx-squircle absolute right-0 top-38px z-[6000] w-190px flex flex-col rounded-14px border border-solid border-line bg-overlay p-6px shadow-[0_16px_36px_rgba(31,35,41,0.14)]"
              :class="POP_FADE"
              role="menu"
              @click.stop
            >
              <button type="button" class="export-item" role="menuitem" @click="downloadAll">
                <EditorIcon name="download" :size="14" /> 下载所有输出
              </button>
              <button type="button" class="export-item" role="menuitem" @click="exportWorkflowJson">
                <EditorIcon name="doc" :size="14" /> 导出工程 JSON
              </button>
              <button
                type="button"
                class="export-item"
                role="menuitem"
                :disabled="exportingPng"
                @click="exportCanvasPng"
              >
                <EditorIcon name="image" :size="14" /> {{ exportingPng ? '正在导出…' : '导出画布 PNG' }}
              </button>
            </div>
          </div>
          <button
            type="button"
            :class="TOP_BTN_PRIMARY"
            :aria-disabled="runDisabled || undefined"
            :title="runHint"
            @click="runSelected"
          >
            <EditorIcon name="play" :size="14" />
            {{
              batchActive
                ? '批量执行中…'
                : runScope === 'selection'
                  ? `执行选中 ${selectedFlowNodes.length} 个`
                  : '执行模型'
            }}
          </button>
        </div>
      </header>

      <div class="flex flex-1 min-h-0">
        <EditorAssetPanel @locate="locateNode" @add-from-library="showAssetPicker = true" />

        <!-- 舞台：原型 .wf-canvas 底色 #f5f5f5；框选框藤紫描边 + 8% 浅底；非法连线红色虚线 -->
        <div
          ref="stageRef"
          class="relative flex-1 min-w-0 overflow-hidden bg-[#f5f5f5] [[data-theme=dark]_&]:bg-page"
          @dblclick="onStageDblClick"
          @dragover="onStageDragOver"
          @dragleave="onStageDragLeave"
          @drop="onStageDrop"
          @pointermove.passive="onStagePointerMove"
          @pointerleave="onStagePointerLeave"
        >
          <VueFlow
            :id="FLOW_ID"
            v-model:nodes="nodes"
            v-model:edges="edges"
            class="w-full h-full [&_.vue-flow\_\_pane]:cursor-default [&_.vue-flow\_\_selection]:border [&_.vue-flow\_\_selection]:border-solid [&_.vue-flow\_\_selection]:border-violet [&_.vue-flow\_\_selection]:bg-violet/8 [&_.vue-flow\_\_connection-path.invalid]:!stroke-danger [&_.vue-flow\_\_connection-path.invalid]:[stroke-dasharray:5_4]"
            :default-viewport="{ x: 40, y: 20, zoom: 0.86 }"
            :min-zoom="0.2"
            :max-zoom="2"
            :zoom-on-scroll="false"
            :pan-on-scroll="true"
            :pan-on-drag="toolMode === 'pan'"
            :selection-key-code="toolMode === 'select' ? true : 'Shift'"
            multi-select-key-code="Shift"
            :snap-to-grid="snapEnabled"
            :snap-grid="[20, 20]"
            :zoom-on-double-click="false"
            :elevate-nodes-on-select="false"
            :delete-key-code="null"
            :connect-on-click="false"
            :connection-mode="ConnectionMode.Strict"
            :connection-line-style="{ stroke: 'var(--xq-violet-fg)', strokeWidth: 2, strokeLinecap: 'round' }"
            :is-valid-connection="isValidConnection"
            @node-click="onNodeClick"
            @pane-click="onPaneClick"
            @edge-click="onEdgeClick"
            @connect="onConnect"
            @connect-start="onConnectStart"
            @connect-end="onConnectEnd"
            @node-contextmenu="onNodeContextMenu"
            @pane-contextmenu="onPaneContextMenu"
            @node-drag-start="onNodeDragStart"
            @node-drag="onNodeDrag"
            @node-drag-stop="onNodeDragStop"
          >
            <Background :gap="dotGrid.gap" :size="dotGrid.size" :pattern-color="dotColor" />

            <!-- 小地图（原型 .wf-minimap：150×96、右下 16、r14、白 92%、蒙版藤紫 8%、节点圆角 3、可拖动 / 滚轮缩放） -->
            <MiniMap
              position="bottom-right"
              :width="150"
              :height="96"
              :pannable="true"
              :zoomable="true"
              :mask-color="minimapMaskColor"
              :node-color="minimapNodeColor"
              node-radius="3"
              class="canvas-minimap"
            />

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

          <!-- 空态 / 加载态（原型 .wf-canvas-empty：虚线 r8、白 94%、轻投影；新画布给「从模板开始 / 从资产导入」两个入口） -->
          <div
            v-if="loading || !nodes.length"
            class="absolute top-50% left-50% z-6 flex flex-col items-center gap-6px px-24px py-20px border border-dashed border-line-strong rounded-8px bg-white/94 text-muted text-center shadow-[0_1px_2px_rgba(16,24,40,0.06)] -translate-x-50% -translate-y-50% pointer-events-none"
            :class="stageDropActive && '!border-violet !bg-violet-soft/94'"
            :role="loading ? 'status' : undefined"
          >
            <strong class="text-ink text-14px">{{
              loading
                ? '正在加载画布…'
                : loadError
                  ? '画布加载失败'
                  : stageDropActive
                    ? '松手放入图片'
                    : '这是一张新画布'
            }}</strong>
            <template v-if="!loading">
              <p v-if="loadError" class="m-0 text-13px">{{ loadError }}</p>
              <p v-else class="m-0 text-13px">从模板开始，或点左侧「从资产导入」放入素材。</p>
              <button
                v-if="loadError"
                type="button"
                class="empty-btn"
                :class="FOCUS_RING"
                @click="store.init(canvasId)"
              >
                重试
              </button>
              <div v-else class="flex items-center gap-8px mt-4px">
                <button type="button" class="empty-btn" :class="FOCUS_RING" @click="showTemplates = true">
                  从模板开始
                </button>
                <button type="button" class="empty-btn" :class="FOCUS_RING" @click="showAssetPicker = true">
                  从资产导入
                </button>
              </div>
            </template>
          </div>

          <!-- 连线选中条（原型 .wf-selection-bar--edge：顶部居中 36px、r8、浮层投影） -->
          <div
            v-if="selectedEdgeId"
            class="absolute top-10px left-50% z-6 sx-squircle flex h-38px items-center gap-2px px-6px py-4px border border-solid border-line rounded-14px bg-white/98 text-ink-2 text-13px shadow-[0_12px_28px_rgba(58,38,72,0.14),0_2px_6px_rgba(31,35,41,0.06)] -translate-x-50%"
            :class="POP_FADE"
            role="toolbar"
            aria-label="连线操作"
            @click.stop
          >
            <span class="px-5px text-ink-2 text-13px whitespace-nowrap">已选中连线</span>
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <button
              type="button"
              class="h-28px px-8px border border-solid border-transparent rounded-4px bg-transparent text-danger text-13px cursor-pointer hover:bg-danger-soft hover:text-alert-danger"
              :class="FOCUS_RING"
              @click="deleteSelection"
            >
              断开
            </button>
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <IconButton
              label="取消选中"
              no-title
              data-tip="取消选中"
              data-tip-key="Esc"
              size="sm"
              variant="quiet"
              @click="selectedEdgeId = ''"
            >
              <EditorIcon name="close" :size="14" />
            </IconButton>
          </div>

          <!-- 多选操作条（原型 .wf-selection-bar：顶部 10 居中、38h r14、padding 4×6；对齐弹层锚在整条正下方） -->
          <div
            v-else-if="selectedFlowNodes.length > 1"
            class="absolute top-10px left-50% z-6 sx-squircle flex h-38px max-w-[calc(100%-24px)] items-center gap-2px px-6px py-4px border border-solid border-line rounded-14px bg-white/98 text-ink-2 text-13px whitespace-nowrap shadow-[0_12px_28px_rgba(58,38,72,0.14),0_2px_6px_rgba(31,35,41,0.06)] -translate-x-50%"
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
              title="按上下游顺序执行选中的生成 / 工具节点（先确认预计消耗）"
              :aria-disabled="batchRunning || undefined"
              @click="runSelectionNodes"
            >
              <EditorIcon name="play" :size="12" /> 执行
            </button>
            <button
              type="button"
              :class="SELECTION_BTN"
              data-tip="复制选中节点（含组内连线）"
              data-tip-key="Mod+D"
              @click="duplicateSelection()"
            >
              <EditorIcon name="copy" :size="12" /> 复制
            </button>
            <div ref="alignWrapEl" class="inline-flex">
              <button
                type="button"
                :class="SELECTION_BTN"
                :aria-expanded="showAlignPop"
                aria-haspopup="menu"
                @click="showAlignPop = !showAlignPop"
              >
                <EditorIcon name="grid" :size="12" /> 对齐
              </button>
            </div>
            <button
              v-if="!singleGroupId"
              type="button"
              :class="SELECTION_BTN"
              title="把选中节点框进一块虚线底板"
              @click="groupSelection"
            >
              <EditorIcon name="layers" :size="12" /> 成组
            </button>
            <button
              v-else
              type="button"
              :class="SELECTION_BTN"
              title="只拆底板，成员原位保留"
              @click="ungroupSelection"
            >
              <EditorIcon name="folderOpen" :size="12" /> 解组
            </button>
            <button
              type="button"
              :class="SELECTION_BTN"
              :title="selectionAllLocked ? '解锁选中节点' : '锁定选中节点（拖不动，可解锁 / 删除）'"
              @click="toggleLockSelection"
            >
              <EditorIcon :name="selectionAllLocked ? 'unlock' : 'lock'" :size="12" />
              {{ selectionAllLocked ? '解锁' : '锁定' }}
            </button>
            <button type="button" :class="SELECTION_BTN" title="把选中节点放大到视野中央" @click="zoomToSelection()">
              <EditorIcon name="fit" :size="12" /> 聚焦
            </button>
            <button
              type="button"
              :class="SELECTION_BTN"
              class="!text-danger hover:!border-danger-line hover:!bg-danger-soft hover:!text-alert-danger"
              data-tip="删除选中节点"
              data-tip-key="Delete"
              @click="confirmDeleteNodes"
            >
              <EditorIcon name="trash" :size="12" /> 删除
            </button>
            <span class="w-1px h-16px mx-2px bg-line" aria-hidden="true" />
            <IconButton
              label="取消选择"
              no-title
              data-tip="取消选择"
              data-tip-key="Esc"
              size="sm"
              variant="quiet"
              @click="clearFlowSelection"
            >
              <EditorIcon name="close" :size="14" />
            </IconButton>

            <!-- 对齐分布（原型 .wf-align-pop：240 宽 r14 padding 8，两列 30h r8 12px 左对齐；小标「对齐」「分布」） -->
            <div
              v-if="showAlignPop"
              ref="alignPopEl"
              class="sx-squircle absolute left-1/2 top-[calc(100%+8px)] z-[6000] grid w-240px grid-cols-2 gap-2px rounded-14px border border-solid border-line bg-overlay p-8px -translate-x-1/2 shadow-[0_16px_36px_rgba(31,35,41,0.14)]"
              :class="POP_FADE"
              role="menu"
              aria-label="对齐与分布"
              @click.stop
            >
              <span class="align-label">对齐</span>
              <button type="button" class="align-item" role="menuitem" @click="alignSelection('left')">左对齐</button>
              <button type="button" class="align-item" role="menuitem" @click="alignSelection('hcenter')">
                水平居中
              </button>
              <button type="button" class="align-item" role="menuitem" @click="alignSelection('right')">右对齐</button>
              <button type="button" class="align-item" role="menuitem" @click="alignSelection('top')">顶对齐</button>
              <button type="button" class="align-item" role="menuitem" @click="alignSelection('vcenter')">
                垂直居中
              </button>
              <button type="button" class="align-item" role="menuitem" @click="alignSelection('bottom')">底对齐</button>
              <span class="align-label">分布</span>
              <button type="button" class="align-item" role="menuitem" @click="distributeSelection('h')">
                水平等距
              </button>
              <button type="button" class="align-item" role="menuitem" @click="distributeSelection('v')">
                垂直等距
              </button>
            </div>
          </div>

          <!-- 左竖工具条（原型 .wf-toolbar-left：left 12 / 垂直居中）；图标钮统一 IconButton（32px 命中区），提示出在右侧 -->
          <div
            :class="TOOLBAR"
            class="left-12px top-50% -translate-y-50% flex-col"
            role="toolbar"
            aria-label="画布工具"
            data-tip-side="right"
          >
            <IconButton
              label="拖动模式（平移画布）"
              no-title
              data-tip="拖动模式（平移画布）"
              data-tip-key="Space"
              variant="quiet"
              :pressed="toolMode === 'pan'"
              @click="toolMode = 'pan'"
            >
              <EditorIcon name="hand" :size="19" />
            </IconButton>
            <IconButton
              label="选择模式（框选节点，Shift 加选）"
              no-title
              data-tip="选择模式（框选，Shift 加选）"
              variant="quiet"
              :pressed="toolMode === 'select'"
              @click="toolMode = 'select'"
            >
              <EditorIcon name="pointer" :size="18" />
            </IconButton>
            <span class="h-1px mx-6px my-2px bg-line" aria-hidden="true" />
            <IconButton
              label="添加节点（也可双击空白画布）"
              no-title
              data-tip="添加节点（也可双击空白画布）"
              variant="quiet"
              :pressed="Boolean(addPanel && !addPanel.spawnAt)"
              aria-haspopup="dialog"
              :aria-expanded="Boolean(addPanel)"
              @click="openAddPanel"
            >
              <EditorIcon name="plus" :size="20" />
            </IconButton>
            <span class="h-1px mx-6px my-2px bg-line" aria-hidden="true" />
            <IconButton
              label="从资产导入"
              no-title
              data-tip="从资产导入（也可把图片拖到画布）"
              variant="quiet"
              @click="showAssetPicker = true"
            >
              <EditorIcon name="albums" :size="18" />
            </IconButton>
            <span ref="promptAnchorEl" class="inline-flex">
              <IconButton
                label="提示词库（插入选中节点）"
                no-title
                data-tip="提示词库（插入选中节点）"
                variant="quiet"
                :pressed="promptFlyoutOpen"
                aria-haspopup="dialog"
                :aria-expanded="promptFlyoutOpen"
                @click="promptFlyoutOpen = !promptFlyoutOpen"
              >
                <EditorIcon name="book" :size="18" />
              </IconButton>
            </span>
          </div>

          <!-- 底横工具条（原型 .wf-toolbar-bottom：bottom 16 / 水平居中；网格后、适应画布后各一道 1×18 #ececef 分隔） -->
          <div
            :class="TOOLBAR"
            class="bottom-16px left-50% -translate-x-50% items-center"
            role="toolbar"
            aria-label="画布视图"
            @click.stop
          >
            <IconButton
              :label="runHint"
              no-title
              :data-tip="
                runScope === 'selection'
                  ? `执行选中的 ${selectedFlowNodes.length} 个节点`
                  : runScope === 'single'
                    ? '执行选中节点'
                    : '执行全部模型节点'
              "
              variant="quiet"
              :disabled="runDisabled"
              :loading="batchActive"
              @click="runSelected"
            >
              <EditorIcon name="play" :size="16" />
            </IconButton>
            <IconButton
              label="对齐网格（20px，默认关）"
              no-title
              data-tip="对齐网格（20px）"
              variant="quiet"
              :pressed="snapEnabled"
              @click="snapEnabled = !snapEnabled"
            >
              <EditorIcon name="grid" :size="16" />
            </IconButton>
            <span class="w-1px h-18px mx-2px bg-line" aria-hidden="true" />
            <IconButton label="缩小" no-title data-tip="缩小" variant="quiet" @click="zoomOut()">
              <EditorIcon name="minus" :size="16" />
            </IconButton>
            <!-- 缩放读数（原型 .wf-zoom-value）：min-w 44、11px tabular，点击回 100%（保持视口中心不动） -->
            <button
              type="button"
              class="grid h-32px min-w-44px place-items-center border-none rounded-12px bg-transparent px-4px text-11px leading-none tabular-nums text-ink-2 cursor-pointer hover:bg-surface3 hover:text-ink"
              :class="FOCUS_RING"
              data-tip="点击回到 100%"
              aria-label="缩放读数，点击恢复 100%"
              @click="resetZoom"
            >
              {{ Math.round((viewport.zoom || 1) * 100) }}%
            </button>
            <IconButton label="放大" no-title data-tip="放大" variant="quiet" @click="zoomIn()">
              <EditorIcon name="plus" :size="16" />
            </IconButton>
            <IconButton
              label="适应画布"
              no-title
              data-tip="适应画布"
              variant="quiet"
              @click="fitView({ padding: 0.18, duration: 200 })"
            >
              <EditorIcon name="fit" :size="16" />
            </IconButton>
            <span class="w-1px h-18px mx-2px bg-line" aria-hidden="true" />
            <IconButton
              label="撤销"
              no-title
              data-tip="撤销"
              data-tip-key="Mod+Z"
              aria-keyshortcuts="Control+Z Meta+Z"
              variant="quiet"
              :disabled="!canUndo"
              @click="undoCanvas()"
            >
              <EditorIcon name="undo" :size="16" />
            </IconButton>
            <IconButton
              label="重做"
              no-title
              data-tip="重做"
              data-tip-key="Mod+Y"
              aria-keyshortcuts="Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z"
              variant="quiet"
              :disabled="!canRedo"
              @click="redoCanvas()"
            >
              <EditorIcon name="redo" :size="16" />
            </IconButton>
            <IconButton
              label="批量下载所有图片/视频输出"
              no-title
              data-tip="下载所有图片 / 视频输出"
              variant="quiet"
              :loading="downloading"
              @click="downloadAll"
            >
              <EditorIcon name="download" :size="16" />
            </IconButton>
            <IconButton
              label="快捷键与画布操作"
              no-title
              data-tip="快捷键与画布操作"
              data-tip-key="?"
              aria-keyshortcuts="?"
              variant="quiet"
              @click="openHelp"
            >
              <EditorIcon name="help" :size="16" />
            </IconButton>
          </div>

          <!-- 浮动控制台（原型 CanvasConsolePanel：约 520×360，节点下方，放不下翻到上方） -->
          <div
            v-if="selectedNode && selectedNode.type !== 'module' && consoleBox && selectedFlowNodes.length <= 1"
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
            @add-text="addQuickText"
          />

          <!-- 图片动作面板（节点「…」菜单：识别 / 图片编辑 / 多视图 / 图层） -->
          <ImageActionPanel v-if="activeImageAction" :key="activeImageAction.nodeId" />
          <!-- 结果图校色（节点「…」菜单 / 图片悬停「校色」）：弹窗内调色，生成新的结果图节点 -->
          <CanvasColorFixDialog />

          <!--
            右键菜单 / 节点「…」菜单（原型 .wf-node-menu：208 宽 r14、白 62% + blur 18 saturate 1.6、无描边仅细影；
            头 11/14/9 + 底分隔，组 padding 4×6，组间分隔左右内缩 14，行 36h gap 10 px10 r6 + 14px 图标）
          -->
          <div
            v-if="ctxMenu"
            ref="ctxMenuEl"
            class="sx-squircle absolute z-[6000] w-208px flex flex-col rounded-14px bg-white/62 text-ink-2 backdrop-blur-[18px] backdrop-saturate-[1.6] shadow-[0_0_0_0.5px_rgb(var(--xq-ink-rgb)/0.10),0_18px_44px_rgba(31,35,41,0.16)]"
            :class="POP_FADE"
            :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
            role="menu"
            data-canvas-popover
            :aria-label="ctxMenu.kind === 'pane' ? '画布菜单' : `${ctxNode?.data.title || '节点'} 菜单`"
            @keydown="onCtxMenuKeydown"
            @contextmenu.prevent
          >
            <template v-if="ctxMenu.kind === 'pane'">
              <div class="ctx-group">
                <button type="button" class="ctx-item" role="menuitem" @click="ctxMenuAdd">
                  <EditorIcon name="plus" :size="14" /> 添加节点
                </button>
                <button type="button" class="ctx-item" role="menuitem" :disabled="!clipboard" @click="ctxMenuPaste">
                  <EditorIcon name="copy" :size="14" /> 粘贴<span class="ctx-kbd">{{ MOD_KEY }} V</span>
                </button>
                <button type="button" class="ctx-item" role="menuitem" @click="ctxMenuTemplates">
                  <EditorIcon name="card" :size="14" /> 从模板插入
                </button>
              </div>
              <span class="ctx-sep" aria-hidden="true" />
              <div class="ctx-group">
                <button type="button" class="ctx-item" role="menuitem" @click="ctxMenuFit">
                  <EditorIcon name="fit" :size="14" /> 适应画布
                </button>
                <button
                  type="button"
                  class="ctx-item"
                  role="menuitem"
                  :aria-disabled="!canUndo || undefined"
                  @click="canUndo && ctxMenuUndo()"
                >
                  <EditorIcon name="undo" :size="14" /> 撤销<span class="ctx-kbd">{{ MOD_KEY }} Z</span>
                </button>
                <button
                  type="button"
                  class="ctx-item"
                  role="menuitem"
                  :aria-disabled="!canRedo || undefined"
                  @click="canRedo && ctxMenuRedo()"
                >
                  <EditorIcon name="redo" :size="14" /> 重做<span class="ctx-kbd">{{ MOD_KEY }} Y</span>
                </button>
              </div>
            </template>
            <template v-else-if="ctxNode && ctxMenu.view === 'models'">
              <header class="ctx-head">
                <b class="truncate text-13px font-600 leading-18px text-ink">模型替换</b>
                <small class="truncate text-10.5px leading-14px text-muted">{{
                  ctxNode.data.kind === 'video' ? '视频模型' : '图片模型'
                }}</small>
              </header>
              <div class="ctx-group">
                <button type="button" class="ctx-item" role="menuitem" @click="ctxMenuBack">
                  <EditorIcon name="arrowBack" :size="14" /> 返回
                </button>
              </div>
              <span class="ctx-sep" aria-hidden="true" />
              <div class="ctx-group max-h-320px overflow-y-auto [scrollbar-width:thin]">
                <button
                  v-for="option in ctxModelOptions"
                  :key="option.modelId"
                  type="button"
                  class="ctx-item"
                  :class="ctxNode.data.modelId === option.modelId && '!bg-violet-soft !text-violet-ink'"
                  role="menuitemradio"
                  :aria-checked="ctxNode.data.modelId === option.modelId"
                  :disabled="!option.ready"
                  :title="option.ready ? undefined : '该模型暂不可用'"
                  @click="applyModelPick(option)"
                >
                  <EditorIcon :name="ctxNode.data.modelId === option.modelId ? 'check' : 'model'" :size="14" />
                  <span class="min-w-0 flex-1 truncate">{{ option.label || modelLabelOf(option.model) }}</span>
                  <small v-if="option.badge" class="shrink-0 text-11px text-muted">{{ option.badge }}</small>
                </button>
              </div>
            </template>
            <template v-else-if="ctxNode">
              <header class="ctx-head">
                <b class="truncate text-13px font-600 leading-18px text-ink">{{ ctxNode.data.title || '节点' }}</b>
                <small class="truncate text-10.5px leading-14px text-muted">{{
                  ctxNode.type === 'module' ? (isGroupPlate(ctxNode) ? '分组' : '模块') : nodeSubtitleOf(ctxNode)
                }}</small>
              </header>
              <template v-for="(group, gi) in nodeMenuGroups" :key="gi">
                <span v-if="gi > 0" class="ctx-sep" aria-hidden="true" />
                <div class="ctx-group">
                  <button
                    v-for="item in group"
                    :key="item.key"
                    type="button"
                    class="ctx-item"
                    :class="item.danger && 'is-danger'"
                    role="menuitem"
                    :aria-disabled="item.disabled || undefined"
                    :title="item.hint"
                    @click="runMenuItem(item)"
                  >
                    <EditorIcon :name="item.icon" :size="14" />
                    <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                    <span v-if="item.kbd" class="ctx-kbd">{{ item.kbd }}</span>
                  </button>
                </div>
              </template>
            </template>
          </div>

          <!-- 首启引导（原型 .wf-onboard：底部 78 居中、max-w 560、#e2d6e9 描边 r14、白 96% 毛玻璃；知道了即退并记忆） -->
          <div
            v-if="showOnboard && !loading"
            class="sx-squircle absolute bottom-78px left-1/2 z-20 flex max-w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-10px rounded-14px border border-solid border-violet-line bg-white/96 py-10px pl-16px pr-12px backdrop-blur-[10px] shadow-[0_12px_28px_rgba(31,35,41,0.10)]"
            :class="POP_FADE"
            role="status"
          >
            <b class="shrink-0 whitespace-nowrap text-13px font-600 text-violet-ink">第一次用画布？</b>
            <p class="m-0 min-w-0 flex-1 text-12px leading-[1.5] text-muted">
              双击空白添加节点 · 右键更多 · 拖节点右侧圆点连线 · 空格 / 底部工具条拖动画布
            </p>
            <button
              type="button"
              class="relative h-26px shrink-0 rounded-full border border-solid border-violet-line bg-surface px-10px text-12px text-violet-ink cursor-pointer hover:border-violet hover:bg-violet-tint after:content-empty after:absolute after:-inset-y-3px after:-inset-x-0"
              :class="FOCUS_RING"
              @click="dismissOnboard"
            >
              知道了
            </button>
          </div>

          <CanvasTip :root="pageEl" />
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
      <TemplateInsertDialog v-model:show="showTemplates" @insert="onInsertTemplate" />
      <AssetPickerModal v-model:show="showAssetPicker" :limit="10" @select="addLibraryImages" />
      <TitleModal
        v-model:show="renameShow"
        title="编辑名称"
        label="节点名称"
        :initial="renameTarget?.title ?? ''"
        placeholder="给这个节点起个名字（最多 40 字）"
        @confirm="confirmRename"
      />
      <PromptLibraryFlyout
        v-model:show="promptFlyoutOpen"
        :anchor="promptAnchorEl"
        heading="提示词库"
        show-counts
        keep-open
        @select="(item) => insertPrompt(item.prompt)"
      />
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
/*
 * 画布浮层的行样式（UnoCSS 写起来重复，落全局类；画布页专用命名，不与工具页冲突）：
 * - ctx-*：右键 / 节点「…」菜单（原型 .wf-node-menu：行 36h gap 10 px10 r6、14px 图标；组 4×6；分隔内缩 14）
 * - export-item：导出菜单（原型 .wf-export-menu：32h gap 8 r8 12.5px，悬停柔紫 #f4eef7 → violet-soft）
 * - align-*：对齐弹层（原型 .wf-align-pop：30h r8 12px 左对齐；小标 11px #a39ca0）
 */
.ctx-group {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
}
.ctx-sep {
  display: block;
  height: 1px;
  margin: 0 14px;
  background: rgb(var(--xq-ink-rgb) / 0.08);
}
.ctx-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 11px 14px 9px;
  border-bottom: 1px solid rgb(var(--xq-ink-rgb) / 0.08);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--xq-ink-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.ctx-item > svg {
  flex: none;
}
.ctx-kbd {
  margin-left: auto;
  color: var(--xq-placeholder);
  font-size: 11px;
  white-space: nowrap;
}
.ctx-item:hover:not(:disabled):not([aria-disabled='true']),
.ctx-item:focus-visible {
  background: rgb(var(--xq-ink-rgb) / 0.06);
  color: var(--xq-ink);
  outline: none;
}
.ctx-item:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--xq-focus-rgb) / 0.55);
}
.ctx-item.is-danger {
  color: var(--xq-danger-fg);
}
.ctx-item.is-danger:hover:not([aria-disabled='true']) {
  background: var(--xq-danger-soft);
  color: var(--xq-alert-danger);
}
.ctx-item:disabled,
.ctx-item[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.export-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--xq-ink-2);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.export-item > svg {
  flex: none;
}
.export-item:hover:not(:disabled) {
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
}
.export-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.align-label {
  grid-column: span 2;
  padding: 4px 8px 2px;
  color: var(--xq-placeholder);
  font-size: 11px;
  letter-spacing: 0.04em;
}
.align-item {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--xq-ink-2);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.align-item:hover {
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
}
.export-item:focus-visible,
.align-item:focus-visible {
  outline: 2px solid var(--xq-violet);
  outline-offset: -2px;
}
/* 空态按钮（原型 .wf-canvas-empty button：30h r4 藤紫浅底；命中区补到 32） */
.empty-btn {
  position: relative;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--xq-violet-line);
  border-radius: 14px;
  background: var(--xq-violet-soft);
  color: var(--xq-violet-ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  pointer-events: auto;
}
.empty-btn::after {
  content: '';
  position: absolute;
  inset: -1px 0;
}
.empty-btn:hover {
  border-color: var(--xq-violet);
  background: var(--xq-violet-soft-2);
}
/*
 * 模板模块底板（非成组）只作视觉框：Vue Flow 给监听了 node-click 的节点外层写行内 pointer-events:all，
 * 会挡住框内的框选 / 双击加节点（框选只在指针直接落在 pane 上时开始），这里用 !important 放行；
 * 框内的删除钮自己是 pointer-events:auto，照样能点。
 */
.vue-flow__node-module:has(.canvas-module-frame) {
  pointer-events: none !important;
}
/* 小地图（原型 .wf-minimap）：右下 16、r14、白 92%、细描边 + 短投影 */
.vue-flow__minimap.canvas-minimap {
  right: 16px !important;
  bottom: 16px !important;
  border: 1px solid var(--xq-line);
  border-radius: 14px;
  background: rgb(var(--xq-surface-rgb) / 0.92);
  box-shadow: 0 8px 20px rgba(16, 24, 40, 0.1);
  overflow: hidden;
}

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
