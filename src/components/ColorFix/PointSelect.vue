<script setup lang="ts">
/**
 * 局部调色 · 智能选区弹窗（参数台「点选」入口）：点选（本机 SlimSAM 分割，图片不出设备；模型 / 推理见 point-segment.ts）
 * + 钢笔 + 自由（套索）三种工具，每样都有「选中 + / 排除 −」两种模式，结果合成一份选区。
 *
 * <ul>
 *   <li>点选（V）：单击 = 加入（绿 +）；「排除 −」模式或 Alt / Shift + 单击 = 排除（红 −）；拖出一个框 = 只在框内找主体；
 *       点标记（或右键标记）= 删掉这个点。触屏：轻点 = 按当前模式加点，长按 = 排除，拖动 = 框选。
 *       正 / 负点与框一起交给解码器，3 张候选里挑「与提示点最一致、再看 IoU」的一张（见 point-segment.worker.ts）。</li>
 *   <li>钢笔（P）：单击加锚点（直线），按住拖动拉出曲线手柄（三次贝塞尔）；点起点 / 双击 / Enter 闭合，
 *       Backspace 删上一个锚点，Esc 放弃当前路径。</li>
 *   <li>自由（L）：按住拖动画轮廓，松开自动闭合并轻微平滑。打开「吸附边缘」= 磁性套索（live-wire，见 magnetic-lasso.ts）：
 *       单击放第一个锚点，移动指针时路径自动沿最近的边缘走；路径稳定一段后自动落锚点，单击手动加锚点，Backspace 删上一个，
 *       双击 / 点起点 / Enter 闭合（闭合段同样吸附），Esc 放弃；按住 Alt 临时改手绘（拖动 = 自由线，单击 = 直线段）。
 *       触屏：轻点 = 锚点，按住拖动预览、松手落锚点，第一下长按 = 排除，双击闭合。</li>
 *   <li>魔棒 / 颜色范围（W，2026-11-11）：单击一个颜色，按 OKLab 感知距离选相近颜色（容差滑杆）；「仅连续区域」从点击处泛洪，
 *       关掉 = 全图同色；选中 / 排除与钢笔、自由同口径合成，软边。拖容差滑杆时实时预览最近一次魔棒，松手才记进撤销栈。</li>
 *   <li>画笔（B）：在合成后的选区上直接涂（添加）/ 擦（擦除），大小 + 硬度；[ / ] 调大小。</li>
 *   <li>移动（H）/ 按住空格 / 鼠标中键：拖动画面；滚轮以指针为中心缩放，触屏双指捏合。移动工具下单击选区 = 选中，Delete 删除。</li>
 * </ul>
 * 最终选区 = ((点选蒙版 ∪ 已有选区 ∪ 添加的形状 / 魔棒) − 排除的形状 / 魔棒) → 画笔逐笔涂 / 擦 → 扩展 / 收缩 → 平滑
 * （selection-geometry.ts combineMasks + selection-ops.ts）。所有操作（点 / 框 / 形状 / 魔棒 / 笔画 / 扩展收缩平滑 / 删除 /
 * 改模式）进同一条撤销栈：⌘/Ctrl+Z 撤销、Shift+⌘/Ctrl+Z（或 Ctrl+Y）重做。
 *
 * <p>`base-mask`：打开时把这一层已有的选区垫在最下面（「重新选区 / 重新涂抹」= 在原选区上细化，「清空」才从头来）；
 * `initial-tool`：手动涂抹入口传 brush（同一个弹窗，画笔预选）；`sam-disabled`：浏览器不支持点选时隐藏点选工具，其余照常。
 * 点选模型只在第一次用到点选时才加载。
 *
 * <p>「完成」：只有点选时导出模型网格（长边 1024）的黑底白选区 PNG（与以前一致）；有钢笔 / 自由形状时按工作分辨率
 * （长边 = 原图长边夹到 1024–2048）把点选蒙版放大后与形状合成导出。交给 useResultColorFix.applyPointMask，反选 / 柔化照常在参数台调。
 * 点选模型加载失败时钢笔 / 自由照样能用。关闭时终止 Worker，释放 WASM / GPU 内存。`large`：全屏调色里打开时弹窗接近整屏。
 *
 * <p>2026-11-11 增补：
 * <ul>
 *   <li>选框（M）：矩形 / 椭圆（再按 M 切换），Shift = 正方形 / 正圆、Alt = 从中心拉出；添加 / 排除同其它形状。</li>
 *   <li>查看方式：叠加（半透明藤紫）/ 黑白蒙版 / 仅选区（选区外棋盘格）/ 轮廓（行军蚁虚线）；按浏览器记住。</li>
 *   <li>继续编辑：`session-loader` 取回这一层上次的会话（selection-session.ts）就原样还原（点选结果连同位图一起存，
 *       不必重新加载模型）；「完成」时 apply 第二个参数带上本次会话，由调用方与蒙版一起存。</li>
 *   <li>钢笔路径可再编辑：选中钢笔形状（移动工具单击 / 钢笔工具 ⌘/Ctrl + 单击 / 区域列表）后显示锚点与手柄，拖锚点移动、
 *       拖手柄调曲线（Alt 拖 = 断开对称）、双击路径加锚点、Delete 删锚点。</li>
 * </ul>
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import { PAINTED_MASK_MAX_SIDE } from './mask-store.ts'
import {
  applyClampMaps,
  applyPostOps,
  colorRangeMask,
  renderMaskView,
  rgbaToLab,
  stampStroke,
  MASK_VIEW_HINTS,
  MASK_VIEW_LABELS,
  POST_OPS_NONE,
  type BrushStroke,
  type MaskViewMode,
  type SelectionPostOps,
} from './selection-ops.ts'
import {
  SESSION_STROKE_POINTS_MAX,
  strokePointCount,
  type SelectionDoc,
  type SelectionSession,
  type WandOp,
} from './selection-session.ts'
import { markPointSegmentBroken, POINT_UNSUPPORTED_HINT } from './point-support.ts'
import { disposeEdgeCost, loadEdgeCost } from './edge-cost.ts'
import {
  boxAround,
  coolStable,
  cooledIndex,
  LiveWire,
  smoothGridPath,
  snapTarget,
  type EdgeCostMap,
} from './magnetic-lasso.ts'
import {
  combineMasks,
  contoursToPath,
  distToPolygonEdge,
  ellipsePolygon,
  inHandle,
  insertPenNode,
  lassoToPolygon,
  marqueeRect,
  maskContours,
  maskHasSelection,
  movePenHandle,
  nearestOnPen,
  outHandle,
  penToPolyline,
  pointInPolygon,
  polygonArea,
  rasterizeShapes,
  rectPolygon,
  type PenNode,
  type Pt,
  type Rect,
  type SelectionShape,
  type ShapeMode,
} from './selection-geometry.ts'
import type {
  PointBox,
  PointMaskResult,
  PointPrompt,
  PointSegmenter,
  PointSegmentError,
  PointSegmentProgress,
} from './point-segment.ts'

/** 同 pointSegment.ts 的 POINT_SEGMENT_INPUT_SIDE（不静态引那个模块：它随点选弹窗一起懒加载） */
const POINT_SEGMENT_INPUT_SIDE = 1024

type Tool = 'point' | 'marquee' | 'pen' | 'lasso' | 'wand' | 'brush' | 'move'

const {
  src,
  large = false,
  initialTool = 'point',
  samDisabled = false,
  baseMask = '',
  title = '智能选区',
  sessionLoader,
} = defineProps<{
  src: string
  /** 大尺寸（全屏调色里打开） */
  large?: boolean
  /** 打开时选中的工具（手动涂抹入口 = brush） */
  initialTool?: Tool
  /** 点选（本机 SAM）不可用：隐藏点选工具，其余工具照常 */
  samDisabled?: boolean
  /** 这一层已有的选区（黑白 / 透明蒙版地址）：垫在最下面细化；'' = 从空白开始 */
  baseMask?: string
  title?: string
  /** 取回这一层上次的选区会话（继续编辑）；返回 null = 没有 / 对不上，从 base-mask 开始 */
  sessionLoader?: () => Promise<SelectionSession | null>
}>()
const show = defineModel<boolean>('show', { required: true })
/** apply：mask = 黑底白选区 PNG；session = 本次编辑状态（调用方随蒙版存，下次还原） */
const emit = defineEmits<{ apply: [mask: Blob, session?: Omit<SelectionSession, 'maskSize'>] }>()

const ALL_TOOLS: { key: Tool; label: string; kbd: string; hint: string; icon: string }[] = [
  {
    key: 'point',
    label: '点选',
    kbd: 'V',
    hint: '点选：单击物体自动识别选区',
    icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12h.01',
  },
  {
    key: 'marquee',
    label: '选框',
    kbd: 'M',
    hint: '选框：拖出矩形 / 椭圆（再按 M 切换），Shift 正方形 / 正圆，Alt 从中心',
    icon: 'M4 7V5a1 1 0 0 1 1-1h2M10 4h4M17 4h2a1 1 0 0 1 1 1v2M20 10v4M20 17v2a1 1 0 0 1-1 1h-2M14 20h-4M7 20H5a1 1 0 0 1-1-1v-2M4 14v-4',
  },
  {
    key: 'pen',
    label: '钢笔',
    kbd: 'P',
    hint: '钢笔：逐点勾勒轮廓，拖动拉出曲线',
    icon: 'M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  },
  {
    key: 'lasso',
    label: '自由',
    kbd: 'L',
    hint: '自由：按住拖动画出轮廓，松开自动闭合；打开「吸附边缘」沿物体边缘自动贴合',
    icon: 'M7 22a5 5 0 0 1-2-4M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  },
  {
    key: 'wand',
    label: '魔棒',
    kbd: 'W',
    hint: '魔棒：单击一个颜色，选中相近颜色',
    icon: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
  },
  {
    key: 'brush',
    label: '画笔',
    kbd: 'B',
    hint: '画笔：在选区上直接涂抹添加 / 擦除',
    icon: 'M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z',
  },
  {
    key: 'move',
    label: '移动',
    kbd: 'H',
    hint: '移动：拖动画面，单击选区可选中',
    icon: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  },
]
const TOOLS = computed(() => ALL_TOOLS.filter((t) => t.key !== 'point' || !samDisabled))
const TOOL_TIPS: Record<Tool, string> = {
  wand: '单击要选的颜色；调「容差」放宽 / 收紧，「仅连续区域」只选与点击处相连的部分；Alt / Shift + 单击排除',
  brush: '按住拖动涂抹添加，切到「擦除」或按住 Alt 擦掉；[ / ] 调画笔大小',
  point: '单击加入选区；切到「排除 −」或按住 Alt / Shift 单击排除；拖动框选；点标记可删除',
  marquee: '拖出选框；Shift 正方形 / 正圆，Alt 从中心拉出；再按 M 在矩形与椭圆间切换',
  pen: '单击加锚点，按住拖动拉出曲线；点起点 / 双击 / Enter 闭合。⌘/Ctrl + 单击路径可选中再编辑：拖锚点 / 手柄（Alt 断开对称），双击路径加锚点，Delete 删锚点',
  lasso: '按住拖动画出轮廓，松开自动闭合；打开「吸附边缘」后单击起点、沿物体边缘移动即可自动贴边',
  move: '拖动画面（也可按住空格 / 鼠标中键）；单击选区可选中，Delete 删除；选中钢笔路径后可拖锚点 / 手柄编辑',
}

// ================= 文档：点 / 框 / 形状，整条撤销栈 =================

/**
 * 文档 = 会话里存的那份（selection-session.ts SelectionDoc）+ flatBrush：上次会话的笔画太多、已压成夹取图
 * （brushMap，见 selection-ops strokeClampMaps），「清空」时连它一起去掉。
 */
interface SelDoc extends SelectionDoc {
  flatBrush?: boolean
}
const EMPTY: SelDoc = { points: [], box: null, shapes: [], wands: [], strokes: [], post: POST_OPS_NONE, prior: false }
const START: SelDoc = { ...EMPTY, prior: !!baseMask }
const HISTORY_MAX = 100
const history = shallowRef<SelDoc[]>([START])
const hIndex = ref(0)
const doc = computed(() => history.value[hIndex.value] ?? START)
let shapeSeq = 0

function commit(next: SelDoc) {
  const list = [...history.value.slice(0, hIndex.value + 1), next]
  history.value = list.length > HISTORY_MAX ? list.slice(list.length - HISTORY_MAX) : list
  hIndex.value = history.value.length - 1
}

const tool = ref<Tool>(initialTool === 'point' && samDisabled ? 'brush' : initialTool)
const mode = ref<ShapeMode>('add')
const selectedId = ref<number | null>(null)
/** 钢笔正在画的路径 */
const penNodes = ref<PenNode[]>([])
const penMode = ref<ShapeMode>('add')
/** 自由正在画的原始轨迹（原图坐标） */
const lassoPts = shallowRef<Pt[]>([])
const lassoMode = ref<ShapeMode>('add')
const hover = ref<Pt | null>(null)

const isEmpty = computed(() => {
  const d = doc.value
  return (
    !d.points.length &&
    !d.box &&
    !d.shapes.length &&
    !d.wands.length &&
    !d.strokes.length &&
    !d.prior &&
    !d.flatBrush &&
    !d.post.grow &&
    !d.post.smooth
  )
})
const canUndo = computed(() => penNodes.value.length > 0 || magActive.value || hIndex.value > 0)
const canRedo = computed(() => !penNodes.value.length && !magActive.value && hIndex.value < history.value.length - 1)
const canClear = computed(() => !isEmpty.value || penNodes.value.length > 0 || magActive.value)
/** Esc 先由弹窗内部消化（放弃路径 / 取消选中），这时不让 n-modal 关窗 */
const escBusy = computed(
  () =>
    penNodes.value.length > 0 ||
    lassoPts.value.length > 0 ||
    magActive.value ||
    selectedId.value !== null ||
    !!liveStroke.value ||
    !!marqueeDraft.value ||
    selAnchor.value !== null,
)

function undo() {
  if (penNodes.value.length) {
    penNodes.value = penNodes.value.slice(0, -1)
    return
  }
  if (magActive.value) {
    magBack()
    return
  }
  if (hIndex.value > 0) hIndex.value -= 1
  wandDraft.value = null
  postDraft.value = null
}
function redo() {
  if (!canRedo.value) return
  hIndex.value += 1
  wandDraft.value = null
  postDraft.value = null
}
function clearAll() {
  penNodes.value = []
  lassoPts.value = []
  magCancel()
  selectedId.value = null
  if (!isEmpty.value) commit(EMPTY)
}

watch(doc, (d) => {
  if (selectedId.value !== null && !d.shapes.some((s) => s.id === selectedId.value)) selectedId.value = null
  const sp = selectedPen.value
  if (selAnchor.value !== null && (!sp || selAnchor.value >= (sp.nodes?.length ?? 0))) selAnchor.value = null
})
watch(selectedId, () => {
  selAnchor.value = null
  penDraft.value = null
})

/** 选框形状（M 再按一次切换） */
const marqueeShape = ref<'rect' | 'ellipse'>('rect')
/** 正在拖的选框（原图坐标） */
const marqueeDraft = shallowRef<Rect | null>(null)
const marqueeMode = ref<ShapeMode>('add')

function setTool(t: Tool) {
  if (t === tool.value) return
  // 换工具时，已有 3 个以上锚点的钢笔路径自动闭合，少于 3 个的放弃
  if (penNodes.value.length) closePen()
  // 磁性路径同理：够闭合就闭合（magClose 自己丢掉太小的）
  if (magActive.value) magClose()
  tool.value = t
  hover.value = null
  if (t === 'point') ensureModel()
}

function removePoint(i: number) {
  const d = doc.value
  commit({ ...d, points: d.points.filter((_, k) => k !== i) })
}
function removeShape(id: number) {
  const d = doc.value
  commit({ ...d, shapes: d.shapes.filter((s) => s.id !== id) })
  if (selectedId.value === id) selectedId.value = null
}
function toggleShapeMode(id: number) {
  const d = doc.value
  commit({
    ...d,
    shapes: d.shapes.map((s) => (s.id === id ? { ...s, mode: s.mode === 'add' ? 'sub' : 'add' } : s)),
  })
}
function addShape(kind: SelectionShape['kind'], m: ShapeMode, poly: Pt[], nodes?: PenNode[]) {
  const d = doc.value
  const shape: SelectionShape = { id: ++shapeSeq, kind, mode: m, poly, ...(nodes ? { nodes } : {}) }
  commit({ ...d, shapes: [...d.shapes, shape] })
}

// ================= 钢笔路径编辑（闭合后再改） =================

/** 选中的钢笔形状（有锚点才可编辑） */
const selectedPen = computed(() => {
  const s = doc.value.shapes.find((x) => x.id === selectedId.value)
  return s && s.kind === 'pen' && s.nodes && s.nodes.length >= 3 ? s : null
})
/** 选中的锚点（Delete 删它） */
const selAnchor = ref<number | null>(null)
/** 拖动中的锚点草稿（松手才进撤销栈） */
const penDraft = shallowRef<{ id: number; nodes: PenNode[] } | null>(null)
/** 编辑中显示的锚点（草稿优先） */
const editNodes = computed<PenNode[]>(() => {
  const sp = selectedPen.value
  if (!sp) return []
  const d = penDraft.value
  return d && d.id === sp.id ? d.nodes : sp.nodes!
})
function penPoly(nodes: PenNode[]): Pt[] {
  return penToPolyline(nodes, true, Math.max(0.25, 0.5 * imgPerScreen.value))
}
/** 参与合成的形状（拖锚点时用草稿实时预览） */
const liveShapes = computed<SelectionShape[]>(() => {
  const d = penDraft.value
  if (!d) return doc.value.shapes
  return doc.value.shapes.map((s) => (s.id === d.id ? { ...s, nodes: d.nodes, poly: penPoly(d.nodes) } : s))
})
function commitPenNodes(id: number, nodes: PenNode[]) {
  const d = doc.value
  const poly = penPoly(nodes)
  if (poly.length < 3) return
  commit({ ...d, shapes: d.shapes.map((s) => (s.id === id ? { ...s, nodes, poly } : s)) })
}
function removeAnchor(i: number) {
  const sp = selectedPen.value
  if (!sp?.nodes) return
  if (sp.nodes.length <= 3) {
    removeShape(sp.id)
    return
  }
  commitPenNodes(
    sp.id,
    sp.nodes.filter((_, k) => k !== i),
  )
  selAnchor.value = null
}
/** 编辑命中：锚点 / 手柄 / 路径段（屏幕 HIT_PX 内）；没命中返回 null */
function penEditHit(p: Pt): { what: 'anchor' | 'out' | 'in'; index: number } | { what: 'segment' } | null {
  const nodes = editNodes.value
  if (!nodes.length) return null
  const r = HIT_PX * imgPerScreen.value
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!
    if (n.hx || n.hy || n.ix || n.iy) {
      const o = outHandle(n)
      if (Math.hypot(o.x - p.x, o.y - p.y) <= r * 0.8) return { what: 'out', index: i }
      const h = inHandle(n)
      if (Math.hypot(h.x - p.x, h.y - p.y) <= r * 0.8) return { what: 'in', index: i }
    }
  }
  for (let i = nodes.length - 1; i >= 0; i--)
    if (Math.hypot(nodes[i]!.x - p.x, nodes[i]!.y - p.y) <= r) return { what: 'anchor', index: i }
  if (nearestOnPen(nodes, p).dist <= 6 * imgPerScreen.value) return { what: 'segment' }
  return null
}
/** 双击路径：在最近处插锚点（曲线形状不变） */
function onStageDblClick(e: MouseEvent) {
  const sp = selectedPen.value
  if (!sp?.nodes || penNodes.value.length || (tool.value !== 'pen' && tool.value !== 'move')) return
  const p = toImage(e)
  if (!p) return
  const near = nearestOnPen(sp.nodes, p)
  if (near.seg < 0 || near.dist > 6 * imgPerScreen.value) return
  // 双击落在锚点上不插（那是在拖锚点）
  if (sp.nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) <= HIT_PX * imgPerScreen.value)) return
  const nodes = insertPenNode(sp.nodes, near.seg, near.t)
  commitPenNodes(sp.id, nodes)
  selAnchor.value = near.seg + 1
}

