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
 *   <li>自由（L）：按住拖动画轮廓，松开自动闭合并轻微平滑。</li>
 *   <li>移动（H）/ 按住空格 / 鼠标中键：拖动画面；滚轮以指针为中心缩放，触屏双指捏合。移动工具下单击选区 = 选中，Delete 删除。</li>
 * </ul>
 * 最终选区 = (点选蒙版 ∪ 添加的形状) − 排除的形状（selection-geometry.ts 的 combineMasks）。所有操作（点 / 框 / 形状 / 删除 /
 * 改模式）进同一条撤销栈：⌘/Ctrl+Z 撤销、Shift+⌘/Ctrl+Z（或 Ctrl+Y）重做。
 *
 * <p>「完成」：只有点选时导出模型网格（长边 1024）的黑底白选区 PNG（与以前一致）；有钢笔 / 自由形状时按工作分辨率
 * （长边 = 原图长边夹到 1024–2048）把点选蒙版放大后与形状合成导出。交给 useResultColorFix.applyPointMask，反选 / 柔化照常在参数台调。
 * 点选模型加载失败时钢笔 / 自由照样能用。关闭时终止 Worker，释放 WASM / GPU 内存。`large`：全屏调色里打开时弹窗接近整屏。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import { PAINTED_MASK_MAX_SIDE } from './mask-store.ts'
import { markPointSegmentBroken, POINT_UNSUPPORTED_HINT } from './point-support.ts'
import {
  combineMasks,
  distToPolygonEdge,
  lassoToPolygon,
  maskHasSelection,
  penToPolyline,
  pointInPolygon,
  polygonArea,
  rasterizeShapes,
  type PenNode,
  type Pt,
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

const { src, large = false } = defineProps<{
  src: string
  /** 大尺寸（全屏调色里打开） */
  large?: boolean
}>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ apply: [mask: Blob] }>()

type Tool = 'point' | 'pen' | 'lasso' | 'move'

