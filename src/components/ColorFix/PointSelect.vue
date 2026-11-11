<script setup lang="ts">
/**
 * 局部调色 · 点选选区弹窗（本机 SlimSAM 分割，图片不出设备；模型 / 推理见 pointSegment.ts）。
 *
 * <p>操作：单击 = 加入选区（绿 +）；Alt / Shift + 单击，或打开「排除」后单击 = 排除（红 −）；拖出一个框 = 只在框内找主体。
 * 触屏：轻点 = 加入，长按 = 排除，拖动 = 框选。「撤销上一点」「清空」「完成」；Esc 取消，⌘/Ctrl+Z 撤销。
 * 打开即开始加载模型；第一次点击时识别整张图（「正在识别图片…」，同一张图只做一次），之后每次点击几十毫秒出选区。
 * 「完成」导出模型网格尺寸（长边 ≤1024，与原图同比例）的黑底白选区 PNG，交给 useResultColorFix.applyPointMask；反选 / 柔化在参数台调。
 * 关闭时终止 Worker，释放 WASM / GPU 内存。
 *
 * <p>加载进度按真实字节显示：识别引擎（WASM 运行时，约 28.7MB）与模型分开计（「下载识别引擎 12.3/28.7 MB」），
 * 都在缓存里时直接进入「正在启动点选…」。`large`：全屏调色里打开时弹窗接近整屏，图更大、点得更准。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import { markPointSegmentBroken, POINT_UNSUPPORTED_HINT } from './point-support.ts'
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

type Action = { kind: 'point'; p: PointPrompt } | { kind: 'box'; b: PointBox }

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
const exclude = ref(false)
const actions = ref<Action[]>([])
const result = shallowRef<PointMaskResult | null>(null)
const natural = ref({ w: 0, h: 0 })
const dragBox = ref<PointBox | null>(null)

const imgEl = ref<HTMLImageElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)

const points = computed(() => actions.value.flatMap((a) => (a.kind === 'point' ? [a.p] : [])))
const box = computed(() => {
  for (let i = actions.value.length - 1; i >= 0; i--) {
    const a = actions.value[i]!
    if (a.kind === 'box') return a.b
  }
  return null
})
const status = computed(() => {
  if (error.value) return ''
  if (!modelReady.value) return loadText.value
  if (embedding.value) return '正在识别图片…'
  if (decoding.value) return '正在计算选区…'
  if (!actions.value.length) return '单击要调色的物体；Alt / Shift + 单击排除，拖动可框选'
  if (!box.value && !points.value.some((p) => p.label === 1)) return '请先点选要保留的物体'
  return ''
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
    if (actions.value.length) void refresh()
  } catch (err) {
    fail(err, true)
  }
}

onMounted(() => {
  void start()
  // 捕获阶段：先于宿主页面（画布等）在 window 上的快捷键，处理过的键不再往外传
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  clearTimeout(pressTimer)
  seg.value?.dispose()
  seg.value = null
})

function onKey(e: KeyboardEvent) {
  if (!show.value) return
  // Esc 交给 n-modal（close-on-esc 只关最上层弹窗，不会连带关掉下面的校色弹窗）
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
  const isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z'
  // Backspace / Delete = 撤销上一点；都不再冒泡给宿主（画布会当成删除节点）
  if (isUndo || e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault()
    e.stopPropagation()
    if (actions.value.length) undo()
  }
}

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
      const pts = points.value.slice()
      const b = box.value
      if (!pts.length && !b) {
        result.value = null
        drawOverlay()
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
          drawOverlay()
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

function drawOverlay() {
  const c = overlay.value
  const r = result.value
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

function push(a: Action) {
  actions.value = [...actions.value, a]
  void refresh()
}

function undo() {
  if (!actions.value.length) return
  actions.value = actions.value.slice(0, -1)
  void refresh()
}

function clearAll() {
  actions.value = []
  void refresh()
}

// ---------------- 指针：单击 = 点，拖动 = 框，触屏长按 = 排除 ----------------

const DRAG_PX = 8
const LONG_PRESS_MS = 500
let down: { cx: number; cy: number; x: number; y: number; id: number; touch: boolean } | null = null
let consumed = false
let pressTimer: ReturnType<typeof setTimeout> | undefined

function toImage(clientX: number, clientY: number) {
  const el = imgEl.value
  if (!el || !natural.value.w) return null
  const rect = el.getBoundingClientRect()
  const x = ((clientX - rect.left) / rect.width) * natural.value.w
  const y = ((clientY - rect.top) / rect.height) * natural.value.h
  return { x: Math.min(natural.value.w - 1, Math.max(0, x)), y: Math.min(natural.value.h - 1, Math.max(0, y)) }
}

function onImgLoad() {
  const el = imgEl.value
  if (el) natural.value = { w: el.naturalWidth, h: el.naturalHeight }
}

function onImgError() {
  markCorsBlocked(src)
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || error.value) return
  const p = toImage(e.clientX, e.clientY)
  if (!p) return
  e.preventDefault()
  stageEl.value?.setPointerCapture?.(e.pointerId)
  const touch = e.pointerType !== 'mouse'
  down = { cx: e.clientX, cy: e.clientY, x: p.x, y: p.y, id: e.pointerId, touch }
  consumed = false
  clearTimeout(pressTimer)
  if (touch) {
    pressTimer = setTimeout(() => {
      if (!down || dragBox.value) return
      consumed = true
      push({ kind: 'point', p: { x: down.x, y: down.y, label: 0 } })
      navigator.vibrate?.(10)
    }, LONG_PRESS_MS)
  }
}

function onPointerMove(e: PointerEvent) {
  if (!down || e.pointerId !== down.id || consumed) return
  if (!dragBox.value && Math.hypot(e.clientX - down.cx, e.clientY - down.cy) < DRAG_PX) return
  clearTimeout(pressTimer)
  const p = toImage(e.clientX, e.clientY)
  if (!p) return
  dragBox.value = {
    x0: Math.min(down.x, p.x),
    y0: Math.min(down.y, p.y),
    x1: Math.max(down.x, p.x),
    y1: Math.max(down.y, p.y),
  }
}

function onPointerUp(e: PointerEvent) {
  if (!down || e.pointerId !== down.id) return
  clearTimeout(pressTimer)
  const b = dragBox.value
  const start = down
  down = null
  dragBox.value = null
  if (consumed) return
  if (b) {
    if (b.x1 - b.x0 > 4 && b.y1 - b.y0 > 4) push({ kind: 'box', b })
    return
  }
  const negative = exclude.value !== (e.altKey || e.shiftKey)
  push({ kind: 'point', p: { x: start.x, y: start.y, label: negative ? 0 : 1 } })
}

function onPointerCancel() {
  clearTimeout(pressTimer)
  down = null
  dragBox.value = null
}

const pct = (v: number, of: number) => `${(v / (of || 1)) * 100}%`
const boxStyle = (b: PointBox) => ({
  left: pct(b.x0, natural.value.w),
  top: pct(b.y0, natural.value.h),
  width: pct(b.x1 - b.x0, natural.value.w),
  height: pct(b.y1 - b.y0, natural.value.h),
})

async function apply() {
  const s = seg.value
  const r = result.value
  if (!s || !r || exporting.value) return
  exporting.value = true
  try {
    // 存模型网格（长边 ≤1024）：烘图时按原图尺寸平滑放大，蒙版占的本机存储小一个数量级
    emit('apply', await s.toMaskBlob(r, POINT_SEGMENT_INPUT_SIDE))
  } catch (err) {
    fail(err)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" transform-origin="center" :mask-closable="false">
    <section
      :class="large ? 'w-[min(1280px,calc(100vw-32px))]' : 'w-[min(760px,calc(100vw-32px))]'"
      class="max-h-[calc(100vh-48px)] overflow-y-auto box-border p-18px rounded-18px bg-white shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32)] flex flex-col gap-12px"
      role="dialog"
      aria-label="点选调色选区"
    >
      <header class="flex flex-wrap items-center gap-8px">
        <b class="flex-1 min-w-120px text-14px font-600 leading-20px text-ink">点选调色选区</b>
        <button type="button" class="sx-btn" @click="show = false">取消</button>
        <button
          type="button"
          class="sx-btn-primary"
          :disabled="!result || exporting || decoding || embedding"
          @click="apply"
        >
          完成
        </button>
      </header>

      <div class="flex flex-wrap items-center gap-8px">
        <button
          type="button"
          class="sx-btn"
          :class="{ '!border-#d9a3a0 !text-#b4433e !from-#fff7f6 !to-#fbeceb': exclude }"
          :aria-pressed="exclude"
          title="打开后单击 = 排除（也可 Alt / Shift + 单击，触屏长按）"
          @click="exclude = !exclude"
        >
          <span aria-hidden="true" class="text-15px font-700">{{ exclude ? '−' : '+' }}</span>
          {{ exclude ? '排除中' : '排除' }}
        </button>
        <button type="button" class="sx-btn" :disabled="!actions.length" @click="undo">撤销上一点</button>
        <button type="button" class="sx-btn" :disabled="!actions.length" @click="clearAll">清空</button>
        <span class="flex-1 min-w-0 text-12px leading-18px text-muted" role="status" aria-live="polite">
          {{ status }}
        </span>
      </div>

      <div
        v-if="!modelReady && !error"
        class="h-4px rounded-2px bg-#efe9f3 overflow-hidden"
        role="progressbar"
        aria-label="点选加载进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progress"
      >
        <div class="ps-bar h-full bg-#875f9a" :style="{ width: `${Math.max(4, progress)}%` }" />
      </div>

      <p
        v-if="error"
        class="m-0 flex items-center gap-8px px-12px py-8px rounded-12px bg-#fbeceb text-12px leading-18px text-#b4433e"
        role="alert"
      >
        <span class="flex-1">{{ error }}</span>
        <button v-if="retryable" type="button" class="sx-btn" @click="retry">重试</button>
      </p>

      <div
        class="flex justify-center rounded-15px bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-8px"
      >
        <div
          ref="stageEl"
          class="ps-stage relative inline-block max-w-full select-none"
          :class="{ 'is-busy': embedding }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @contextmenu.prevent
        >
          <img
            ref="imgEl"
            :src="src"
            :crossorigin="corsAttr(src)"
            alt="点选调色选区"
            draggable="false"
            class="block max-w-full pointer-events-none"
            :class="large ? 'max-h-[calc(100vh-260px)]' : 'max-h-[min(62vh,640px)]'"
            @load="onImgLoad"
            @error="onImgError"
          />
          <canvas ref="overlay" class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" />
          <div
            v-if="box && !dragBox"
            class="absolute border-2 border-dashed border-#875f9a rounded-4px pointer-events-none"
            :style="boxStyle(box)"
            aria-hidden="true"
          />
          <div
            v-if="dragBox"
            class="absolute border-2 border-dashed border-#875f9a bg-#875f9a/10 rounded-4px pointer-events-none"
            :style="boxStyle(dragBox)"
            aria-hidden="true"
          />
          <span
            v-for="(p, i) in points"
            :key="i"
            class="ps-dot"
            :class="p.label ? 'is-pos' : 'is-neg'"
            :style="{ left: pct(p.x, natural.w), top: pct(p.y, natural.h) }"
            aria-hidden="true"
          >
            {{ p.label ? '+' : '−' }}
          </span>
        </div>
      </div>
      <p class="m-0 text-11px leading-16px text-muted">
        选区在本机识别，图片不会上传。完成后可在参数台里反选、调边缘柔化。
      </p>
    </section>
  </n-modal>
</template>

<style scoped lang="less">
.ps-stage {
  cursor: crosshair;
  touch-action: none;
  -webkit-touch-callout: none;
}
.ps-stage.is-busy {
  cursor: progress;
}
.ps-dot {
  position: absolute;
  display: grid;
  width: 18px;
  height: 18px;
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
.ps-bar {
  transition: width 0.2s ease;
}
@media (prefers-reduced-motion: reduce) {
  .ps-bar {
    transition: none;
  }
}
</style>