// ================= 点选模型 =================

const seg = shallowRef<PointSegmenter | null>(null)
const modelReady = ref(false)
/** 下载进度（字节）；null = 还没开始报 */
const loadBytes = shallowRef<PointSegmentProgress | null>(null)
/** 总进度 0–99（只算下载；建会话那一下不计） */
const progress = computed(() => {
  const p = loadBytes.value
  if (!p) return 0
  const total = p.engine.total + p.model.total
  return total > 0 ? Math.min(99, Math.round(((p.engine.loaded + p.model.loaded) / total) * 100)) : 0
})
/** 十进制 MB（与文件管理器 / CDN 控制台口径一致：28,747,738 字节 = 28.7 MB） */
const mb = (n: number) => (n / 1e6).toFixed(1)
/** 加载阶段的一句话：先引擎后模型，都下完 = 启动中 */
const loadText = computed(() => {
  const p = loadBytes.value
  if (!p) return '正在准备点选…'
  const engineLeft = p.engine.total > 0 && p.engine.loaded < p.engine.total
  const modelLeft = p.model.total > 0 && p.model.loaded < p.model.total
  if (engineLeft) {
    const extra = modelLeft ? ` · 模型 ${mb(p.model.loaded)}/${mb(p.model.total)} MB` : ''
    return `下载识别引擎 ${mb(p.engine.loaded)}/${mb(p.engine.total)} MB${extra}`
  }
  if (modelLeft) return `下载点选模型 ${mb(p.model.loaded)}/${mb(p.model.total)} MB`
  return '正在启动点选…'
})
const embedding = ref(false)
const decoding = ref(false)
const exporting = ref(false)
const error = ref('')
const retryable = ref(false)
const result = shallowRef<PointMaskResult | null>(null)
const natural = ref({ w: 0, h: 0 })
const dragBox = ref<PointBox | null>(null)

const hasPositive = computed(() => !!doc.value.box || doc.value.points.some((p) => p.label === 1))
/** result 对应的点 / 框（按引用）：会话还原时直接带着上次的结果，点 / 框没动就不用重算 */
const resultFor = shallowRef<{ points: PointPrompt[]; box: PointBox | null } | null>(null)
const resultMatches = computed(
  () => !!result.value && !!resultFor.value && resultFor.value.points === doc.value.points && resultFor.value.box === doc.value.box,
)
/** 点选还欠一个结果（有正点 / 框，模型没出错，但还没算完）：这时「完成」会把点选丢掉，先不让点 */
const samPending = computed(
  () =>
    hasPositive.value &&
    !error.value &&
    !resultMatches.value &&
    (!modelReady.value || embedding.value || decoding.value || !result.value),
)

const status = computed(() => {
  if (exporting.value) return '正在导出选区…'
  if (restoring.value) return '正在恢复上次的选区…'
  if (restoredNote.value) return '已恢复上次的选区，可以继续编辑（「清空」从头开始）'
  if (selectedPen.value && !penNodes.value.length && (tool.value === 'pen' || tool.value === 'move'))
    return selAnchor.value !== null
      ? '拖动锚点移动；拖手柄调曲线（Alt 断开对称）；Delete 删除这个锚点'
      : '已选中钢笔路径：拖锚点 / 手柄编辑，双击路径加锚点，Esc 取消选中'
  if (tool.value === 'point' && !error.value) {
    if (!modelReady.value) return loadText.value
    if (embedding.value) return '正在识别图片…'
    if (decoding.value) return '正在计算选区…'
    if (doc.value.points.length && !hasPositive.value) return '只有排除点：先点选要保留的物体，或用钢笔 / 自由圈出区域'
  }
  if (tool.value === 'lasso' && magnetic.value) {
    if (edgeFailed.value) return '这张图片读不了像素，吸附边缘用不了，已按普通自由套索画'
    if (magActive.value) {
      if (magAlt.value) return '临时手绘：拖动画自由线，单击画直线；松开 Alt 回到吸附'
      if (magNearStart.value) return '单击闭合选区'
      return edgeLoading.value && !edgeMap.value
        ? '正在分析图片边缘…（先按直线连接）'
        : '沿边缘移动，路径自动吸附并落锚点；单击加锚点，Backspace 删上一个，双击 / 点起点 / Enter 闭合，Esc 放弃；按住 Alt 临时手绘'
    }
    if (edgeLoading.value) return '正在分析图片边缘…'
    return '吸附边缘：单击物体边缘放下起点，然后沿边缘移动；Alt / Shift + 单击起点 = 排除'
  }
  if (tool.value === 'pen' && penNodes.value.length) {
    return penNodes.value.length < 3
      ? `已放 ${penNodes.value.length} 个锚点，至少 3 个才能闭合`
      : '点起点、双击或按 Enter 闭合；Backspace 删上一点，Esc 放弃'
  }
  return TOOL_TIPS[tool.value]
})

function describe(err: unknown, init: boolean): { text: string; retry: boolean } {
  const e = err as PointSegmentError | undefined
  if (e?.kind === 'cors') return { text: '这张图片不允许读取像素，无法点选（校色效果同样无法生成）', retry: false }
  if (e?.kind === 'network') return { text: '点选模型下载失败，请检查网络后重试', retry: true }
  if (e?.message === '已关闭') return { text: '', retry: false }
  // 模型起不来（两种后端都失败）= 浏览器不支持；识别 / 计算 / 导出中途出错多半是一次性的，给重试
  if (init) return { text: POINT_UNSUPPORTED_HINT, retry: false }
  return { text: '选区计算出错，请重试', retry: true }
}

/** init = 模型加载（ready）失败：只有这种 runtime 错误才把本会话的点选整体置灰 */
function fail(err: unknown, init = false) {
  const { text, retry } = describe(err, init)
  if (!text) return
  error.value = text
  retryable.value = retry
  if (init && !retry && (err as PointSegmentError | undefined)?.kind === 'runtime') markPointSegmentBroken()
}

/** 重试：模型已就绪只是中途出错 → 清掉错误重算；模型没起来 → 重新加载 */
function retry() {
  if (modelReady.value && seg.value) {
    error.value = ''
    retryable.value = false
    void refresh()
    return
  }
  void start()
}

/** 点选模型已开始加载（第一次用到点选时才加载，手动涂抹入口不白下几十 MB） */
const modelStarted = ref(false)
function ensureModel() {
  if (modelStarted.value || samDisabled) return
  void start()
}

async function start() {
  modelStarted.value = true
  error.value = ''
  retryable.value = false
  modelReady.value = false
  loadBytes.value = null
  seg.value?.dispose()
  seg.value = null
  try {
    const { createPointSegmenter } = await import('./point-segment.ts')
    const s = createPointSegmenter({
      onProgress: (p) => {
        if (seg.value === s || !seg.value) loadBytes.value = p
      },
    })
    seg.value = s
    await s.ready
    if (seg.value !== s) return
    modelReady.value = true
    if ((doc.value.points.length || doc.value.box) && !resultMatches.value) void refresh()
  } catch (err) {
    fail(err, true)
  }
}

const viewportH = ref(typeof window === 'undefined' ? 720 : window.innerHeight)
function onResize() {
  viewportH.value = window.innerHeight
}
let observer: ResizeObserver | null = null

onMounted(() => {
  if (tool.value === 'point') ensureModel()
  measure()
  // 捕获阶段：先于宿主页面（画布等）在 window 上的快捷键，处理过的键不再往外传
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('resize', onResize)
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('keyup', onKeyUp, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('blur', onBlur)
  observer?.disconnect()
  viewportEl.value?.removeEventListener('wheel', onWheel)
  clearTimeout(pressTimer)
  if (recomposeRaf) cancelAnimationFrame(recomposeRaf)
  if (draftTimer) clearTimeout(draftTimer)
  seg.value?.dispose()
  seg.value = null
  if (outlineTimer) clearTimeout(outlineTimer)
  if (sessionPriorUrl) URL.revokeObjectURL(sessionPriorUrl)
  if (magRaf) cancelAnimationFrame(magRaf)
  disposeEdgeCost()
})

// ---------------- 推理：最新优先，进行中有新操作就再跑一轮 ----------------

let running = false
let dirty = false
async function refresh() {
  const s = seg.value
  if (!s || !modelReady.value || error.value) return
  // 会话还原带来的结果还对得上（点 / 框没动）：不重算
  if (resultMatches.value) return
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    do {
      dirty = false
      const ptsRef = doc.value.points
      const pts = ptsRef.slice()
      const b = doc.value.box
      if (!pts.length && !b) {
        result.value = null
        resultFor.value = null
        continue
      }
      embedding.value = true
      try {
        await s.prepare(src)
      } finally {
        embedding.value = false
      }
      decoding.value = true
      try {
        const r = await s.decode(pts, b)
        if (!dirty) {
          result.value = r
          resultFor.value = { points: ptsRef, box: b }
        }
      } finally {
        decoding.value = false
      }
    } while (dirty)
  } catch (err) {
    fail(err)
  } finally {
    running = false
  }
}

// 分开两个源逐个比引用：getter 返回新元组会让每次提交（加形状 / 改模式）都重跑解码、「完成」闪成不可点
watch(
  [() => doc.value.points, () => doc.value.box],
  ([pts, b]) => {
    if (!pts.length && !b) {
      result.value = null
      resultFor.value = null
    }
    void refresh()
  },
)

// ================= 合成预览：(点选 ∪ 添加) − 排除，模型网格（长边 1024） =================

const overlay = ref<HTMLCanvasElement | null>(null)
/** 舞台上的原图（带 crossorigin，魔棒从它读像素） */
const imgEl = ref<HTMLImageElement | null>(null)
const composite = shallowRef<{ mask: Uint8Array; width: number; height: number } | null>(null)
const hasSelection = computed(() => maskHasSelection(composite.value?.mask ?? null))

/** 原图 → 网格尺寸（长边 = side，与 point-segment prepare 同口径） */
function gridOf(side: number) {
  const { w, h } = natural.value
  const s = side / Math.max(w, h)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** 网格不一致时最近邻重采样（正常情况下 SAM 网格就是预览网格，直接复用） */
function resampleNearest(mask: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return mask
  const out = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh))
    for (let x = 0; x < dw; x++) out[y * dw + x] = mask[sy * sw + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw))]!
  }
  return out
}

// ---------------- 魔棒 / 已有选区要读原图 / 蒙版像素（预览网格，第一次用到时读） ----------------

/** 原图在预览网格上的 OKLab（魔棒用）；null = 还没读 / 读不了 */
let labGrid: { lab: Float32Array; w: number; h: number } | null = null
const pixelError = ref('')
function gridLab(): { lab: Float32Array; w: number; h: number } | null {
  const { w: nw, h: nh } = natural.value
  if (!nw || !nh) return null
  const g = gridOf(POINT_SEGMENT_INPUT_SIDE)
  if (labGrid && labGrid.w === g.w && labGrid.h === g.h) return labGrid
  const el = imgEl.value
  if (!el) return null
  try {
    const c = document.createElement('canvas')
    c.width = g.w
    c.height = g.h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('画布不可用')
    ctx.drawImage(el, 0, 0, g.w, g.h)
    const data = ctx.getImageData(0, 0, g.w, g.h).data
    c.width = c.height = 0
    labGrid = { lab: rgbaToLab(data, g.w, g.h), w: g.w, h: g.h }
    return labGrid
  } catch {
    pixelError.value = '这张图片不允许读取像素，魔棒用不了（钢笔、自由、画笔不受影响）'
    return null
  }
}