const TOOLS: { key: Tool; label: string; kbd: string; hint: string; icon: string }[] = [
  {
    key: 'point',
    label: '点选',
    kbd: 'V',
    hint: '点选：单击物体自动识别选区',
    icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12h.01',
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
    hint: '自由：按住拖动画出轮廓，松开自动闭合',
    icon: 'M7 22a5 5 0 0 1-2-4M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  },
  {
    key: 'move',
    label: '移动',
    kbd: 'H',
    hint: '移动：拖动画面，单击选区可选中',
    icon: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  },
]
const TOOL_TIPS: Record<Tool, string> = {
  point: '单击加入选区；切到「排除 −」或按住 Alt / Shift 单击排除；拖动框选；点标记可删除',
  pen: '单击加锚点，按住拖动拉出曲线；点起点 / 双击 / Enter 闭合，Backspace 删上一点，Esc 放弃',
  lasso: '按住拖动画出轮廓，松开自动闭合',
  move: '拖动画面（也可按住空格 / 鼠标中键）；单击选区可选中，Delete 删除',
}

// ================= 文档：点 / 框 / 形状，整条撤销栈 =================

interface SelDoc {
  points: PointPrompt[]
  box: PointBox | null
  shapes: SelectionShape[]
}
const EMPTY: SelDoc = { points: [], box: null, shapes: [] }
const HISTORY_MAX = 100
const history = shallowRef<SelDoc[]>([EMPTY])
const hIndex = ref(0)
const doc = computed(() => history.value[hIndex.value] ?? EMPTY)
let shapeSeq = 0

function commit(next: SelDoc) {
  const list = [...history.value.slice(0, hIndex.value + 1), next]
  history.value = list.length > HISTORY_MAX ? list.slice(list.length - HISTORY_MAX) : list
  hIndex.value = history.value.length - 1
}

const tool = ref<Tool>('point')
const mode = ref<ShapeMode>('add')
const selectedId = ref<number | null>(null)
/** 钢笔正在画的路径 */
const penNodes = ref<PenNode[]>([])
const penMode = ref<ShapeMode>('add')
/** 自由正在画的原始轨迹（原图坐标） */
const lassoPts = shallowRef<Pt[]>([])
const lassoMode = ref<ShapeMode>('add')
const hover = ref<Pt | null>(null)

const isEmpty = computed(() => !doc.value.points.length && !doc.value.box && !doc.value.shapes.length)
const canUndo = computed(() => penNodes.value.length > 0 || hIndex.value > 0)
const canRedo = computed(() => !penNodes.value.length && hIndex.value < history.value.length - 1)
const canClear = computed(() => !isEmpty.value || penNodes.value.length > 0)
/** Esc 先由弹窗内部消化（放弃路径 / 取消选中），这时不让 n-modal 关窗 */
const escBusy = computed(() => penNodes.value.length > 0 || lassoPts.value.length > 0 || selectedId.value !== null)

function undo() {
  if (penNodes.value.length) {
    penNodes.value = penNodes.value.slice(0, -1)
    return
  }
  if (hIndex.value > 0) hIndex.value -= 1
}
function redo() {
  if (canRedo.value) hIndex.value += 1
}
function clearAll() {
  penNodes.value = []
  lassoPts.value = []
  selectedId.value = null
  if (!isEmpty.value) commit(EMPTY)
}

watch(doc, (d) => {
  if (selectedId.value !== null && !d.shapes.some((s) => s.id === selectedId.value)) selectedId.value = null
})

function setTool(t: Tool) {
  if (t === tool.value) return
  // 换工具时，已有 3 个以上锚点的钢笔路径自动闭合，少于 3 个的放弃
  if (penNodes.value.length) closePen()
  tool.value = t
  hover.value = null
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
function addShape(kind: SelectionShape['kind'], m: ShapeMode, poly: Pt[]) {
  const d = doc.value
  const shape: SelectionShape = { id: ++shapeSeq, kind, mode: m, poly }
  commit({ ...d, shapes: [...d.shapes, shape] })
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
/** 点选还欠一个结果（有正点 / 框，模型没出错，但还没算完）：这时「完成」会把点选丢掉，先不让点 */
const samPending = computed(
  () => hasPositive.value && !error.value && (!modelReady.value || embedding.value || decoding.value || !result.value),
)

const status = computed(() => {
  if (exporting.value) return '正在导出选区…'
  if (tool.value === 'point' && !error.value) {
    if (!modelReady.value) return loadText.value
    if (embedding.value) return '正在识别图片…'
    if (decoding.value) return '正在计算选区…'
    if (doc.value.points.length && !hasPositive.value) return '只有排除点：先点选要保留的物体，或用钢笔 / 自由圈出区域'
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

async function start() {
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
    if (doc.value.points.length || doc.value.box) void refresh()
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
  void start()
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
  seg.value?.dispose()
  seg.value = null
})

// ---------------- 推理：最新优先，进行中有新操作就再跑一轮 ----------------

let running = false
let dirty = false
async function refresh() {
  const s = seg.value
  if (!s || !modelReady.value || error.value) return
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    do {
      dirty = false
      const pts = doc.value.points.slice()
      const b = doc.value.box
      if (!pts.length && !b) {
        result.value = null
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
        if (!dirty) result.value = r
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
    if (!pts.length && !b) result.value = null
    void refresh()
  },
)

// ================= 合成预览：(点选 ∪ 添加) − 排除，模型网格（长边 1024） =================

const overlay = ref<HTMLCanvasElement | null>(null)
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

function recompose() {
  const { w: nw, h: nh } = natural.value
  if (!nw || !nh) {
    composite.value = null
    drawOverlay()
    return
  }
  const g = gridOf(POINT_SEGMENT_INPUT_SIDE)
  const r = result.value
  const base = r ? resampleNearest(r.mask, r.width, r.height, g.w, g.h) : null
  const { add, sub } = rasterizeShapes(doc.value.shapes, g.w, g.h, g.w / nw, g.h / nh)
  composite.value = base || add ? { mask: combineMasks(g.w * g.h, base, add, sub), width: g.w, height: g.h } : null
  drawOverlay()
}
watch([result, () => doc.value.shapes, natural], recompose)
watch(overlay, drawOverlay)

function drawOverlay() {
  const c = overlay.value
  const r = composite.value
  if (!c) return
  if (!r) {
    c.width = c.height = 0
    return
  }
  c.width = r.width
  c.height = r.height
  const ctx = c.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(r.width, r.height)
  for (let i = 0; i < r.mask.length; i++) {
    const a = r.mask[i]!
    if (a < 8) continue
    img.data[i * 4] = 135
    img.data[i * 4 + 1] = 95
    img.data[i * 4 + 2] = 154
    img.data[i * 4 + 3] = Math.round(a * 0.55)
  }
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
  if (!fit.value.w) return
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
  if (tool.value === 'pen') {
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
  // 自由
  lassoMode.value = (mode.value === 'sub') !== invert ? 'sub' : 'add'
  lassoPts.value = [p]
  gesture = { kind: 'lasso', id: e.pointerId, cx: e.clientX, cy: e.clientY }
}

function onPointerMove(e: PointerEvent) {
  const rec = pointers.get(e.pointerId)
  if (rec) {
    rec.x = e.clientX
    rec.y = e.clientY
  }
  const g = gesture
  if (!g) {
    // 悬停：钢笔橡皮筋 / 标记高亮
    if (e.pointerType === 'mouse') {
      const p = toImage(e)
      hover.value = tool.value === 'pen' ? p : null
      hoverMarker.value = tool.value === 'point' && p ? pointAt(p) : -1
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
  if (poly.length >= 3 && Math.abs(polygonArea(poly)) >= 16 * k * k) addShape('pen', penMode.value, poly)
}

function cancelPen() {
  penNodes.value = []
  hover.value = null
}

// ================= 键盘 =================

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return (
    !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT')
  )
}

function onKey(e: KeyboardEvent) {
  if (!show.value || isTyping(e.target)) return
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
  } else if (lower === 'v') setTool('point')
  else if (lower === 'p') setTool('pen')
  else if (lower === 'l') setTool('lasso')
  else if (lower === 'h') setTool('move')
  else if (lower === 'a' || k === '+' || k === '=') mode.value = 'add'
  else if (lower === 'e' || k === '-' || k === '_') mode.value = 'sub'
  else if (k === '0') zoomFit()
  else if (k === 'Enter') {
    if (penNodes.value.length) closePen()
    else handled = false
  } else if (k === 'Backspace' || k === 'Delete') {
    // 都不再冒泡给宿主（画布会当成删除节点）
    if (penNodes.value.length) penNodes.value = penNodes.value.slice(0, -1)
    else if (selectedId.value !== null) removeShape(selectedId.value)
    // 长按连删锚点删到底时不顺势撤销已完成的形状 / 点
    else if (!e.repeat) undo()
  } else if (k === 'Escape') {
    // 有东西可放弃时自己消化；否则交给 n-modal（close-on-esc 只关最上层弹窗）
    if (penNodes.value.length) cancelPen()
    else if (gesture?.kind === 'lasso') abortGesture()
    else if (selectedId.value !== null) selectedId.value = null
    else handled = false
  } else handled = false
  if (!handled) return
  e.preventDefault()
  e.stopPropagation()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === ' ') spaceHeld.value = false
}
function onBlur() {
  spaceHeld.value = false
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
const shapeLabel = (s: SelectionShape, i: number) => `${s.kind === 'pen' ? '钢笔' : '自由'} ${i + 1}`

const stageCursor = computed(() => {
  if (panning.value) return 'grabbing'
  if (spaceHeld.value || tool.value === 'move') return 'grab'
  if (tool.value === 'point') {
    if (hoverMarker.value >= 0) return 'pointer'
    return embedding.value ? 'progress' : 'crosshair'
  }
  if (tool.value === 'pen' && nearPenStart.value) return 'pointer'
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
  const r = result.value
  const base = r ? upscaleMask(r.mask, r.width, r.height, g.w, g.h) : null
  const { add, sub } = rasterizeShapes(doc.value.shapes, g.w, g.h, g.w / nw, g.h / nh)
  return maskToPng(combineMasks(g.w * g.h, base, add, sub), g.w, g.h)
}

async function apply() {
  if (!hasSelection.value || exporting.value || samPending.value) return
  if (penNodes.value.length) closePen()
  exporting.value = true
  try {
    const s = seg.value
    const r = result.value
    // 只有点选：照旧存模型网格（长边 ≤1024），烘图时按原图尺寸平滑放大，蒙版占的本机存储小一个数量级
    if (!doc.value.shapes.length && s && r) emit('apply', await s.toMaskBlob(r, POINT_SEGMENT_INPUT_SIDE))
    else emit('apply', await exportComposite())
  } catch (err) {
    fail(err)
  } finally {
    exporting.value = false
  }
}

const segBtn =
  'inline-flex items-center justify-center gap-4px h-30px min-w-44px px-9px rounded-sm text-12px border border-solid border-transparent cursor-pointer select-none bg-transparent text-ink-2 hover:text-ink sx-focus'
const segOn = 'sx-grad-tint !border-violet-line !text-violet-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
</script>

<template>
  <n-modal v-model:show="show" transform-origin="center" :mask-closable="false" :close-on-esc="!escBusy">
    <section
      :class="large ? 'w-[min(1280px,calc(100vw-32px))]' : 'w-[min(820px,calc(100vw-32px))]'"
      class="max-h-[calc(100vh-48px)] overflow-y-auto box-border p-18px rounded-18px bg-white shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32)] flex flex-col gap-10px"
      role="dialog"
      aria-label="智能选区"
    >
      <header class="flex flex-wrap items-center gap-8px">
        <b class="flex-1 min-w-120px text-14px font-600 leading-20px text-ink">智能选区</b>
        <button type="button" class="sx-btn" @click="show = false">取消</button>
        <button
          type="button"
          class="sx-btn-primary"
          :disabled="!hasSelection || exporting || samPending"
          :title="samPending ? '点选还在计算，稍等' : !hasSelection ? '还没有选区' : undefined"
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
            title="选中：点 = 加入选区，钢笔 / 自由 = 添加区域（A 或 +）"
            @click="mode = 'add'"
          >
            选中 <span aria-hidden="true" class="text-14px font-700">+</span>
          </button>
          <button
            type="button"
            :class="[segBtn, mode === 'sub' && '!border-danger-line !text-danger font-600 bg-danger-soft']"
            :aria-pressed="mode === 'sub'"
            aria-keyshortcuts="E -"
            title="排除：点 = 从选区排除，钢笔 / 自由 = 挖掉区域（E 或 −；点选时也可 Alt / Shift + 单击）"
            @click="mode = 'sub'"
          >
            排除 <span aria-hidden="true" class="text-14px font-700">−</span>
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

      <div class="flex flex-wrap items-center gap-8px min-h-32px">
        <span class="flex-1 min-w-200px text-12px leading-18px text-muted" role="status" aria-live="polite">
          {{ status }}
        </span>
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
        v-if="!modelReady && !error"
        class="h-4px rounded-2px bg-#efe9f3 overflow-hidden"
        role="progressbar"
        aria-label="点选加载进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progress"
        :title="loadText"
      >
        <div class="ps-bar h-full bg-#875f9a" :style="{ width: `${Math.max(4, progress)}%` }" />
      </div>

      <p
        v-if="error"
        class="m-0 flex items-center gap-8px px-12px py-8px rounded-12px bg-#fbeceb text-12px leading-18px text-#b4433e"
        role="alert"
      >
        <span class="flex-1">{{ error }}<template v-if="!modelReady">（钢笔、自由选区不受影响）</template></span>
        <button v-if="retryable" type="button" class="sx-btn" @click="retry">重试</button>
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
          @contextmenu.prevent
        >
          <div ref="contentEl" class="absolute left-0 top-0" :style="contentStyle">
            <img
              :src="src"
              :crossorigin="corsAttr(src)"
              alt="智能选区"
              draggable="false"
              class="block w-full h-full pointer-events-none"
            />
            <canvas ref="overlay" class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" />
            <svg
              class="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
              :viewBox="`0 0 ${natural.w} ${natural.h}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <g v-for="s in doc.shapes" :key="s.id">
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
              class="absolute border-2 border-dashed border-#875f9a rounded-4px pointer-events-none"
              :style="boxStyle(doc.box)"
              aria-hidden="true"
            />
            <div
              v-if="dragBox"
              class="absolute border-2 border-dashed border-#875f9a bg-#875f9a/10 rounded-4px pointer-events-none"
              :style="boxStyle(dragBox)"
              aria-hidden="true"
            />
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
        选区在本机识别，图片不会上传。滚轮缩放，按住空格拖动画面；快捷键 V 点选 · P 钢笔 · L 自由 · H 移动 · A / E 选中
        / 排除。 完成后可在参数台里反选、调边缘柔化。
      </p>
    </section>
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
  background: #34795a;
}
.ps-dot.is-neg {
  background: #b4433e;
}
.ps-dot.is-hover {
  box-shadow:
    0 0 0 3px rgba(135, 95, 154, 0.45),
    0 1px 3px rgba(0, 0, 0, 0.35);
}
.ps-bar {
  transition: width 0.2s ease;
}
@media (prefers-reduced-motion: reduce) {
  .ps-bar {
    transition: none;
  }
}
</style>