/** 魔棒结果缓存（按 id + 容差 + 连续，预览网格） */
const wandCache = new Map<string, Uint8Array>()
function wandMask(op: WandOp): Uint8Array | null {
  const k = `${op.id}|${op.tol}|${op.contiguous ? 1 : 0}`
  const hit = wandCache.get(k)
  if (hit) return hit
  const lg = gridLab()
  if (!lg) return null
  const { w: nw, h: nh } = natural.value
  const m = colorRangeMask(lg.lab, lg.w, lg.h, (op.x / nw) * lg.w, (op.y / nh) * lg.h, {
    tolerance: op.tol,
    contiguous: op.contiguous,
  })
  wandCache.set(k, m)
  // 只留最近 24 份（拖容差会产生很多中间值）
  while (wandCache.size > 24) wandCache.delete(wandCache.keys().next().value as string)
  return m
}

/** 已有选区（base-mask）：图片元素（导出时按导出网格重画）+ 预览网格上的值 */
const priorImg = shallowRef<HTMLImageElement | null>(null)
let priorGridCache: { mask: Uint8Array; w: number; h: number } | null = null
function readMaskImage(img: HTMLImageElement, w: number, h: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('画布不可用')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  c.width = c.height = 0
  let opaque = true
  for (let i = 3; i < data.length; i += 4)
    if (data[i]! < 255) {
      opaque = false
      break
    }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++)
    out[i] = opaque
      ? Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!)
      : data[i * 4 + 3]!
  return out
}
function priorAt(w: number, h: number): Uint8Array | null {
  const img = priorImg.value
  if (!img) return null
  if (priorGridCache && priorGridCache.w === w && priorGridCache.h === h) return priorGridCache.mask
  try {
    const mask = readMaskImage(img, w, h)
    priorGridCache = { mask, w, h }
    return mask
  } catch {
    return null
  }
}
/** 已有选区读不出来（blob 已回收等）：当作没有，不挡「完成」 */
const priorFailed = ref(false)
/** 垫底选区的来源：base-mask，或会话还原时会话里存的那张（objectURL，卸载时回收） */
const priorSrc = ref(baseMask)
let sessionPriorUrl = ''
/** 垫着已有选区但还没读到：这时「完成」会把已有选区丢掉，先不让点 */
const priorPending = computed(() => doc.value.prior && !!priorSrc.value && !priorImg.value && !priorFailed.value)
function loadPrior(url: string) {
  priorImg.value = null
  priorGridCache = null
  priorFailed.value = false
  priorSrc.value = url
  if (!url) return
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (priorSrc.value !== url) return
    priorGridCache = null
    priorImg.value = img
  }
  img.onerror = () => {
    if (priorSrc.value === url) priorFailed.value = true
  }
  img.src = url
}
loadPrior(baseMask)

/** 上次会话压成的笔画夹取图（预览网格）；doc.flatBrush 为真时生效 */
let brushMap: { lo: Uint8Array; hi: Uint8Array; w: number; h: number } | null = null
const brushMapCache = new Map<string, { lo: Uint8Array; hi: Uint8Array }>()
function brushMapAt(W: number, H: number): { lo: Uint8Array; hi: Uint8Array } | null {
  const m = brushMap
  if (!m) return null
  if (m.w === W && m.h === H) return m
  const k = `${W}x${H}`
  const hit = brushMapCache.get(k)
  if (hit) return hit
  const out = { lo: upscaleMask(m.lo, m.w, m.h, W, H), hi: upscaleMask(m.hi, m.w, m.h, W, H) }
  brushMapCache.clear()
  brushMapCache.set(k, out)
  return out
}

// ---------------- 拖滑杆时的草稿（实时预览，松手才进撤销栈） ----------------

/** 魔棒容差 / 连续的默认值（下一次单击用），拖动时也改最近一次魔棒 */
const wandTol = ref(16)
const wandContiguous = ref(true)
/** 正在拖的最近一次魔棒参数（id 对上才生效） */
const wandDraft = shallowRef<{ id: number; tol: number; contiguous: boolean } | null>(null)
/** 正在拖的扩展 / 收缩 / 平滑 */
const postDraft = shallowRef<SelectionPostOps | null>(null)
/** 画笔：直径（按网格长边 1024 计的像素）与硬度 0–100 */
const brushSize = ref(40)
const brushHardness = ref(70)
/** 正在画的一笔（松手进撤销栈） */
const liveStroke = shallowRef<BrushStroke | null>(null)
let strokeSeq = 0
let wandSeq = 0

/** 最近一次提交的是魔棒（且之后没有别的操作）：拖容差改它 */
const lastWand = computed(() => {
  const d = doc.value
  const op = d.wands[d.wands.length - 1]
  if (!op) return null
  // 往回找到加入这次魔棒的那一步；中间只允许改过它自己的容差 / 连续（否则调一次容差后就再也调不动了）
  const list = history.value
  for (let i = hIndex.value; i > 0; i--) {
    const cur = list[i]!
    const prev = list[i - 1]!
    if (!prev.wands.some((w) => w.id === op.id)) return op
    const onlyRetuned =
      sameExceptWands(prev, cur) &&
      prev.wands.length === cur.wands.length &&
      prev.wands[prev.wands.length - 1]?.id === op.id
    if (!onlyRetuned) return null
  }
  return null
})
function sameExceptWands(a: SelDoc, b: SelDoc): boolean {
  return (
    a.points === b.points &&
    a.box === b.box &&
    a.shapes === b.shapes &&
    a.strokes === b.strokes &&
    a.post === b.post &&
    a.prior === b.prior
  )
}
const effectiveWands = computed(() => {
  const draft = wandDraft.value
  return doc.value.wands.map((w) => (draft && draft.id === w.id ? { ...w, tol: draft.tol, contiguous: draft.contiguous } : w))
})
const effectivePost = computed(() => postDraft.value ?? doc.value.post)
const allStrokes = computed(() => (liveStroke.value ? [...doc.value.strokes, liveStroke.value] : doc.value.strokes))

let draftTimer: ReturnType<typeof setTimeout> | null = null
/** 滑杆拖动中：节流 90ms 重算预览 */
function schedulePreview() {
  if (draftTimer) return
  draftTimer = setTimeout(() => {
    draftTimer = null
    recompose()
  }, 90)
}

function onWandTol(v: number, final: boolean) {
  wandTol.value = v
  const op = lastWand.value
  if (!op) return
  if (!final) {
    wandDraft.value = { id: op.id, tol: v, contiguous: wandContiguous.value }
    schedulePreview()
    return
  }
  wandDraft.value = null
  if (op.tol !== v) {
    const d = doc.value
    commit({ ...d, wands: d.wands.map((w) => (w.id === op.id ? { ...w, tol: v } : w)) })
  }
}
function onWandContiguous(v: boolean) {
  wandContiguous.value = v
  const op = lastWand.value
  if (!op || op.contiguous === v) return
  const d = doc.value
  commit({ ...d, wands: d.wands.map((w) => (w.id === op.id ? { ...w, contiguous: v } : w)) })
}
function onPost(patch: Partial<SelectionPostOps>, final: boolean) {
  const next = { ...effectivePost.value, ...patch }
  if (!final) {
    postDraft.value = next
    schedulePreview()
    return
  }
  postDraft.value = null
  const d = doc.value
  if (next.grow !== d.post.grow || next.smooth !== d.post.smooth) commit({ ...d, post: next })
  else recompose()
}

function addWand(p: Pt, m: ShapeMode) {
  if (!gridLab()) return
  const d = doc.value
  const op: WandOp = { id: ++wandSeq, x: p.x, y: p.y, tol: wandTol.value, contiguous: wandContiguous.value, mode: m }
  commit({ ...d, wands: [...d.wands, op] })
}

/** 画笔半径（原图像素）：直径按网格长边 1024 计 */
const brushRadius = computed(() => {
  const { w, h } = natural.value
  return (brushSize.value / 2) * (Math.max(w, h, 1) / POINT_SEGMENT_INPUT_SIDE)
})

// ---------------- 合成 ----------------

/** 合成到 W×H 网格：((点选 ∪ 已有 ∪ 添加) − 排除) → 笔画 → 扩展 / 收缩 → 平滑；scale = 网格长边 / 1024 */
function composeAt(
  W: number,
  H: number,
  base: Uint8Array | null,
  wandAt: (op: WandOp) => Uint8Array | null,
  strokes: readonly BrushStroke[],
  post: SelectionPostOps,
): Uint8Array | null {
  const { w: nw, h: nh } = natural.value
  const size = W * H
  const { add, sub } = rasterizeShapes(liveShapes.value, W, H, W / nw, H / nh)
  let addM = add
  let subM = sub
  for (const op of effectiveWands.value) {
    const m = wandAt(op)
    if (!m) continue
    const target = op.mode === 'add' ? (addM ??= new Uint8Array(size)) : (subM ??= new Uint8Array(size))
    for (let i = 0; i < size; i++) if (m[i]! > target[i]!) target[i] = m[i]!
  }
  const prior = doc.value.prior ? priorAt(W, H) : null
  let b = base
  if (prior) {
    if (!b) b = prior
    else {
      const u = new Uint8Array(size)
      for (let i = 0; i < size; i++) u[i] = Math.max(b[i]!, prior[i]!)
      b = u
    }
  }
  const flat = doc.value.flatBrush ? brushMapAt(W, H) : null
  if (!b && !addM && !flat && !strokes.some((s) => s.mode === 'add')) return null
  let out = combineMasks(size, b, addM, subM)
  // 上次会话压成的笔画（更早的笔画）先套，再按顺序盖这次的笔画——与逐笔重放结果一致
  if (flat) applyClampMaps(out, flat.lo, flat.hi)
  for (const st of strokes) stampStroke(out, W, H, st, W / nw, H / nh)
  if (post.grow || post.smooth) out = applyPostOps(out, W, H, post, Math.max(W, H) / POINT_SEGMENT_INPUT_SIDE)
  return out
}

function recompose() {
  if (recomposeRaf) {
    cancelAnimationFrame(recomposeRaf)
    recomposeRaf = 0
  }
  const { w: nw, h: nh } = natural.value
  if (!nw || !nh) {
    composite.value = null
    drawOverlay()
    return
  }
  const g = gridOf(POINT_SEGMENT_INPUT_SIDE)
  const r = result.value
  const base = r ? resampleNearest(r.mask, r.width, r.height, g.w, g.h) : null
  const mask = composeAt(g.w, g.h, base, wandMask, allStrokes.value, effectivePost.value)
  composite.value = mask ? { mask, width: g.w, height: g.h } : null
  drawOverlay()
}
let recomposeRaf = 0
/** 画笔拖动中：每帧最多重算一次 */
function recomposeSoon() {
  if (recomposeRaf) return
  recomposeRaf = requestAnimationFrame(() => {
    recomposeRaf = 0
    recompose()
  })
}
watch([result, () => doc.value, natural, priorImg], recompose)
watch([liveStroke, penDraft], recomposeSoon)
watch(overlay, drawOverlay)

// ---------------- 查看方式：叠加 / 黑白蒙版 / 仅选区 / 轮廓（按浏览器记住，与全屏「显示选区」共用） ----------------

const VIEW_KEY = 'colorfix:mask-view'
const VIEW_MODES: MaskViewMode[] = ['overlay', 'mask', 'only', 'outline']
function readView(): MaskViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY) as MaskViewMode | null
    return v && VIEW_MODES.includes(v) ? v : 'overlay'
  } catch {
    return 'overlay'
  }
}
const maskView = ref<MaskViewMode>(readView())
function setMaskView(v: MaskViewMode) {
  maskView.value = v
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* 隐私模式：只是记不住 */
  }
}
watch(maskView, drawOverlay)

/** 轮廓（原图坐标的 SVG path）；拖动中节流 120ms 重算 */
const outlineD = ref('')
let outlineTimer: ReturnType<typeof setTimeout> | null = null
let outlineDirty = false
function scheduleOutline() {
  if (maskView.value !== 'outline') {
    outlineD.value = ''
    return
  }
  outlineDirty = true
  if (outlineTimer) return
  const run = () => {
    outlineTimer = null
    if (!outlineDirty) return
    outlineDirty = false
    const r = composite.value
    const { w: nw, h: nh } = natural.value
    outlineD.value = r && nw ? contoursToPath(maskContours(r.mask, r.width, r.height, 128, 0.4), nw / r.width, nh / r.height) : ''
    if (outlineDirty) outlineTimer = setTimeout(run, 120)
  }
  outlineTimer = setTimeout(run, gesture ? 120 : 0)
}

function drawOverlay() {
  const c = overlay.value
  const r = composite.value
  scheduleOutline()
  if (!c) return
  const view = maskView.value
  if (!r || view === 'outline') {
    // 黑白蒙版 / 仅选区：还没有选区时也要表达「什么都没选」
    if (!r && natural.value.w && (view === 'mask' || view === 'only')) {
      const g = gridOf(POINT_SEGMENT_INPUT_SIDE)
      c.width = g.w
      c.height = g.h
      const ctx = c.getContext('2d')
      if (!ctx) return
      const empty = new Uint8Array(g.w * g.h)
      ctx.putImageData(new ImageData(renderMaskView(empty, g.w, g.h, view, { checker: 12 }) as Uint8ClampedArray<ArrayBuffer>, g.w, g.h), 0, 0)
      return
    }
    c.width = c.height = 0
    return
  }
  c.width = r.width
  c.height = r.height
  const ctx = c.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(r.width, r.height)
  renderMaskView(r.mask, r.width, r.height, view, { checker: 12, out: img.data })
  ctx.putImageData(img, 0, 0)
}

// ================= 画面：适应尺寸 + 缩放平移 =================

const wrapEl = ref<HTMLElement | null>(null)
const viewportEl = ref<HTMLElement | null>(null)
const contentEl = ref<HTMLElement | null>(null)
const availW = ref(0)
const MAX_ZOOM = 8
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const spaceHeld = ref(false)
const panning = ref(false)

const maxStageH = computed(() =>
  large ? Math.max(320, viewportH.value - 330) : Math.max(240, Math.min(620, Math.round(viewportH.value * 0.58))),
)
const fit = computed(() => {
  const { w, h } = natural.value
  if (!w || !h || availW.value <= 0) return { w: 0, h: 0 }
  const s = Math.min(availW.value / w, maxStageH.value / h)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
})
/** 原图像素 / 屏幕像素（命中半径、精简阈值都按屏幕像素算） */
const imgPerScreen = computed(() => (fit.value.w ? natural.value.w / (fit.value.w * zoom.value) : 1))

const viewportStyle = computed(() =>
  fit.value.w ? { width: `${fit.value.w}px`, height: `${fit.value.h}px` } : undefined,
)
const contentStyle = computed(() =>
  fit.value.w
    ? {
        width: `${Math.round(fit.value.w * zoom.value)}px`,
        height: `${Math.round(fit.value.h * zoom.value)}px`,
        transform: `translate(${Math.round(pan.value.x)}px, ${Math.round(pan.value.y)}px)`,
      }
    : undefined,
)

function measure() {
  const el = wrapEl.value
  // 减去棋盘底的内边距（p-8px ×2）
  if (el) availW.value = Math.max(0, el.clientWidth - 16)
}
watch(wrapEl, (el) => {
  observer?.disconnect()
  if (!el) return
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(el)
  }
})

function clampPan(p: Pt, z: number): Pt {
  const f = fit.value
  return { x: Math.min(0, Math.max(f.w - f.w * z, p.x)), y: Math.min(0, Math.max(f.h - f.h * z, p.y)) }
}
watch(fit, () => {
  pan.value = clampPan(pan.value, zoom.value)
})

/** 以视口内 (cx, cy) 为中心缩放到 z */
function zoomAt(z: number, cx = fit.value.w / 2, cy = fit.value.h / 2) {
  const z0 = zoom.value
  const z1 = Math.min(MAX_ZOOM, Math.max(1, z))
  if (z1 === z0) return
  const p = pan.value
  zoom.value = z1
  pan.value = clampPan({ x: cx - (cx - p.x) * (z1 / z0), y: cy - (cy - p.y) * (z1 / z0) }, z1)
}
const zoomIn = () => zoomAt(zoom.value * 1.5)
const zoomOut = () => zoomAt(zoom.value / 1.5)
function zoomFit() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
}

function viewportPoint(e: { clientX: number; clientY: number }) {
  const r = viewportEl.value?.getBoundingClientRect()
  return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 }
}

function onWheel(e: WheelEvent) {
  if (!fit.value.w) return
  e.preventDefault()
  const p = viewportPoint(e)
  // 触控板捏合（ctrlKey）步子小，系数加大（同 ColorFixZoomView）
  const k = e.ctrlKey ? 0.01 : 0.0015
  zoomAt(zoom.value * Math.exp(-e.deltaY * k), p.x, p.y)
}
watch(viewportEl, (el, old) => {
  old?.removeEventListener('wheel', onWheel)
  el?.addEventListener('wheel', onWheel, { passive: false })
})

function onImgLoad(e: Event) {
  const el = e.target as HTMLImageElement
  natural.value = { w: el.naturalWidth, h: el.naturalHeight }
}
function onImgError() {
  markCorsBlocked(src)
}

/** 屏幕坐标 → 原图像素坐标（用内容层当前矩形反算，与缩放 / 平移无关） */
function toImage(e: { clientX: number; clientY: number }, clamp = false): Pt | null {
  const el = contentEl.value
  const { w, h } = natural.value
  if (!el || !w) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const x = ((e.clientX - rect.left) / rect.width) * w
  const y = ((e.clientY - rect.top) / rect.height) * h
  if (!clamp) return { x, y }
  return { x: Math.min(w - 1, Math.max(0, x)), y: Math.min(h - 1, Math.max(0, y)) }
}

// ================= 命中测试 =================

/** 标记命中半径（屏幕像素） */
const HIT_PX = 11
function pointAt(p: Pt): number {
  const pts = doc.value.points
  const r = HIT_PX * imgPerScreen.value
  for (let i = pts.length - 1; i >= 0; i--) if (Math.hypot(pts[i]!.x - p.x, pts[i]!.y - p.y) <= r) return i
  return -1
}
function shapeAt(p: Pt): SelectionShape | null {
  const list = doc.value.shapes
  const r = 6 * imgPerScreen.value
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]!
    if (pointInPolygon(p, s.poly) || distToPolygonEdge(p, s.poly) <= r) return s
  }
  return null
}
const nearPenStart = computed(() => {
  const n = penNodes.value
  const h = hover.value
  return n.length >= 3 && !!h && Math.hypot(n[0]!.x - h.x, n[0]!.y - h.y) <= HIT_PX * imgPerScreen.value
})
const hoverMarker = ref(-1)
/** 悬停在选中钢笔路径的锚点 / 手柄 / 路径段上（换指针） */
const hoverEdit = ref<'anchor' | 'out' | 'in' | 'segment' | null>(null)

// ================= 指针 =================

const DRAG_PX = 6
const LONG_PRESS_MS = 500
const DOUBLE_MS = 350

type Gesture =
  | { kind: 'pan'; id: number; cx: number; cy: number; px: number; py: number; moved: boolean; selectOnTap: boolean }
  | { kind: 'pinch'; dist: number; zoom: number; mid: Pt; pan: Pt }
  | { kind: 'point'; id: number; cx: number; cy: number; p: Pt; neg: boolean; touch: boolean; marker: number }
  | { kind: 'pen'; id: number; cx: number; cy: number; index: number; dragging: boolean }
  | { kind: 'lasso'; id: number; cx: number; cy: number }
  | { kind: 'magnetic'; id: number; cx: number; cy: number; touch: boolean; moved: boolean; started: boolean; free: boolean }
  | { kind: 'wand'; id: number; cx: number; cy: number; p: Pt; neg: boolean }
  | { kind: 'brush'; id: number; cx: number; cy: number }
  | { kind: 'marquee'; id: number; cx: number; cy: number; start: Pt; last: Pt; square: boolean; center: boolean }
  | {
      kind: 'penEdit'
      id: number
      cx: number
      cy: number
      shape: number
      what: 'anchor' | 'out' | 'in' | 'segment'
      index: number
      start: Pt
      from: PenNode[]
      moved: boolean
    }

const pointers = new Map<number, { x: number; y: number; touch: boolean }>()
let gesture: Gesture | null = null
let consumed = false
let pressTimer: ReturnType<typeof setTimeout> | undefined
let lastPenDown = { t: 0, x: 0, y: 0 }

function capture(e: PointerEvent) {
  try {
    viewportEl.value?.setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成事件 / 已抬起的指针会抛错，忽略 */
  }
}

/** 中途放弃当前手势（第二根手指落下 / pointercancel） */
function abortGesture() {
  clearTimeout(pressTimer)
  if (gesture?.kind === 'lasso') lassoPts.value = []
  if (gesture?.kind === 'magnetic') {
    magFreehand = null
    // 这一下刚起的路径（只有起点）被捏合打断：不算
    if (gesture.started && magSeeds.value.length === 1) magCancel()
    else if (gesture.touch) magLive.value = []
    else magSchedule()
  }
  if (gesture?.kind === 'brush') liveStroke.value = null
  if (gesture?.kind === 'marquee') marqueeDraft.value = null
  if (gesture?.kind === 'penEdit') penDraft.value = null
  // 钢笔按下时已经放了锚点：被第二根手指（捏合）打断的这一下不算，撤掉它
  if (gesture?.kind === 'pen' && penNodes.value.length === gesture.index + 1)
    penNodes.value = penNodes.value.slice(0, gesture.index)
  dragBox.value = null
  panning.value = false
  gesture = null
}

function startPinch() {
  const [a, b] = [...pointers.values()]
  if (!a || !b) return
  abortGesture()
  const vr = viewportEl.value?.getBoundingClientRect()
  gesture = {
    kind: 'pinch',
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    zoom: zoom.value,
    mid: { x: (a.x + b.x) / 2 - (vr?.left ?? 0), y: (a.y + b.y) / 2 - (vr?.top ?? 0) },
    pan: { ...pan.value },
  }
}

function onPointerDown(e: PointerEvent) {
  if (!fit.value.w || restoring.value) return
  const touch = e.pointerType === 'touch'
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, touch })
  if (touch && pointers.size === 2) {
    startPinch()
    return
  }
  if (gesture || pointers.size > 1) return
  // 右键：删点 / 选中形状
  if (e.button === 2) {
    pointers.delete(e.pointerId)
    const p = toImage(e)
    if (!p) return
    const i = pointAt(p)
    if (i >= 0) removePoint(i)
    else selectedId.value = shapeAt(p)?.id ?? null
    return
  }
  if (e.button !== 0 && e.button !== 1) return
  e.preventDefault()
  const p = toImage(e)
  if (!p) return
  capture(e)
  consumed = false
  // 钢笔路径编辑：选中了钢笔形状、没在画新路径时，钢笔 / 移动工具先看是否点在锚点 / 手柄 / 路径上
  if (e.button === 0 && !spaceHeld.value && !penNodes.value.length && (tool.value === 'pen' || tool.value === 'move')) {
    const sp = selectedPen.value
    const hit = sp ? penEditHit(p) : null
    if (sp && hit) {
      const what = hit.what
      const index = 'index' in hit ? hit.index : -1
      if (what === 'anchor') selAnchor.value = index
      gesture = { kind: 'penEdit', id: e.pointerId, cx: e.clientX, cy: e.clientY, shape: sp.id, what, index, start: p, from: sp.nodes!, moved: false }
      return
    }
    // 钢笔工具 ⌘/Ctrl + 单击：选中路径（不起新路径）
    if (tool.value === 'pen' && (e.metaKey || e.ctrlKey)) {
      selectedId.value = shapeAt(p)?.id ?? null
      return
    }
  }
  if (e.button === 1 || spaceHeld.value || tool.value === 'move') {
    gesture = {
      kind: 'pan',
      id: e.pointerId,
      cx: e.clientX,
      cy: e.clientY,
      px: pan.value.x,
      py: pan.value.y,
      moved: false,
      selectOnTap: tool.value === 'move' && e.button === 0 && !spaceHeld.value,
    }
    panning.value = true
    return
  }
  const invert = e.altKey || e.shiftKey
  if (tool.value === 'point') {
    const neg = (mode.value === 'sub') !== invert
    gesture = {
      kind: 'point',
      id: e.pointerId,
      cx: e.clientX,
      cy: e.clientY,
      p: toImage(e, true)!,
      neg,
      touch,
      marker: pointAt(p),
    }
    clearTimeout(pressTimer)
    if (touch && gesture.marker < 0) {
      pressTimer = setTimeout(() => {
        if (gesture?.kind !== 'point' || dragBox.value) return
        consumed = true
        const g = gesture
        commit({ ...doc.value, points: [...doc.value.points, { x: g.p.x, y: g.p.y, label: 0 }] })
        navigator.vibrate?.(10)
      }, LONG_PRESS_MS)
    }
    return
  }
  if (tool.value === 'wand') {
    const q = toImage(e, true)
    if (!q) return
    gesture = { kind: 'wand', id: e.pointerId, cx: e.clientX, cy: e.clientY, p: q, neg: (mode.value === 'sub') !== invert }
    return
  }
  if (tool.value === 'brush') {
    const sub = (mode.value === 'sub') !== e.altKey
    liveStroke.value = {
      id: ++strokeSeq,
      mode: sub ? 'sub' : 'add',
      radius: brushRadius.value,
      hardness: brushHardness.value / 100,
      pts: [p],
    }
    gesture = { kind: 'brush', id: e.pointerId, cx: e.clientX, cy: e.clientY }
    return
  }
  if (tool.value === 'marquee') {
    const q = toImage(e, true)
    if (!q) return
    marqueeMode.value = mode.value
    gesture = { kind: 'marquee', id: e.pointerId, cx: e.clientX, cy: e.clientY, start: q, last: q, square: e.shiftKey, center: e.altKey }
    return
  }
  if (tool.value === 'pen') {
    // 起新路径：取消对已有路径的选中
    if (!penNodes.value.length) selectedId.value = null
    const nodes = penNodes.value
    const r = HIT_PX * imgPerScreen.value
    const now = performance.now()
    const dbl =
      now - lastPenDown.t < DOUBLE_MS && Math.hypot(e.clientX - lastPenDown.x, e.clientY - lastPenDown.y) < DRAG_PX
    lastPenDown = { t: now, x: e.clientX, y: e.clientY }
    // 点起点 / 双击：闭合（双击的第一下已经放了一个锚点，这里不再重复放）
    if (nodes.length >= 3 && (Math.hypot(nodes[0]!.x - p.x, nodes[0]!.y - p.y) <= r || dbl)) {
      closePen()
      return
    }
    if (dbl) return
    if (!nodes.length) penMode.value = (mode.value === 'sub') !== invert ? 'sub' : 'add'
    penNodes.value = [...nodes, { x: p.x, y: p.y }]
    gesture = { kind: 'pen', id: e.pointerId, cx: e.clientX, cy: e.clientY, index: nodes.length, dragging: false }
    return
  }
  // 自由 · 吸附边缘（磁性套索）
  if (magOn.value) {
    magDown(e, p, invert, touch)
    return
  }
  // 自由
  lassoMode.value = (mode.value === 'sub') !== invert ? 'sub' : 'add'
  lassoPts.value = [p]
  gesture = { kind: 'lasso', id: e.pointerId, cx: e.clientX, cy: e.clientY }
}

let lastMagDown = { t: 0, x: 0, y: 0 }
/**
 * 磁性套索按下：没有路径 = 起点（Alt / Shift 或触屏长按 = 排除）；有路径时——双击 / 点起点 = 闭合，
 * Alt = 手绘（拖动）/ 直线（单击），鼠标单击 = 在这里落锚点，触屏 = 先预览、松手落锚点。
 */
function magDown(e: PointerEvent, p: Pt, invert: boolean, touch: boolean) {
  ensureEdgeMap()
  const now = performance.now()
  const dbl = now - lastMagDown.t < DOUBLE_MS && Math.hypot(e.clientX - lastMagDown.x, e.clientY - lastMagDown.y) < DRAG_PX * 2
  lastMagDown = { t: now, x: e.clientX, y: e.clientY }
  magAlt.value = e.altKey
  const base = { kind: 'magnetic' as const, id: e.pointerId, cx: e.clientX, cy: e.clientY, touch, moved: false }
  if (!magActive.value) {
    selectedId.value = null
    magStart(p, (mode.value === 'sub') !== invert ? 'sub' : 'add')
    gesture = { ...base, started: true, free: false }
    clearTimeout(pressTimer)
    if (touch) {
      // 触屏第一下长按 = 这条路径按排除（与点选「长按 = 排除」一致）
      pressTimer = setTimeout(() => {
        if (gesture?.kind !== 'magnetic' || gesture.moved || magSeeds.value.length !== 1) return
        magMode.value = mode.value === 'sub' ? 'add' : 'sub'
        navigator.vibrate?.(10)
      }, LONG_PRESS_MS)
    }
    return
  }
  const g = toGrid(p)
  updateNearStart(g)
  if (dbl || magNearStart.value) {
    // 双击的第一下已经落了锚点，这里直接闭合
    magClose()
    return
  }
  magCursor = g
  if (e.altKey) {
    // Alt 拖动 = 手绘：记轨迹，松手成一段
    magFreehand = []
    gesture = { ...base, started: false, free: true }
    magUpdate()
    return
  }
  if (!touch) magAddSeed(p)
  else magUpdate()
  gesture = { ...base, started: false, free: false }
}

function onPointerMove(e: PointerEvent) {
  const rec = pointers.get(e.pointerId)
  if (rec) {
    rec.x = e.clientX
    rec.y = e.clientY
  }
  const g = gesture
  if (!g) {
    // 悬停：钢笔橡皮筋 / 标记高亮 / 磁性套索实时路径
    if (e.pointerType === 'mouse') {
      const p = toImage(e)
      hover.value = tool.value === 'pen' || tool.value === 'brush' || (tool.value === 'lasso' && magOn.value) ? p : null
      if (tool.value === 'lasso' && magActive.value && p) {
        magAlt.value = e.altKey
        magCursor = toGrid(p)
        updateNearStart(magCursor)
        magSchedule()
      }
      hoverMarker.value = tool.value === 'point' && p ? pointAt(p) : -1
      hoverEdit.value =
        p && selectedPen.value && !penNodes.value.length && (tool.value === 'pen' || tool.value === 'move')
          ? (penEditHit(p)?.what ?? null)
          : null
    }
    return
  }
  if (g.kind === 'pinch') {
    const [a, b] = [...pointers.values()]
    if (!a || !b) return
    const vr = viewportEl.value?.getBoundingClientRect()
    const mid = { x: (a.x + b.x) / 2 - (vr?.left ?? 0), y: (a.y + b.y) / 2 - (vr?.top ?? 0) }
    const z1 = Math.min(MAX_ZOOM, Math.max(1, g.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist)))
    // 捏合中心固定 + 跟手平移
    const nx = mid.x - (g.mid.x - g.pan.x) * (z1 / g.zoom)
    const ny = mid.y - (g.mid.y - g.pan.y) * (z1 / g.zoom)
    zoom.value = z1
    pan.value = clampPan({ x: nx, y: ny }, z1)
    return
  }
  if (e.pointerId !== g.id) return
  const far = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) >= DRAG_PX
  if (g.kind === 'wand') return
  if (g.kind === 'magnetic') {
    const p = toImage(e)
    if (!p) return
    if (far) g.moved = true
    if (e.pointerType === 'mouse') hover.value = p
    const c = toGrid(p)
    magCursor = c
    updateNearStart(c)
    if (g.free && magFreehand) {
      const last = magFreehand[magFreehand.length - 1] ?? lastSeed()
      if (!last || Math.hypot(last.x - c.x, last.y - c.y) >= 2 * gridPerScreen.value) magFreehand.push(c)
    } else magAlt.value = e.altKey
    magSchedule()
    return
  }
  if (g.kind === 'marquee') {
    const q = toImage(e, true)
    if (!q) return
    g.last = q
    g.square = e.shiftKey
    g.center = e.altKey
    if (!far && !marqueeDraft.value) return
    updateMarquee()
    return
  }
  if (g.kind === 'penEdit') {
    if (g.what === 'segment') return
    if (!g.moved && !far) return
    g.moved = true
    const p = toImage(e)
    if (!p) return
    const nodes = g.from.map((n) => ({ ...n }))
    const n = nodes[g.index]
    if (!n) return
    if (g.what === 'anchor') {
      // 锚点带着自己的手柄一起移动（手柄是相对偏移，不用改）
      n.x = g.from[g.index]!.x + (p.x - g.start.x)
      n.y = g.from[g.index]!.y + (p.y - g.start.y)
    } else nodes[g.index] = movePenHandle(g.from[g.index]!, g.what, p, e.altKey)
    penDraft.value = { id: g.shape, nodes }
    return
  }
  if (g.kind === 'brush') {
    const p = toImage(e)
    const st = liveStroke.value
    if (!p || !st) return
    if (e.pointerType === 'mouse') hover.value = p
    const last = st.pts[st.pts.length - 1]
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1.5 * imgPerScreen.value) return
    liveStroke.value = { ...st, pts: [...st.pts, p] }
    return
  }
  if (g.kind === 'pan') {
    if (far) g.moved = true
    pan.value = clampPan({ x: g.px + e.clientX - g.cx, y: g.py + e.clientY - g.cy }, zoom.value)
    return
  }
  if (g.kind === 'point') {
    if (consumed || g.marker >= 0) return
    if (!dragBox.value && !far) return
    clearTimeout(pressTimer)
    const p = toImage(e, true)
    if (!p) return
    dragBox.value = {
      x0: Math.min(g.p.x, p.x),
      y0: Math.min(g.p.y, p.y),
      x1: Math.max(g.p.x, p.x),
      y1: Math.max(g.p.y, p.y),
    }
    return
  }
  const p = toImage(e)
  if (!p) return
  if (g.kind === 'pen') {
    if (!g.dragging && !far) return
    g.dragging = true
    const nodes = penNodes.value.slice()
    const n = nodes[g.index]
    if (!n) return
    nodes[g.index] = { x: n.x, y: n.y, hx: p.x - n.x, hy: p.y - n.y }
    penNodes.value = nodes
    hover.value = null
    return
  }
  // 自由：间隔 ≥ 2 屏幕像素才记一点
  const pts = lassoPts.value
  const last = pts[pts.length - 1]
  if (last && Math.hypot(last.x - p.x, last.y - p.y) < 2 * imgPerScreen.value) return
  lassoPts.value = [...pts, p]
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  const g = gesture
  if (!g) return
  if (g.kind === 'pinch') {
    if (pointers.size < 2) gesture = null
    return
  }
  if (e.pointerId !== g.id) return
  gesture = null
  clearTimeout(pressTimer)
  if (g.kind === 'pan') {
    panning.value = false
    if (g.selectOnTap && !g.moved) {
      const p = toImage(e)
      selectedId.value = p ? (shapeAt(p)?.id ?? null) : null
    }
    return
  }
  if (g.kind === 'point') {
    const b = dragBox.value
    dragBox.value = null
    if (consumed) return
    if (g.marker >= 0) {
      // 点在标记上松开（没拖开）= 删除这个点
      if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_PX) removePoint(g.marker)
      return
    }
    if (b) {
      if (b.x1 - b.x0 > 4 && b.y1 - b.y0 > 4) commit({ ...doc.value, box: b })
      return
    }
    commit({ ...doc.value, points: [...doc.value.points, { x: g.p.x, y: g.p.y, label: g.neg ? 0 : 1 }] })
    return
  }
  if (g.kind === 'pen') return
  if (g.kind === 'marquee') {
    const r = marqueeDraft.value
    marqueeDraft.value = null
    const k = imgPerScreen.value
    // 小于 4×4 屏幕像素当误触
    if (r && r.x1 - r.x0 >= 4 * k && r.y1 - r.y0 >= 4 * k) {
      const kind = marqueeShape.value
      addShape(kind, marqueeMode.value, kind === 'rect' ? rectPolygon(r) : ellipsePolygon(r, Math.max(0.25, 0.5 * k)))
    }
    return
  }
  if (g.kind === 'penEdit') {
    const d = penDraft.value
    penDraft.value = null
    if (g.moved && d && d.id === g.shape) commitPenNodes(d.id, d.nodes)
    return
  }
  if (g.kind === 'wand') {
    if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_PX) addWand(g.p, g.neg ? 'sub' : 'add')
    return
  }
  if (g.kind === 'magnetic') {
    if (!magActive.value) return
    const p = toImage(e, true)
    if (g.free) {
      // Alt 手绘 / 直线：轨迹（没拖开 = 一条直线到这里）成一段
      if (p) {
        const c = toGrid(p)
        if (magFreehand) magFreehand.push(c)
        const seg = [lastSeed()!, ...(magFreehand?.length ? magFreehand : [c])]
        pushSegment(seg)
      }
      // 松在舞台外也要清掉轨迹，否则 Alt 还按着时实时段一直挂着这段旧轨迹
      magFreehand = null
      magAlt.value = e.altKey
      magSchedule()
      return
    }
    // 触屏：松手处落锚点（起点那一下除外：拖开了也落）；鼠标按住拖动后松手同样落锚点
    if (p && !g.started && g.touch) magAddSeed(p)
    else if (p && g.moved) magAddSeed(p)
    if (g.touch) magLive.value = []
    else magSchedule()
    return
  }
  if (g.kind === 'brush') {
    const st = liveStroke.value
    liveStroke.value = null
    if (st) commit({ ...doc.value, strokes: [...doc.value.strokes, st] })
    return
  }
  finishLasso()
}

function onPointerCancel(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (gesture?.kind === 'pinch' && pointers.size >= 2) return
  abortGesture()
}

function onPointerLeave() {
  hover.value = null
  hoverMarker.value = -1
  hoverEdit.value = null
}

/** 按当前手势（起点 / 当前点 / Shift / Alt）更新选框草稿 */
function updateMarquee() {
  const g = gesture
  if (g?.kind !== 'marquee') return
  const { w, h } = natural.value
  const r = marqueeRect(g.start, g.last, { square: g.square, center: g.center })
  // 夹在图内（从中心拉出时可能越界）
  marqueeDraft.value = { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(w, r.x1), y1: Math.min(h, r.y1) }
}

function finishLasso() {
  const raw = lassoPts.value
  lassoPts.value = []
  const k = imgPerScreen.value
  const poly = lassoToPolygon(raw, 1.5 * k)
  // 面积不到 8×8 屏幕像素当误触
  if (poly.length >= 3 && Math.abs(polygonArea(poly)) >= 64 * k * k) addShape('lasso', lassoMode.value, poly)
}

function closePen() {
  const nodes = penNodes.value
  penNodes.value = []
  hover.value = null
  if (nodes.length < 3) return
  const k = imgPerScreen.value
  const poly = penToPolyline(nodes, true, Math.max(0.25, 0.5 * k))
  if (poly.length >= 3 && Math.abs(polygonArea(poly)) >= 16 * k * k)
    addShape(
      'pen',
      penMode.value,
      poly,
      nodes.map((n) => ({ ...n })),
    )
}

function cancelPen() {
  penNodes.value = []
  hover.value = null
}

// ================= 磁性套索（自由 + 吸附边缘，live-wire） =================

/** 偏好（开关 / 宽度 / 对比度）按浏览器记住，与查看方式同口径 */
const MAG_KEY = 'colorfix:lasso-magnetic'
interface MagPrefs {
  on: boolean
  width: number
  contrast: number
}
function readMagPrefs(): MagPrefs {
  const def: MagPrefs = { on: false, width: 10, contrast: 10 }
  try {
    const raw = localStorage.getItem(MAG_KEY)
    if (!raw) return def
    const v = JSON.parse(raw) as Partial<MagPrefs>
    const num = (x: unknown, lo: number, hi: number, d: number) =>
      typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d
    return { on: v.on === true, width: num(v.width, 1, 40, def.width), contrast: num(v.contrast, 1, 60, def.contrast) }
  } catch {
    return def
  }
}
const magPrefs = readMagPrefs()
/** 吸附边缘开关 */
const magnetic = ref(magPrefs.on)
/** 宽度：指针周围多大范围内找边（网格像素，长边 1024 计） */
const magWidth = ref(magPrefs.width)
/** 对比度：梯度低于它（%）当没有边 */
const magContrast = ref(magPrefs.contrast)
watch([magnetic, magWidth, magContrast], ([on, width, contrast]) => {
  try {
    localStorage.setItem(MAG_KEY, JSON.stringify({ on, width, contrast }))
  } catch {
    /* 隐私模式：只是记不住 */
  }
})

/** 搜索窗口半径（网格像素）：live-wire 只在锚点周围这么大的方框里展开 */
const MAG_WINDOW = 192
/** 指针离锚点超过这么远（网格像素）就强制落锚点，窗口不至于不够用 */
const MAG_FORCE_DIST = 140
/** 路径冷却：前缀连续这么多次更新不变即可固化 */
const MAG_COOL_K = 10
/** 自动落锚点的最短间距（网格像素） */
const MAG_MIN_SEG = 28
/** 闭合段搜索窗口外扩（网格像素） */
const MAG_CLOSE_MARGIN = 32

const edgeMap = shallowRef<EdgeCostMap | null>(null)
const edgeLoading = ref(false)
const edgeFailed = ref(false)
/** 磁性套索可用（开关开着 + 读得了像素） */
const magOn = computed(() => magnetic.value && !edgeFailed.value)

function ensureEdgeMap() {
  if (!magnetic.value || tool.value !== 'lasso' || edgeMap.value || edgeLoading.value || edgeFailed.value) return
  // 舞台上的图还没加载完：等它的 load（onStageImgLoad）再来
  const el = imgEl.value
  if (!el || !el.complete || !el.naturalWidth) return
  const lg = gridLab()
  if (!lg) {
    edgeFailed.value = true
    return
  }
  edgeLoading.value = true
  loadEdgeCost({ key: src, lab: lg.lab, width: lg.w, height: lg.h })
    .then((m) => {
      if (m.width !== lg.w || m.height !== lg.h) return
      edgeMap.value = m
      // 地图到之前已经起了路径：给最后一个锚点补上 live-wire
      if (magSeeds.value.length) {
        resetWire()
        magSchedule()
      }
    })
    .catch(() => {
      edgeFailed.value = true
    })
    .finally(() => {
      edgeLoading.value = false
    })
}
watch([magnetic, tool, natural], ensureEdgeMap)

/** 正在画的磁性路径：锚点（网格坐标）、已固化的段（网格坐标，每段从上一个锚点到下一个锚点）、实时段 */
const magSeeds = shallowRef<Pt[]>([])
const magSegs = shallowRef<Pt[][]>([])
const magLive = shallowRef<Pt[]>([])
const magMode = ref<ShapeMode>('add')
const magActive = computed(() => magSeeds.value.length > 0)
/** 指针（网格坐标）；null = 不在舞台上 */
let magCursor: Pt | null = null
/** 按住 Alt：临时手绘 / 直线 */
const magAlt = ref(false)
/** Alt + 拖动时记的手绘点（网格坐标） */
let magFreehand: Pt[] | null = null
let wire: LiveWire | null = null
let wirePrev: Pt[] = []
let wireStable: Uint16Array | null = null
let magRaf = 0
/** 最近一次实时路径耗时（ms，性能自查用） */
const magStats = { lastMs: 0, maxMs: 0, expanded: 0 }

function gridSize() {
  return gridOf(POINT_SEGMENT_INPUT_SIDE)
}
function toGrid(p: Pt): Pt {
  const { w: nw, h: nh } = natural.value
  const g = gridSize()
  return {
    x: Math.min(g.w - 1, Math.max(0, (p.x / nw) * g.w - 0.5)),
    y: Math.min(g.h - 1, Math.max(0, (p.y / nh) * g.h - 0.5)),
  }
}
function fromGrid(p: Pt): Pt {
  const { w: nw, h: nh } = natural.value
  const g = gridSize()
  return { x: ((p.x + 0.5) / g.w) * nw, y: ((p.y + 0.5) / g.h) * nh }
}
/** 屏幕像素 → 网格像素 */
const gridPerScreen = computed(() => {
  const nw = natural.value.w
  return nw ? imgPerScreen.value * (gridSize().w / nw) : 1
})

function lastSeed(): Pt | null {
  const s = magSeeds.value
  return s.length ? s[s.length - 1]! : null
}

function resetWire() {
  const map = edgeMap.value
  const s = lastSeed()
  wirePrev = []
  wireStable = null
  if (!map || !s) {
    wire = null
    return
  }
  wire = new LiveWire(map, magContrast.value / 100)
  const g = { x: Math.round(s.x), y: Math.round(s.y) }
  wire.start(g.x, g.y, boxAround(g, g, MAG_WINDOW))
}

/** 实时段：锚点 → 指针（吸附 / Alt 手绘 / 直线） */
function liveSegmentTo(c: Pt): Pt[] {
  const s = lastSeed()
  if (!s) return []
  if (magAlt.value || !wire || !edgeMap.value) {
    if (magFreehand && magFreehand.length) return [s, ...magFreehand]
    return [s, c]
  }
  const t = snapTarget(edgeMap.value, c.x, c.y, magWidth.value, magContrast.value / 100)
  return wire.pathTo(t.x, t.y)
}

function magUpdate() {
  const c = magCursor
  if (!magActive.value || !c) {
    magLive.value = []
    return
  }
  const t0 = performance.now()
  let path = liveSegmentTo(c)
  // 自动落锚点：冷却（前缀稳定）或离锚点太远
  if (wire && !magAlt.value && path.length > 1) {
    wireStable = coolStable(wirePrev, wireStable, path)
    wirePrev = path
    const s = path[0]!
    const far = Math.hypot(c.x - s.x, c.y - s.y) > MAG_FORCE_DIST
    let j = cooledIndex(wireStable, MAG_COOL_K)
    if (j >= 0 && Math.hypot(path[j]!.x - s.x, path[j]!.y - s.y) < MAG_MIN_SEG) j = -1
    if (j < 0 && far) j = Math.floor(path.length * 0.6)
    if (j > 0) {
      pushSegment(path.slice(0, j + 1))
      path = liveSegmentTo(c)
      wirePrev = path
      wireStable = null
    }
  }
  magLive.value = path
  const ms = performance.now() - t0
  magStats.lastMs = ms
  magStats.maxMs = Math.max(magStats.maxMs, ms)
  magStats.expanded = wire?.expanded ?? 0
}
function magSchedule() {
  if (magRaf) return
  magRaf = requestAnimationFrame(() => {
    magRaf = 0
    magUpdate()
  })
}

/** 固化一段（从当前锚点出发），段尾成为新锚点 */
function pushSegment(seg: Pt[]) {
  if (seg.length < 2) return
  const end = seg[seg.length - 1]!
  magSegs.value = [...magSegs.value, seg]
  magSeeds.value = [...magSeeds.value, { x: end.x, y: end.y }]
  resetWire()
}

function magStart(p: Pt, m: ShapeMode) {
  magMode.value = m
  magSegs.value = []
  magLive.value = []
  magFreehand = null
  const g = toGrid(p)
  magSeeds.value = [{ x: Math.round(g.x), y: Math.round(g.y) }]
  magCursor = g
  resetWire()
}

/** 在 p 处落锚点：先把实时段算到 p 再固化 */
function magAddSeed(p: Pt) {
  const g = toGrid(p)
  magCursor = g
  const seg = liveSegmentTo(g)
  magFreehand = null
  const s = lastSeed()
  // 落在锚点原地：不重复加
  if (!s || seg.length < 2 || Math.hypot(seg[seg.length - 1]!.x - s.x, seg[seg.length - 1]!.y - s.y) < 1) return
  pushSegment(seg)
  magLive.value = []
}

/** 删上一个锚点（连同它那一段）；只剩起点 = 放弃 */
function magBack() {
  if (magSeeds.value.length <= 1) {
    magCancel()
    return
  }
  magSeeds.value = magSeeds.value.slice(0, -1)
  magSegs.value = magSegs.value.slice(0, -1)
  resetWire()
  magSchedule()
}

function magCancel() {
  magSeeds.value = []
  magSegs.value = []
  magLive.value = []
  magFreehand = null
  wire = null
  wirePrev = []
  wireStable = null
  if (magRaf) cancelAnimationFrame(magRaf)
  magRaf = 0
}

/** 闭合：最后一个锚点 → 起点再吸附一段，整条路径平滑精简后作为一个形状（添加 / 排除）进撤销栈 */
function magClose() {
  const seeds = magSeeds.value
  if (!seeds.length) return
  const first = seeds[0]!
  const last = seeds[seeds.length - 1]!
  const map = edgeMap.value
  let closing: Pt[] = [last, first]
  if (map && !magAlt.value && Math.hypot(first.x - last.x, first.y - last.y) > 1.5) {
    const w = new LiveWire(map, magContrast.value / 100)
    // 窗口 = 整条已画路径的外接框再外扩：闭合段可能要绕到另一侧
    const drawn = magSegs.value.flat()
    const box = boxAround(last, first, MAG_CLOSE_MARGIN)
    for (const q of drawn) {
      box.x0 = Math.min(box.x0, q.x - MAG_CLOSE_MARGIN)
      box.y0 = Math.min(box.y0, q.y - MAG_CLOSE_MARGIN)
      box.x1 = Math.max(box.x1, q.x + MAG_CLOSE_MARGIN)
      box.y1 = Math.max(box.y1, q.y + MAG_CLOSE_MARGIN)
    }
    w.start(last.x, last.y, box)
    // 已画的段设成禁行（两端各留一点口子）：闭合段走「另一半」，不贴着来路折回去
    w.blockPath(drawn, 2, [first, last], 6)
    closing = w.pathTo(first.x, first.y)
    // 被堵死（窗口里绕不过去）：退回不禁行再算一次
    const end = closing[closing.length - 1]
    if (!end || Math.round(end.x) !== Math.round(first.x) || Math.round(end.y) !== Math.round(first.y) || closing.length < 2) {
      w.start(last.x, last.y, box)
      closing = w.pathTo(first.x, first.y)
    }
  }
  const all: Pt[] = []
  for (const seg of [...magSegs.value, closing])
    for (const p of seg) {
      const q = all[all.length - 1]
      if (!q || q.x !== p.x || q.y !== p.y) all.push(p)
    }
  const m = magMode.value
  magCancel()
  if (all.length > 1 && all[0]!.x === all[all.length - 1]!.x && all[0]!.y === all[all.length - 1]!.y) all.pop()
  if (all.length < 3) return
  const poly = smoothGridPath(all, 0.6).map(fromGrid)
  const k = imgPerScreen.value
  if (poly.length >= 3 && Math.abs(polygonArea(poly)) >= 64 * k * k) addShape('lasso', m, poly)
}

/** 指针离起点够近（屏幕 HIT_PX 内），且已经走出去一段：再点 = 闭合 */
const magNearStart = ref(false)
function updateNearStart(c: Pt | null) {
  const s = magSeeds.value
  magNearStart.value =
    !!c && s.length >= 2 && Math.hypot(s[0]!.x - c.x, s[0]!.y - c.y) <= HIT_PX * gridPerScreen.value
}

watch(magContrast, () => {
  if (magActive.value) {
    resetWire()
    magSchedule()
  }
})
watch(magnetic, (on) => {
  if (!on && magActive.value) magClose()
})

/** 渲染：已固化 + 实时段（原图坐标） */
const magFixedD = computed(() => {
  const segs = magSegs.value
  const seeds = magSeeds.value
  if (!seeds.length) return ''
  const pts: Pt[] = [fromGrid(seeds[0]!)]
  for (const seg of segs) for (let i = 1; i < seg.length; i++) pts.push(fromGrid(seg[i]!))
  return pts.length > 1 ? polyD(pts, false) : ''
})
const magLiveD = computed(() => (magLive.value.length > 1 ? polyD(magLive.value.map(fromGrid), false) : ''))
/** 白色衬底：两段连成一条 */
const magHaloD = computed(() => {
  const a = magFixedD.value
  const b = magLiveD.value
  if (!a) return b
  return b ? a + b.replace(/^M/, 'L') : a
})
const magSeedPts = computed(() => magSeeds.value.map(fromGrid))
/** 宽度圈（原图单位）：吸附范围示意 */
const magWidthR = computed(() => {
  const { w: nw } = natural.value
  return nw ? (magWidth.value / gridSize().w) * nw : 0
})

// ================= 键盘 =================

/** 不吃字符键的 input（滑杆 / 勾选 / 按钮类）：焦点在上面时工具快捷键照常（方向键仍归滑杆） */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'])
function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)
  return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

function onKey(e: KeyboardEvent) {
  if (!show.value || isTyping(e.target)) return
  // 拖选框时按下 / 松开 Shift、Alt：不等鼠标动就更新
  if (gesture?.kind === 'marquee' && (e.key === 'Shift' || e.key === 'Alt')) {
    gesture.square = e.shiftKey
    gesture.center = e.altKey
    updateMarquee()
    e.preventDefault()
    return
  }
  // 磁性套索：按住 / 松开 Alt 临时切手绘，不等指针动就重画
  if (e.key === 'Alt' && magActive.value) {
    magAlt.value = true
    magSchedule()
    e.preventDefault()
    return
  }
  const mod = e.metaKey || e.ctrlKey
  const k = e.key
  const lower = k.length === 1 ? k.toLowerCase() : k
  let handled = true
  if (mod && lower === 'z') {
    if (e.shiftKey) redo()
    else undo()
  } else if (mod && lower === 'y') redo()
  else if (mod || e.altKey) handled = false
  else if (k === ' ') {
    // 焦点在按钮上时空格照常按下按钮（键盘用户）
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'radio')) handled = false
    else spaceHeld.value = true
  } else if (lower === 'v' && !samDisabled) setTool('point')
  else if (lower === 'm') {
    if (tool.value === 'marquee') marqueeShape.value = marqueeShape.value === 'rect' ? 'ellipse' : 'rect'
    else setTool('marquee')
  } else if (lower === 'p') setTool('pen')
  else if (lower === 'l') setTool('lasso')
  else if (lower === 'h') setTool('move')
  else if (lower === 'w') setTool('wand')
  else if (lower === 'b') setTool('brush')
  else if (k === '[') brushSize.value = Math.max(2, Math.round(brushSize.value / 1.25))
  else if (k === ']') brushSize.value = Math.min(200, Math.round(brushSize.value * 1.25))
  else if (lower === 'a' || k === '+' || k === '=') mode.value = 'add'
  else if (lower === 'e' || k === '-' || k === '_') mode.value = 'sub'
  else if (k === '0') zoomFit()
  else if (k === 'Enter') {
    if (penNodes.value.length) closePen()
    else if (magActive.value) magClose()
    else handled = false
  } else if (k === 'Backspace' || k === 'Delete') {
    // 都不再冒泡给宿主（画布会当成删除节点）
    if (penNodes.value.length) penNodes.value = penNodes.value.slice(0, -1)
    else if (magActive.value) magBack()
    else if (selAnchor.value !== null && selectedPen.value) removeAnchor(selAnchor.value)
    else if (selectedId.value !== null) removeShape(selectedId.value)
    // 长按连删锚点删到底时不顺势撤销已完成的形状 / 点
    else if (!e.repeat) undo()
  } else if (k === 'Escape') {
    // 有东西可放弃时自己消化；否则交给 n-modal（close-on-esc 只关最上层弹窗）
    if (penNodes.value.length) cancelPen()
    else if (magActive.value) {
      if (gesture?.kind === 'magnetic') gesture = null
      magCancel()
    } else if (gesture?.kind === 'lasso' || gesture?.kind === 'brush' || gesture?.kind === 'marquee' || gesture?.kind === 'penEdit')
      abortGesture()
    else if (selAnchor.value !== null) selAnchor.value = null
    else if (selectedId.value !== null) selectedId.value = null
    else handled = false
  } else handled = false
  if (!handled) return
  e.preventDefault()
  e.stopPropagation()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === ' ') spaceHeld.value = false
  if (e.key === 'Alt' && magAlt.value) {
    magAlt.value = false
    if (gesture?.kind !== 'magnetic' || !gesture.free) magFreehand = null
    magSchedule()
  }
  if (gesture?.kind === 'marquee' && (e.key === 'Shift' || e.key === 'Alt')) {
    gesture.square = e.shiftKey
    gesture.center = e.altKey
    updateMarquee()
  }
}
function onBlur() {
  spaceHeld.value = false
  magAlt.value = false
}

// ================= 渲染辅助 =================

const pct = (v: number, of: number) => `${(v / (of || 1)) * 100}%`
const boxStyle = (b: PointBox) => ({
  left: pct(b.x0, natural.value.w),
  top: pct(b.y0, natural.value.h),
  width: pct(b.x1 - b.x0, natural.value.w),
  height: pct(b.y1 - b.y0, natural.value.h),
})
const f1 = (n: number) => Math.round(n * 10) / 10
function polyD(poly: Pt[], closed = true): string {
  if (!poly.length) return ''
  const [first, ...rest] = poly
  return `M${f1(first!.x)} ${f1(first!.y)}${rest.map((p) => `L${f1(p.x)} ${f1(p.y)}`).join('')}${closed ? 'Z' : ''}`
}
const penPreviewD = computed(() => {
  const n = penNodes.value
  if (!n.length) return ''
  const d = polyD(penToPolyline(n, false, Math.max(0.25, 0.5 * imgPerScreen.value)), false)
  const h = hover.value
  return h && !nearPenStart.value ? `${d}L${f1(h.x)} ${f1(h.y)}` : d
})
const lassoD = computed(() => polyD(lassoPts.value, false))
/** 锚点 / 手柄在 SVG 里的半径（原图单位，屏幕上约 4px） */
const nodeR = computed(() => 4 * imgPerScreen.value)
const SHAPE_NAMES: Record<SelectionShape['kind'], string> = { pen: '钢笔', lasso: '自由', rect: '矩形', ellipse: '椭圆' }
const shapeLabel = (s: SelectionShape, i: number) => `${SHAPE_NAMES[s.kind]} ${i + 1}`

const stageCursor = computed(() => {
  if (panning.value) return 'grabbing'
  if (hoverEdit.value === 'segment') return 'copy'
  if (hoverEdit.value) return 'move'
  if (spaceHeld.value || tool.value === 'move') return 'grab'
  if (tool.value === 'point') {
    if (hoverMarker.value >= 0) return 'pointer'
    return embedding.value ? 'progress' : 'crosshair'
  }
  if (tool.value === 'pen' && nearPenStart.value) return 'pointer'
  if (tool.value === 'lasso' && magActive.value && magNearStart.value) return 'pointer'
  if (restoring.value) return 'progress'
  if (tool.value === 'brush') return 'none'
  return 'crosshair'
})
const touchAction = computed(() => (tool.value === 'move' && zoom.value === 1 ? 'pan-y' : 'none'))

// ================= 导出 =================

/** 小网格蒙版平滑放大到 W×H（canvas 双线性），读回单通道 */
function upscaleMask(mask: Uint8Array, sw: number, sh: number, W: number, H: number): Uint8Array {
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d')
  const big = document.createElement('canvas')
  big.width = W
  big.height = H
  const bctx = big.getContext('2d', { willReadFrequently: true })
  if (!sctx || !bctx) throw new Error('画布不可用')
  const img = sctx.createImageData(sw, sh)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(small, 0, 0, W, H)
  const data = bctx.getImageData(0, 0, W, H).data
  const out = new Uint8Array(W * H)
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4]!
  small.width = small.height = big.width = big.height = 0
  return out
}

async function maskToPng(mask: Uint8Array, W: number, H: number): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('画布不可用')
  const img = ctx.createImageData(W, H)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
  c.width = c.height = 0
  if (!blob) throw new Error('选区导出失败')
  return blob
}

/** 有形状：工作分辨率（长边 = 原图长边夹到 1024–2048；小图也按 1024 出，下游烘图按原图尺寸拉伸）合成导出 */
async function exportComposite(): Promise<Blob> {
  const { w: nw, h: nh } = natural.value
  const side = Math.min(PAINTED_MASK_MAX_SIDE, Math.max(POINT_SEGMENT_INPUT_SIDE, Math.max(nw, nh)))
  const g = gridOf(side)
  const pg = gridOf(POINT_SEGMENT_INPUT_SIDE)
  const r = result.value
  const base = r ? upscaleMask(r.mask, r.width, r.height, g.w, g.h) : null
  // 魔棒在预览网格上算（与看到的一致），导出时平滑放大
  const wandAt = (op: WandOp) => {
    const m = wandMask(op)
    return m ? upscaleMask(m, pg.w, pg.h, g.w, g.h) : null
  }
  const mask = composeAt(g.w, g.h, base, wandAt, doc.value.strokes, doc.value.post) ?? new Uint8Array(g.w * g.h)
  return maskToPng(mask, g.w, g.h)
}

/** 单通道蒙版 → 灰度 PNG（会话里存点选结果用） */
function grayPng(mask: Uint8Array, W: number, H: number): Promise<Blob> {
  return maskToPng(mask, W, H)
}

/** 两张单通道图 → 一张 PNG（R = a，G = b；会话里存笔画夹取图） */
async function pairPng(a: Uint8Array, b: Uint8Array, W: number, H: number): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('画布不可用')
  const img = ctx.createImageData(W, H)
  for (let i = 0; i < a.length; i++) {
    img.data[i * 4] = a[i]!
    img.data[i * 4 + 1] = b[i]!
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
  c.width = c.height = 0
  if (!blob) throw new Error('选区导出失败')
  return blob
}

/** 位图 Blob → 各通道（按 W×H 读；读不出抛错） */
async function readChannels(blob: Blob, W: number, H: number): Promise<Uint8ClampedArray> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('会话位图读取失败'))
      el.src = url
    })
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('画布不可用')
    ctx.drawImage(img, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    c.width = c.height = 0
    return data
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 垫底选区（priorImg）编码成 PNG：会话自带它，下次还原不依赖已被覆盖的旧蒙版 */
async function priorPng(): Promise<Blob | undefined> {
  const img = priorImg.value
  if (!img) return undefined
  const W = Math.min(PAINTED_MASK_MAX_SIDE, img.naturalWidth || 1)
  const H = Math.max(1, Math.round(((img.naturalHeight || 1) * W) / (img.naturalWidth || 1)))
  const m = readMaskImage(img, W, H)
  return maskToPng(m, W, H)
}

/** 本次编辑状态 → 会话（不含 maskSize，调用方存蒙版时补上） */
async function buildSession(d: SelDoc): Promise<Omit<SelectionSession, 'maskSize'>> {
  const { w: nw, h: nh } = natural.value
  const r = result.value
  const sam = r && resultMatches.value && (d.points.length || d.box) ? { blob: await grayPng(r.mask, r.width, r.height), width: r.width, height: r.height } : undefined
  let strokes = d.strokes
  let brush: Omit<SelectionSession, 'maskSize'>['brush']
  if (d.flatBrush || strokePointCount(d) > SESSION_STROKE_POINTS_MAX) {
    // 笔画压成夹取图（预览网格）：先套上次压好的，再盖这次的笔画
    const g = gridOf(POINT_SEGMENT_INPUT_SIDE)
    const base = d.flatBrush ? brushMapAt(g.w, g.h) : null
    const lo = base ? base.lo.slice() : new Uint8Array(g.w * g.h)
    const hi = base ? base.hi.slice() : new Uint8Array(g.w * g.h).fill(255)
    for (const st of d.strokes) {
      stampStroke(lo, g.w, g.h, st, g.w / nw, g.h / nh)
      stampStroke(hi, g.w, g.h, st, g.w / nw, g.h / nh)
    }
    brush = { blob: await pairPng(lo, hi, g.w, g.h), width: g.w, height: g.h }
    strokes = []
  }
  const prior = d.prior ? await priorPng() : undefined
  const { flatBrush, ...rest } = d
  void flatBrush
  return {
    v: 1,
    natural: { w: nw, h: nh },
    doc: { ...rest, strokes, prior: d.prior && !!prior },
    ...(sam ? { sam } : {}),
    ...(brush ? { brush } : {}),
    ...(prior ? { prior } : {}),
  }
}

async function apply() {
  if (!hasSelection.value || exporting.value || samPending.value || priorPending.value || restoring.value) return
  if (penNodes.value.length) closePen()
  wandDraft.value = null
  postDraft.value = null
  exporting.value = true
  try {
    const s = seg.value
    const r = result.value
    // 只有点选：照旧存模型网格（长边 ≤1024），烘图时按原图尺寸平滑放大，蒙版占的本机存储小一个数量级
    const d = doc.value
    const onlySam =
      !d.shapes.length && !d.wands.length && !d.strokes.length && !d.prior && !d.flatBrush && !d.post.grow && !d.post.smooth
    const mask = onlySam && s && r ? await s.toMaskBlob(r, POINT_SEGMENT_INPUT_SIDE) : await exportComposite()
    // 会话打包失败不挡「完成」：下次从蒙版重新开始而已
    const session = await buildSession(d).catch(() => undefined)
    emit('apply', mask, session)
  } catch (err) {
    fail(err)
  } finally {
    exporting.value = false
  }
}

// ================= 继续编辑：还原上次的会话 =================

/** 正在取回 / 解码上次的会话（期间不接受编辑、不能完成） */
const restoring = ref(!!sessionLoader)
/** 刚还原了会话（状态行提示几秒） */
const restoredNote = ref(false)
let pendingSession: SelectionSession | null = null
let sessionDone = false

async function restoreSession(sess: SelectionSession) {
  const { w: nw, h: nh } = natural.value
  // 换了图（尺寸对不上）：不还原
  if (Math.abs(sess.natural.w - nw) > 0.5 || Math.abs(sess.natural.h - nh) > 0.5) return
  if (sess.sam && sess.doc.points.length + (sess.doc.box ? 1 : 0) > 0) {
    const data = await readChannels(sess.sam.blob, sess.sam.width, sess.sam.height)
    const mask = new Uint8Array(sess.sam.width * sess.sam.height)
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4]!
    result.value = { mask, width: sess.sam.width, height: sess.sam.height, srcWidth: nw, srcHeight: nh }
  }
  let flatBrush = false
  if (sess.brush) {
    const data = await readChannels(sess.brush.blob, sess.brush.width, sess.brush.height)
    const n = sess.brush.width * sess.brush.height
    const lo = new Uint8Array(n)
    const hi = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      lo[i] = data[i * 4]!
      hi[i] = data[i * 4 + 1]!
    }
    brushMap = { lo, hi, w: sess.brush.width, h: sess.brush.height }
    brushMapCache.clear()
    flatBrush = true
  }
  if (sessionPriorUrl) URL.revokeObjectURL(sessionPriorUrl)
  sessionPriorUrl = sess.prior ? URL.createObjectURL(sess.prior) : ''
  loadPrior(sess.doc.prior ? sessionPriorUrl : '')
  const d: SelDoc = { ...sess.doc, prior: sess.doc.prior && !!sessionPriorUrl, ...(flatBrush ? { flatBrush } : {}) }
  shapeSeq = Math.max(shapeSeq, ...d.shapes.map((x) => x.id))
  wandSeq = Math.max(wandSeq, ...d.wands.map((x) => x.id))
  strokeSeq = Math.max(strokeSeq, ...d.strokes.map((x) => x.id))
  if (result.value) resultFor.value = { points: d.points, box: d.box }
  history.value = [d]
  hIndex.value = 0
  restoredNote.value = true
  setTimeout(() => (restoredNote.value = false), 4000)
}

async function maybeRestore() {
  if (sessionDone || !pendingSession || !natural.value.w) return
  sessionDone = true
  const sess = pendingSession
  pendingSession = null
  try {
    await restoreSession(sess)
  } catch {
    /* 会话坏了：按 base-mask 从头来 */
  } finally {
    restoring.value = false
  }
}

if (sessionLoader) {
  // 图一直加载不出来（尺寸拿不到）时别一直挡着：8s 后放弃还原
  setTimeout(() => {
    if (!restoring.value) return
    sessionDone = true
    pendingSession = null
    restoring.value = false
  }, 8000)
  void sessionLoader()
    .catch(() => null)
    .then((sess) => {
      if (!sess) {
        sessionDone = true
        restoring.value = false
        return
      }
      pendingSession = sess
      void maybeRestore()
    })
}
watch(natural, () => void maybeRestore())

const segBtn =
  'inline-flex items-center justify-center gap-4px h-30px min-w-44px px-9px rounded-sm text-12px border border-solid border-transparent cursor-pointer select-none bg-transparent text-ink-2 hover:text-ink sx-focus'
const segOn = 'sx-grad-tint !border-violet-line !text-violet-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
</script>

<template>
  <!-- 弹层根节点必须是 div：naive 的焦点圈定按「起始哨兵后第一个 DIV」认内容区，section 会让焦点进不来 -->
  <n-modal v-model:show="show" transform-origin="center" :mask-closable="false" :close-on-esc="!escBusy">
    <div
      :class="large ? 'w-[min(1280px,calc(100vw-32px))]' : 'w-[min(820px,calc(100vw-32px))]'"
      class="max-h-[calc(100vh-48px)] overflow-y-auto box-border p-18px rounded-18px bg-white shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32)] flex flex-col gap-10px"
      role="dialog"
      :aria-label="title"
    >
      <header class="flex flex-wrap items-center gap-8px">
        <b class="flex-1 min-w-120px text-14px font-600 leading-20px text-ink">{{ title }}</b>
        <button type="button" class="sx-btn" @click="show = false">取消</button>
        <button
          type="button"
          class="sx-btn-primary"
          :disabled="!hasSelection || exporting || samPending || priorPending || restoring"
          :title="restoring ? '正在恢复上次的选区' : samPending ? '点选还在计算，稍等' : priorPending ? '正在读取已有选区' : !hasSelection ? '还没有选区' : undefined"
          @click="apply"
        >
          完成
        </button>
      </header>

      <div class="flex flex-wrap items-center gap-8px">
        <div class="sx-seg" role="toolbar" aria-label="选区工具">
          <button
            v-for="t in TOOLS"
            :key="t.key"
            type="button"
            :class="[segBtn, tool === t.key && segOn]"
            :aria-pressed="tool === t.key"
            :aria-keyshortcuts="t.kbd"
            :title="`${t.hint}（${t.kbd}）`"
            @click="setTool(t.key)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="t.icon" />
            </svg>
            {{ t.label }}
          </button>
        </div>
        <div class="sx-seg" role="group" aria-label="选区模式">
          <button
            type="button"
            :class="[segBtn, mode === 'add' && '!border-success-line !text-success font-600 bg-success-soft']"
            :aria-pressed="mode === 'add'"
            aria-keyshortcuts="A +"
            :title="tool === 'brush' ? '画笔涂抹 = 添加到选区（A 或 +）' : '选中：点 = 加入选区，选框 / 钢笔 / 自由 / 魔棒 = 添加区域（A 或 +）'"
            @click="mode = 'add'"
          >
            {{ tool === 'brush' ? '添加' : '选中' }} <span aria-hidden="true" class="text-14px font-700">+</span>
          </button>
          <button
            type="button"
            :class="[segBtn, mode === 'sub' && '!border-danger-line !text-danger font-600 bg-danger-soft']"
            :aria-pressed="mode === 'sub'"
            aria-keyshortcuts="E -"
            :title="tool === 'brush' ? '画笔涂抹 = 从选区擦除（E 或 −；也可按住 Alt）' : tool === 'marquee' ? '排除：选框挖掉区域（E 或 −；选框里 Shift / Alt 用于正方形 / 从中心）' : '排除：点 = 从选区排除，选框 / 钢笔 / 自由 / 魔棒 = 挖掉区域（E 或 −；也可 Alt / Shift + 单击）'"
            @click="mode = 'sub'"
          >
            {{ tool === 'brush' ? '擦除' : '排除' }} <span aria-hidden="true" class="text-14px font-700">−</span>
          </button>
        </div>
        <div class="flex items-center gap-8px">
          <button type="button" class="sx-btn" :disabled="!canUndo" title="撤销（⌘/Ctrl+Z）" @click="undo">撤销</button>
          <button type="button" class="sx-btn" :disabled="!canRedo" title="重做（Shift+⌘/Ctrl+Z）" @click="redo">
            重做
          </button>
          <button type="button" class="sx-btn" :disabled="!canClear" @click="clearAll">清空</button>
        </div>
      </div>

      <div
        v-if="tool === 'wand' || tool === 'brush' || tool === 'marquee' || tool === 'lasso' || hasSelection || doc.post.grow || doc.post.smooth"
        class="ps-opts flex flex-wrap items-center gap-x-16px gap-y-8px px-12px py-8px rounded-12px bg-surface2"
        role="group"
        aria-label="工具与选区选项"
      >
        <template v-if="tool === 'marquee'">
          <div class="ps-opt">
            <span class="ps-opt__label">形状</span>
            <div class="sx-seg" role="radiogroup" aria-label="选框形状（M 切换）">
              <button
                v-for="k in (['rect', 'ellipse'] as const)"
                :key="k"
                type="button"
                role="radio"
                :class="[segBtn, marqueeShape === k && segOn]"
                :aria-checked="marqueeShape === k"
                @click="marqueeShape = k"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect v-if="k === 'rect'" x="4" y="6" width="16" height="12" rx="1" stroke-dasharray="3 2" />
                  <ellipse v-else cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3 2" />
                </svg>
                {{ k === 'rect' ? '矩形' : '椭圆' }}
              </button>
            </div>
          </div>
          <span class="text-12px text-muted">Shift 正方形 / 正圆 · Alt 从中心</span>
        </template>
        <template v-else-if="tool === 'wand'">
          <label class="ps-opt">
            <span class="ps-opt__label">容差</span>
            <input
              type="range"
              min="1"
              max="60"
              step="1"
              :value="wandDraft?.tol ?? lastWand?.tol ?? wandTol"
              aria-label="魔棒容差：越大选中的颜色越多"
              title="越大选中的颜色越多；拖动时实时预览最近一次魔棒"
              @input="onWandTol(Number(($event.target as HTMLInputElement).value), false)"
              @change="onWandTol(Number(($event.target as HTMLInputElement).value), true)"
            />
            <b class="ps-opt__num">{{ wandDraft?.tol ?? lastWand?.tol ?? wandTol }}</b>
          </label>
          <label class="ps-opt cursor-pointer">
            <input
              type="checkbox"
              class="accent-violet w-14px h-14px m-0"
              :checked="lastWand?.contiguous ?? wandContiguous"
              @change="onWandContiguous(($event.target as HTMLInputElement).checked)"
            />
            <span class="ps-opt__label !w-auto">仅连续区域</span>
          </label>
        </template>
        <template v-else-if="tool === 'lasso'">
          <label class="ps-opt cursor-pointer" title="磁性套索：路径自动贴着物体边缘走（按浏览器记住）">
            <input
              v-model="magnetic"
              type="checkbox"
              role="switch"
              class="accent-violet w-14px h-14px m-0"
              :aria-checked="magnetic"
            />
            <span class="ps-opt__label !w-auto">吸附边缘</span>
          </label>
          <template v-if="magnetic">
            <label class="ps-opt" title="指针周围多大范围内找边缘（按长边 1024 像素计）">
              <span class="ps-opt__label">宽度</span>
              <input
                v-model.number="magWidth"
                type="range"
                min="1"
                max="40"
                step="1"
                class="ps-opt__range--sm"
                aria-label="吸附宽度：指针周围多大范围内找边缘"
              />
              <b class="ps-opt__num">{{ magWidth }}</b>
            </label>
            <label class="ps-opt" title="边缘对比度阈值：越高只贴明显的边，越低连弱边也贴">
              <span class="ps-opt__label">对比</span>
              <input
                v-model.number="magContrast"
                type="range"
                min="1"
                max="60"
                step="1"
                class="ps-opt__range--sm"
                aria-label="边缘对比度阈值（%）"
              />
              <b class="ps-opt__num">{{ magContrast }}%</b>
            </label>
            <button v-if="magActive" type="button" class="sx-btn" title="闭合选区（Enter / 双击 / 点起点）" @click="magClose">
              闭合
            </button>
          </template>
        </template>
        <template v-else-if="tool === 'brush'">
          <label class="ps-opt">
            <span class="ps-opt__label">大小</span>
            <input v-model.number="brushSize" type="range" min="2" max="200" step="1" aria-label="画笔大小" aria-keyshortcuts="[ ]" />
            <b class="ps-opt__num">{{ brushSize }}</b>
          </label>
          <label class="ps-opt">
            <span class="ps-opt__label">硬度</span>
            <input v-model.number="brushHardness" type="range" min="0" max="100" step="5" aria-label="画笔硬度：越低边缘越软" />
            <b class="ps-opt__num">{{ brushHardness }}</b>
          </label>
        </template>
        <span v-if="tool === 'wand' || tool === 'brush' || tool === 'marquee' || tool === 'lasso'" class="ps-opts__sep" aria-hidden="true" />
        <label class="ps-opt" title="整体扩展（正）或收缩（负）选区边缘，按长边 1024 像素计">
          <span class="ps-opt__label">扩展</span>
          <input
            type="range"
            min="-20"
            max="20"
            step="1"
            :value="effectivePost.grow"
            aria-label="扩展或收缩选区（像素，负数为收缩）"
            @input="onPost({ grow: Number(($event.target as HTMLInputElement).value) }, false)"
            @change="onPost({ grow: Number(($event.target as HTMLInputElement).value) }, true)"
          />
          <b class="ps-opt__num">{{ effectivePost.grow > 0 ? `+${effectivePost.grow}` : effectivePost.grow }}</b>
        </label>
        <label class="ps-opt" title="磨平锯齿与毛刺，边界位置基本不变">
          <span class="ps-opt__label">平滑</span>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            :value="effectivePost.smooth"
            aria-label="平滑选区边缘"
            @input="onPost({ smooth: Number(($event.target as HTMLInputElement).value) }, false)"
            @change="onPost({ smooth: Number(($event.target as HTMLInputElement).value) }, true)"
          />
          <b class="ps-opt__num">{{ effectivePost.smooth }}</b>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-8px min-h-32px">
        <span class="flex-1 min-w-200px text-12px leading-18px text-muted" role="status" aria-live="polite">
          {{ status }}
        </span>
        <div class="sx-seg" role="radiogroup" aria-label="选区查看方式">
          <button
            v-for="v in VIEW_MODES"
            :key="v"
            type="button"
            role="radio"
            :class="[segBtn, '!min-w-0', maskView === v && segOn]"
            :aria-checked="maskView === v"
            :title="MASK_VIEW_HINTS[v]"
            @click="setMaskView(v)"
          >
            {{ MASK_VIEW_LABELS[v] }}
          </button>
        </div>
        <div class="inline-flex items-center gap-8px" role="group" aria-label="缩放">
          <IconButton label="缩小" size="md" variant="quiet" :disabled="zoom <= 1" @click="zoomOut">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M5 12h14" />
            </svg>
          </IconButton>
          <span class="w-44px text-center text-12px tabular-nums text-ink-2">{{ Math.round(zoom * 100) }}%</span>
          <IconButton label="放大" size="md" variant="quiet" :disabled="zoom >= MAX_ZOOM" @click="zoomIn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </IconButton>
          <button type="button" class="sx-btn-ghost" :disabled="zoom === 1" title="适应窗口（0）" @click="zoomFit">
            适应
          </button>
        </div>
      </div>

      <div
        v-if="modelStarted && !modelReady && !error"
        class="h-4px rounded-2px bg-violet-soft-2 overflow-hidden"
        role="progressbar"
        aria-label="点选加载进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progress"
        :title="loadText"
      >
        <div class="ps-bar h-full bg-violet" :style="{ width: `${Math.max(4, progress)}%` }" />
      </div>

      <p
        v-if="error"
        class="m-0 flex items-center gap-8px px-12px py-8px rounded-12px bg-danger-soft text-12px leading-18px text-danger"
        role="alert"
      >
        <span class="flex-1">{{ error }}<template v-if="!modelReady">（钢笔、自由、魔棒、画笔不受影响）</template></span>
        <button v-if="retryable" type="button" class="sx-btn" @click="retry">重试</button>
      </p>

      <p
        v-if="pixelError && tool === 'wand'"
        class="m-0 px-12px py-8px rounded-12px bg-danger-soft text-12px leading-18px text-danger"
        role="alert"
      >
        {{ pixelError }}
      </p>

      <div
        ref="wrapEl"
        class="flex justify-center rounded-15px bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-8px"
      >
        <img
          v-if="!fit.w"
          :src="src"
          :crossorigin="corsAttr(src)"
          alt=""
          class="block max-w-full max-h-[min(58vh,620px)] opacity-0"
          @load="onImgLoad"
          @error="onImgError"
        />
        <div
          v-else
          ref="viewportEl"
          class="ps-viewport relative overflow-hidden select-none"
          :style="[viewportStyle, { cursor: stageCursor, touchAction }]"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @pointerleave="onPointerLeave"
          @dblclick="onStageDblClick"
          @contextmenu.prevent
        >
          <div ref="contentEl" class="absolute left-0 top-0" :style="contentStyle">
            <img
              ref="imgEl"
              :src="src"
              :crossorigin="corsAttr(src)"
              alt="智能选区"
              draggable="false"
              class="block w-full h-full pointer-events-none"
              @load="ensureEdgeMap"
            />
            <canvas ref="overlay" class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" />
            <svg
              class="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
              :viewBox="`0 0 ${natural.w} ${natural.h}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <g v-for="s in liveShapes" :key="s.id">
                <path
                  :d="polyD(s.poly)"
                  fill="none"
                  stroke="#fff"
                  :stroke-width="s.id === selectedId ? 5 : 3.5"
                  stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"
                />
                <path
                  :d="polyD(s.poly)"
                  :fill="s.id === selectedId ? 'rgba(135,95,154,0.12)' : 'none'"
                  :stroke="s.id === selectedId ? '#875f9a' : s.mode === 'add' ? '#e5484d' : '#1f2329'"
                  :stroke-width="s.id === selectedId ? 2.5 : 1.75"
                  :stroke-dasharray="s.mode === 'sub' ? '6 4' : undefined"
                  stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"
                />
              </g>
              <template v-if="penNodes.length">
                <path
                  :d="penPreviewD"
                  fill="none"
                  stroke="#fff"
                  stroke-width="3.5"
                  vector-effect="non-scaling-stroke"
                />
                <path
                  :d="penPreviewD"
                  fill="none"
                  :stroke="penMode === 'add' ? '#e5484d' : '#1f2329'"
                  stroke-width="1.75"
                  :stroke-dasharray="penMode === 'sub' ? '6 4' : undefined"
                  vector-effect="non-scaling-stroke"
                />
                <template v-for="(n, i) in penNodes" :key="i">
                  <template v-if="n.hx || n.hy">
                    <line
                      :x1="n.x - (n.hx ?? 0)"
                      :y1="n.y - (n.hy ?? 0)"
                      :x2="n.x + (n.hx ?? 0)"
                      :y2="n.y + (n.hy ?? 0)"
                      stroke="#875f9a"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle :cx="n.x + (n.hx ?? 0)" :cy="n.y + (n.hy ?? 0)" :r="nodeR * 0.7" fill="#875f9a" />
                    <circle :cx="n.x - (n.hx ?? 0)" :cy="n.y - (n.hy ?? 0)" :r="nodeR * 0.7" fill="#875f9a" />
                  </template>
                  <rect
                    :x="n.x - nodeR * (i === 0 && nearPenStart ? 1.6 : 1)"
                    :y="n.y - nodeR * (i === 0 && nearPenStart ? 1.6 : 1)"
                    :width="nodeR * 2 * (i === 0 && nearPenStart ? 1.6 : 1)"
                    :height="nodeR * 2 * (i === 0 && nearPenStart ? 1.6 : 1)"
                    :fill="i === 0 ? '#875f9a' : '#fff'"
                    stroke="#875f9a"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                  />
                </template>
              </template>
              <template v-if="tool === 'brush' && hover">
                <circle
                  :cx="hover.x"
                  :cy="hover.y"
                  :r="brushRadius"
                  fill="none"
                  stroke="#fff"
                  stroke-width="3"
                  vector-effect="non-scaling-stroke"
                />
                <circle
                  :cx="hover.x"
                  :cy="hover.y"
                  :r="brushRadius"
                  fill="none"
                  :stroke="mode === 'add' ? '#34795a' : '#b4433e'"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
                <circle
                  v-if="brushHardness < 100"
                  :cx="hover.x"
                  :cy="hover.y"
                  :r="brushRadius * (brushHardness / 100)"
                  fill="none"
                  stroke="#fff"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                  vector-effect="non-scaling-stroke"
                />
              </template>
              <template v-if="marqueeDraft">
                <component
                  :is="marqueeShape === 'rect' ? 'rect' : 'ellipse'"
                  v-bind="
                    marqueeShape === 'rect'
                      ? { x: marqueeDraft.x0, y: marqueeDraft.y0, width: marqueeDraft.x1 - marqueeDraft.x0, height: marqueeDraft.y1 - marqueeDraft.y0 }
                      : {
                          cx: (marqueeDraft.x0 + marqueeDraft.x1) / 2,
                          cy: (marqueeDraft.y0 + marqueeDraft.y1) / 2,
                          rx: (marqueeDraft.x1 - marqueeDraft.x0) / 2,
                          ry: (marqueeDraft.y1 - marqueeDraft.y0) / 2,
                        }
                  "
                  fill="rgba(135,95,154,0.10)"
                  stroke="#fff"
                  stroke-width="3.5"
                  vector-effect="non-scaling-stroke"
                />
                <component
                  :is="marqueeShape === 'rect' ? 'rect' : 'ellipse'"
                  v-bind="
                    marqueeShape === 'rect'
                      ? { x: marqueeDraft.x0, y: marqueeDraft.y0, width: marqueeDraft.x1 - marqueeDraft.x0, height: marqueeDraft.y1 - marqueeDraft.y0 }
                      : {
                          cx: (marqueeDraft.x0 + marqueeDraft.x1) / 2,
                          cy: (marqueeDraft.y0 + marqueeDraft.y1) / 2,
                          rx: (marqueeDraft.x1 - marqueeDraft.x0) / 2,
                          ry: (marqueeDraft.y1 - marqueeDraft.y0) / 2,
                        }
                  "
                  fill="none"
                  :stroke="marqueeMode === 'add' ? '#e5484d' : '#1f2329'"
                  stroke-width="1.75"
                  stroke-dasharray="6 4"
                  vector-effect="non-scaling-stroke"
                />
              </template>
              <template v-if="outlineD && maskView === 'outline'">
                <path :d="outlineD" fill="none" stroke="#fff" stroke-width="2.5" vector-effect="non-scaling-stroke" />
                <path
                  class="ps-ants"
                  :d="outlineD"
                  fill="none"
                  stroke="#1f2329"
                  stroke-width="1.25"
                  stroke-dasharray="5 4"
                  vector-effect="non-scaling-stroke"
                />
              </template>
              <template v-if="selectedPen && !penNodes.length">
                <template v-for="(n, i) in editNodes" :key="`e${i}`">
                  <template v-if="n.hx || n.hy || n.ix || n.iy">
                    <line
                      :x1="inHandle(n).x"
                      :y1="inHandle(n).y"
                      :x2="n.x"
                      :y2="n.y"
                      stroke="#875f9a"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <line
                      :x1="n.x"
                      :y1="n.y"
                      :x2="outHandle(n).x"
                      :y2="outHandle(n).y"
                      stroke="#875f9a"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle :cx="outHandle(n).x" :cy="outHandle(n).y" :r="nodeR * 0.75" fill="#875f9a" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" />
                    <circle :cx="inHandle(n).x" :cy="inHandle(n).y" :r="nodeR * 0.75" fill="#875f9a" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" />
                  </template>
                  <rect
                    :x="n.x - nodeR * 1.15"
                    :y="n.y - nodeR * 1.15"
                    :width="nodeR * 2.3"
                    :height="nodeR * 2.3"
                    :fill="selAnchor === i ? '#875f9a' : '#fff'"
                    stroke="#875f9a"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                  />
                </template>
              </template>
              <template v-if="magActive">
                <path :d="magHaloD" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
                <path
                  :d="magFixedD"
                  fill="none"
                  :stroke="magMode === 'add' ? '#e5484d' : '#1f2329'"
                  stroke-width="1.75"
                  stroke-linejoin="round"
                  :stroke-dasharray="magMode === 'sub' ? '6 4' : undefined"
                  vector-effect="non-scaling-stroke"
                />
                <path
                  :d="magLiveD"
                  fill="none"
                  :stroke="magAlt ? '#875f9a' : magMode === 'add' ? '#e5484d' : '#1f2329'"
                  stroke-width="1.75"
                  stroke-linejoin="round"
                  stroke-opacity="0.85"
                  :stroke-dasharray="magMode === 'sub' ? '6 4' : undefined"
                  vector-effect="non-scaling-stroke"
                />
                <rect
                  v-for="(q, i) in magSeedPts"
                  :key="`m${i}`"
                  :x="q.x - nodeR * (i === 0 && magNearStart ? 1.6 : 0.8)"
                  :y="q.y - nodeR * (i === 0 && magNearStart ? 1.6 : 0.8)"
                  :width="nodeR * 2 * (i === 0 && magNearStart ? 1.6 : 0.8)"
                  :height="nodeR * 2 * (i === 0 && magNearStart ? 1.6 : 0.8)"
                  :fill="i === 0 ? '#875f9a' : '#fff'"
                  stroke="#875f9a"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
              </template>
              <circle
                v-if="tool === 'lasso' && magOn && hover && !magAlt && magWidthR > 0"
                :cx="hover.x"
                :cy="hover.y"
                :r="magWidthR"
                fill="none"
                stroke="#fff"
                stroke-width="1"
                stroke-opacity="0.9"
                stroke-dasharray="3 3"
                vector-effect="non-scaling-stroke"
              />
              <template v-if="lassoPts.length > 1">
                <path :d="lassoD" fill="none" stroke="#fff" stroke-width="3.5" vector-effect="non-scaling-stroke" />
                <path
                  :d="lassoD"
                  fill="none"
                  :stroke="lassoMode === 'add' ? '#e5484d' : '#1f2329'"
                  stroke-width="1.75"
                  :stroke-dasharray="lassoMode === 'sub' ? '6 4' : undefined"
                  vector-effect="non-scaling-stroke"
                />
              </template>
            </svg>
            <div
              v-if="doc.box && !dragBox"
              class="absolute border-2 border-dashed border-violet rounded-4px pointer-events-none"
              :style="boxStyle(doc.box)"
              aria-hidden="true"
            />
            <div
              v-if="dragBox"
              class="absolute border-2 border-dashed border-violet bg-violet/10 rounded-4px pointer-events-none"
              :style="boxStyle(dragBox)"
              aria-hidden="true"
            />
            <div
              v-if="restoring"
              class="absolute inset-0 grid place-items-center bg-white/55 text-13px text-ink-2 pointer-events-none"
              role="status"
            >
              正在恢复上次的选区…
            </div>
            <span
              v-for="(p, i) in doc.points"
              :key="i"
              class="ps-dot"
              :class="[p.label ? 'is-pos' : 'is-neg', { 'is-hover': hoverMarker === i }]"
              :style="{ left: pct(p.x, natural.w), top: pct(p.y, natural.h) }"
              aria-hidden="true"
            >
              {{ p.label ? '+' : '−' }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="doc.shapes.length" class="flex flex-wrap items-center gap-8px" role="list" aria-label="已画的区域">
        <span class="text-12px text-muted">区域</span>
        <div
          v-for="(s, i) in doc.shapes"
          :key="s.id"
          role="listitem"
          class="inline-flex items-center gap-2px pl-2px pr-2px h-32px rounded-14px border border-solid"
          :class="s.id === selectedId ? 'border-violet-line bg-violet-soft' : 'border-line bg-white'"
        >
          <button
            type="button"
            class="inline-flex items-center gap-6px h-28px px-8px rounded-12px border-0 bg-transparent text-12px text-ink-2 cursor-pointer sx-focus"
            :aria-pressed="s.id === selectedId"
            :title="s.id === selectedId ? '取消选中' : '选中（Delete 删除）'"
            @click="selectedId = s.id === selectedId ? null : s.id"
          >
            <span
              class="inline-block w-8px h-8px rounded-full"
              :class="s.mode === 'add' ? 'bg-#e5484d' : 'bg-ink'"
              aria-hidden="true"
            />
            {{ shapeLabel(s, i) }}
          </button>
          <button
            type="button"
            class="h-24px px-6px rounded-10px border border-solid text-11px cursor-pointer sx-focus"
            :class="
              s.mode === 'add'
                ? 'border-success-line bg-success-soft text-success'
                : 'border-danger-line bg-danger-soft text-danger'
            "
            :title="s.mode === 'add' ? '当前为添加，点一下改为排除' : '当前为排除，点一下改为添加'"
            :aria-label="`${shapeLabel(s, i)}：${s.mode === 'add' ? '添加' : '排除'}，点击切换`"
            @click="toggleShapeMode(s.id)"
          >
            {{ s.mode === 'add' ? '添加' : '排除' }}
          </button>
          <IconButton :label="`删除${shapeLabel(s, i)}`" size="sm" variant="quiet" @click="removeShape(s.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </div>
      </div>

      <p class="m-0 text-11px leading-16px text-muted">
        选区在本机识别，图片不会上传。滚轮缩放，按住空格拖动画面；快捷键
        <template v-if="!samDisabled">V 点选 · </template>M 选框 · P 钢笔 · L 自由（可吸附边缘）· W 魔棒 · B 画笔（[ / ] 大小）· H 移动 · A / E
        选中 / 排除。完成后可在参数台里反选、调边缘柔化；下次打开会接着这次的编辑继续。
      </p>
    </div>
  </n-modal>
</template>

<style scoped lang="less">
.ps-viewport {
  -webkit-touch-callout: none;
}
.ps-dot {
  position: absolute;
  display: grid;
  width: 18px;
  height: 18px;
  box-sizing: border-box;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}
.ps-dot.is-pos {
  background: var(--xq-success);
}
.ps-dot.is-neg {
  background: var(--xq-danger);
}
.ps-dot.is-hover {
  box-shadow:
    0 0 0 3px rgba(135, 95, 154, 0.45),
    0 1px 3px rgba(0, 0, 0, 0.35);
}
.ps-bar {
  transition: width 0.2s ease;
}
/* 行军蚁：虚线缓慢流动；减少动态效果时静止 */
.ps-ants {
  animation: ps-ants 0.9s linear infinite;
}
@keyframes ps-ants {
  to {
    stroke-dashoffset: -9;
  }
}
/* 工具选项：标签 + 滑杆 + 数值，一组 ≥ 32 高 */
.ps-opt {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  color: var(--xq-ink-2);
  font-size: 12px;
}
.ps-opt input[type='range'] {
  width: 120px;
  accent-color: #875f9a;
}
.ps-opt input[type='range'].ps-opt__range--sm {
  width: 88px;
}
.ps-opt__label {
  width: 28px;
  flex: none;
}
.ps-opt__num {
  min-width: 24px;
  color: var(--xq-violet-press-fg);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.ps-opts__sep {
  width: 1px;
  height: 20px;
  background: var(--xq-line);
}
@media (prefers-reduced-motion: reduce) {
  .ps-bar {
    transition: none;
  }
  .ps-ants {
    animation: none;
  }
}
</style>
