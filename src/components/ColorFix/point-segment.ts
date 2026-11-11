/**
 * 点选分割（本机推理，图片不出设备）的主线程封装。只由 PointSelect.vue 动态 import——选「点选」之前什么都不加载。
 *
 * <p>模型：SlimSAM-77（Segment Anything 蒸馏，Apache-2.0，Xenova/slimsam-77-uniform 的 ONNX 导出），
 * onnxruntime-web 在 Web Worker 里跑（pointSegment.worker.ts）：编码器 WebGPU（fp16）优先、WASM（int8）兜底；
 * 解码器 WASM。模型来源按顺序尝试：
 * <ol>
 *   <li>`VITE_POINT_SEGMENT_MODEL_BASE`（可选，运维把三个 .onnx 传到自家 OSS / CDN 后填目录地址，需允许跨域读取）；</li>
 *   <li>站点自带 `public/models/slimsam-77-uniform/`（随前端一起发布，同源）；</li>
 *   <li>Hugging Face 固定修订版（境外兜底）。</li>
 * </ol>
 * 下载过的文件进浏览器 Cache Storage（`fusion-point-segment-v1`），第二次打开不再下载。
 *
 * <p>识别引擎（onnxruntime-web 的 WASM 运行时 ort-wasm-simd-threaded.asyncify.wasm，约 28.7MB，比模型还大）也由我们
 * 自己下载：带字节进度、进同一个 Cache Storage，再以 `ort.env.wasm.wasmBinary` 交给 onnxruntime（不再让它自己静默拉）。
 * 来源：`VITE_POINT_SEGMENT_WASM_BASE`（可选，CDN 目录，地址带 `?v=<构建哈希>` 防旧缓存）→ Vite 打包出的同一个资源地址。
 * 参数台打开时空闲预取（{@link prefetchPointSegment}，由 point-support 的 schedulePointSegmentPrefetch 触发），
 * 用户真点「点选」时多半已在缓存里；预取进行中打开点选会接上同一份下载与进度，不重复下载。
 *
 * <p>流程：{@link createPointSegmenter} 立刻起 Worker 拉模型（`ready`）；首次点击时 {@link PointSegmenter.prepare}
 * 读图像素（CORS，与烘图同一要求）、缩到长边 1024、编码一次（同一张图只编一次）；之后每次点击
 * {@link PointSegmenter.decode} 只跑轻量解码器（几十毫秒）。{@link PointSegmenter.toMaskBlob} 导出与原图同尺寸
 * （长边 ≤4096）的黑底白选区 PNG（软边），直接喂给 utils/colorfix 的蒙版管线（反选 / 柔化照常）。
 * 关闭弹窗时 {@link PointSegmenter.dispose} 终止 Worker，WASM 堆与 GPU 显存随之释放。
 */
import { COLORFIX_EXPORT_MAX_SIDE } from '@/utils/colorfix.ts'
// 与 onnxruntime-web 包内 new URL('ort-wasm-simd-threaded.asyncify.wasm', import.meta.url) 是同一个文件，
// Vite 按内容哈希出同一个资源地址（webgpu 包在 1.31 用的就是 asyncify 这一份）
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import {
  fetchPointSegmentAsset,
  hasF16Gpu,
  isWasmBinary,
  openPointSegmentCache,
} from './point-segment-fetch.ts'

/** 模型修订版（Hugging Face 兜底源固定到这一版，与 public/models 里的文件一致） */
const HF_REVISION = '5850ab45f587c112167512ffef949107115e26a0'
const MODEL_FILES = {
  gpu: 'vision_encoder_fp16.onnx',
  cpu: 'vision_encoder_quantized.onnx',
  decoder: 'prompt_encoder_mask_decoder_quantized.onnx',
}
/** 固定修订版的文件大小（进度条在响应没有可信长度时用） */
const MODEL_SIZES: Record<string, number> = {
  'vision_encoder_fp16.onnx': 12_170_657,
  'vision_encoder_quantized.onnx': 8_882_165,
  'prompt_encoder_mask_decoder_quantized.onnx': 4_903_810,
}
const WASM_FILE = 'ort-wasm-simd-threaded.asyncify.wasm'
/** onnxruntime-web 1.31.1 的 asyncify wasm 大小；升级后不准只影响进度估计（以实际读到的为准） */
const WASM_SIZE_HINT = 28_747_738
/** SAM 输入长边 */
export const POINT_SEGMENT_INPUT_SIDE = 1024

export type PointSegmentErrorKind = 'cors' | 'network' | 'runtime'

export class PointSegmentError extends Error {
  constructor(
    message: string,
    readonly kind: PointSegmentErrorKind,
  ) {
    super(message)
  }
}

/** 点：原图像素坐标；label 1 = 加入选区，0 = 排除 */
export interface PointPrompt {
  x: number
  y: number
  label: 0 | 1
}

/** 框：原图像素坐标 */
export interface PointBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PointMaskResult {
  /** 软蒙版 0–255，网格 = 缩放后的图（width × height） */
  mask: Uint8Array
  width: number
  height: number
  /** 原图尺寸 */
  srcWidth: number
  srcHeight: number
}

export interface PointSegmentBytes {
  loaded: number
  total: number
}

/** 下载进度：识别引擎（WASM 运行时）与模型分开计，单位字节 */
export interface PointSegmentProgress {
  engine: PointSegmentBytes
  model: PointSegmentBytes
}

export interface PointSegmenter {
  /** 模型加载完成（device = 编码器实际用的后端） */
  ready: Promise<{ device: 'webgpu' | 'wasm' }>
  /** 读图 + 编码（同一张图只做一次） */
  prepare(src: string): Promise<{ width: number; height: number }>
  /** 按当前点 / 框出蒙版；没有任何提示返回 null */
  decode(points: PointPrompt[], box?: PointBox | null): Promise<PointMaskResult | null>
  /** 导出原图尺寸（长边 ≤ maxSide）的黑底白选区 PNG */
  toMaskBlob(result: PointMaskResult, maxSide?: number): Promise<Blob>
  dispose(): void
}

function dir(u: string) {
  return u.endsWith('/') ? u : `${u}/`
}

/** Vite 资源文件名里的内容哈希（ort-wasm-simd-threaded.asyncify-AbC123.wasm → AbC123）；dev 下没有 */
function wasmBuildTag(): string {
  const m = /asyncify[-.]([\w-]{6,})\.wasm$/.exec(ortWasmUrl.split('?')[0] ?? '')
  return m?.[1] ?? ''
}

/** 识别引擎的候选地址：CDN（可选）→ 打包出的资源 */
function wasmSources(): string[] {
  const list: string[] = []
  const custom = import.meta.env.VITE_POINT_SEGMENT_WASM_BASE?.trim()
  if (custom) {
    const tag = wasmBuildTag()
    list.push(`${dir(new URL(custom, location.href).href)}${WASM_FILE}${tag ? `?v=${tag}` : ''}`)
  }
  list.push(new URL(ortWasmUrl, location.href).href)
  return list
}

function modelSources(): string[] {
  const list: string[] = []
  const custom = import.meta.env.VITE_POINT_SEGMENT_MODEL_BASE?.trim()
  if (custom) list.push(dir(new URL(custom, location.href).href))
  list.push(new URL(`${import.meta.env.BASE_URL || '/'}models/slimsam-77-uniform/`, location.href).href)
  list.push(`https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${HF_REVISION}/onnx/`)
  return list
}

/** 一个要下载的资源 */
export interface PointSegmentAsset {
  group: keyof PointSegmentProgress
  candidates: string[]
  sizeHint: number
  wasm?: boolean
}

/** 本机要用的资源清单：编码器按 WebGPU(fp16) / WASM(int8) 二选一 */
export interface PointSegmentPlan {
  useGpu: boolean
  wasm: PointSegmentAsset
  encoder: PointSegmentAsset
  decoder: PointSegmentAsset
  /** WebGPU 起不来时的 CPU 编码器（只在用 GPU 时才可能用到，不预取） */
  cpuEncoder: PointSegmentAsset
}

let planTask: Promise<PointSegmentPlan> | null = null
function pointSegmentPlan(): Promise<PointSegmentPlan> {
  if (planTask) return planTask
  planTask = (async () => {
    const useGpu = await hasF16Gpu()
    const sources = modelSources()
    const model = (file: string): PointSegmentAsset => ({
      group: 'model',
      candidates: sources.map((base) => base + file),
      sizeHint: MODEL_SIZES[file] ?? 0,
    })
    return {
      useGpu,
      wasm: { group: 'engine', candidates: wasmSources(), sizeHint: WASM_SIZE_HINT, wasm: true },
      encoder: model(useGpu ? MODEL_FILES.gpu : MODEL_FILES.cpu),
      decoder: model(MODEL_FILES.decoder),
      cpuEncoder: model(MODEL_FILES.cpu),
    }
  })()
  return planTask
}

/** 进度汇总器：每个资源各报各的 loaded / total，按组相加 */
function progressAggregator(assets: PointSegmentAsset[], emit: (p: PointSegmentProgress) => void) {
  const state = assets.map((a) => ({ group: a.group, loaded: 0, total: a.sizeHint }))
  const report = () => {
    const p: PointSegmentProgress = { engine: { loaded: 0, total: 0 }, model: { loaded: 0, total: 0 } }
    for (const s of state) {
      p[s.group].loaded += s.loaded
      p[s.group].total += Math.max(s.total, s.loaded)
    }
    emit(p)
  }
  return {
    on: (i: number) => (loaded: number, total: number) => {
      state[i]!.loaded = loaded
      if (total > 0) state[i]!.total = total
      report()
    },
    report,
  }
}

// ---------------- 空闲预取（参数台打开时；进行中打开点选会接上同一份下载） ----------------

let prefetchTask: Promise<void> | null = null
let lastProgress: PointSegmentProgress | null = null
const prefetchListeners = new Set<(p: PointSegmentProgress) => void>()

/**
 * 把引擎 + 模型拉进 Cache Storage（已在缓存的只核对不读出）。Cache Storage 不可用（隐私模式 / 非安全上下文）时什么都不做——
 * 那种情况下预取下来也存不住，留给 Worker 用时再下载。失败不抛（下次再预取 / 用时再下载）。
 * onProgress：这次调用方想看进度（点选弹窗接上预取时）。
 */
export function prefetchPointSegment(onProgress?: (p: PointSegmentProgress) => void): Promise<void> {
  if (onProgress) {
    prefetchListeners.add(onProgress)
    if (lastProgress) onProgress(lastProgress)
  }
  if (!prefetchTask) {
    const task = (async () => {
      if (!(await openPointSegmentCache())) return
      const plan = await pointSegmentPlan()
      const assets = [plan.wasm, plan.encoder, plan.decoder]
      const agg = progressAggregator(assets, (p) => {
        lastProgress = p
        for (const fn of prefetchListeners) fn(p)
      })
      agg.report()
      await Promise.all(
        assets.map((a, i) =>
          fetchPointSegmentAsset(a.candidates, agg.on(i), {
            sizeHint: a.sizeHint,
            validate: a.wasm ? isWasmBinary : undefined,
            read: false,
          }),
        ),
      )
    })()
    prefetchTask = task
    task.catch(() => {
      // 失败（断网等）：允许下次重新预取
      if (prefetchTask === task) prefetchTask = null
    })
  }
  const current = prefetchTask
  return current
    .catch(() => {})
    .finally(() => {
      if (onProgress) prefetchListeners.delete(onProgress)
    })
}

function bustCache(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src
  try {
    const u = new URL(src, location.href)
    u.searchParams.set('_cf', Date.now().toString(36))
    return u.toString()
  } catch {
    return src
  }
}

function loadOnce(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 跨域读像素：缓存里命中不带 CORS 头的那份时带防缓存参数再拉一次（同 utils/colorfix loadImage） */
async function loadReadableImage(src: string): Promise<HTMLImageElement> {
  try {
    return await loadOnce(src)
  } catch {
    const busted = bustCache(src)
    if (busted === src) throw new PointSegmentError('图片不允许读取像素', 'cors')
    try {
      return await loadOnce(busted)
    } catch {
      throw new PointSegmentError('图片不允许读取像素', 'cors')
    }
  }
}

interface Pending {
  resolve(v: unknown): void
  reject(e: unknown): void
}

export function createPointSegmenter(opts: { onProgress?: (p: PointSegmentProgress) => void } = {}): PointSegmenter {
  const worker = new Worker(new URL('./point-segment.worker.ts', import.meta.url), {
    type: 'module',
    name: 'point-segment',
  })
  const pending = new Map<number, Pending>()
  let seq = 0
  let disposed = false

  worker.onmessage = (ev: MessageEvent) => {
    const d = ev.data as {
      id?: number
      type?: string
      ok?: boolean
      result?: unknown
      error?: string
      kind?: PointSegmentErrorKind
      progress?: PointSegmentProgress
    }
    if (d.type === 'progress') {
      if (d.progress) opts.onProgress?.(d.progress)
      return
    }
    const p = d.id === undefined ? undefined : pending.get(d.id)
    if (!p) return
    pending.delete(d.id!)
    if (d.ok) p.resolve(d.result)
    else p.reject(new PointSegmentError(d.error || '点选失败', d.kind ?? 'runtime'))
  }
  worker.onerror = (ev) => {
    ev.preventDefault?.()
    const err = new PointSegmentError(ev.message || '点选组件加载失败', 'runtime')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }

  function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    if (disposed) return Promise.reject(new PointSegmentError('已关闭', 'runtime'))
    const id = ++seq
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ ...msg, id }, transfer)
    })
  }

  // 先接上（或发起）预取：资源进了缓存，Worker 读缓存即可；Cache Storage 不可用时预取是空操作，Worker 自己下载并报进度
  const ready = (async () => {
    // 关闭后预取可能还在跑：别再往已卸载的弹窗报进度
    const onProgress = opts.onProgress
    await prefetchPointSegment(
      onProgress &&
        ((p) => {
          if (!disposed) onProgress(p)
        }),
    )
    const plan = await pointSegmentPlan()
    return call<{ device: 'webgpu' | 'wasm' }>({
      type: 'init',
      useGpu: plan.useGpu,
      wasm: plan.wasm,
      encoder: plan.encoder,
      decoder: plan.decoder,
      cpuEncoder: plan.cpuEncoder,
    })
  })()
  ready.catch(() => {}) // 由调用方 await 处理；这里只防「未处理的拒绝」

  let current: {
    src: string
    task: Promise<{ width: number; height: number; srcWidth: number; srcHeight: number }>
  } | null = null

  function prepareInternal(src: string) {
    if (current?.src === src) return current.task
    const task = (async () => {
      const img = await loadReadableImage(src)
      const srcWidth = img.naturalWidth
      const srcHeight = img.naturalHeight
      if (!srcWidth || !srcHeight) throw new PointSegmentError('图片尺寸无效', 'runtime')
      const scale = POINT_SEGMENT_INPUT_SIDE / Math.max(srcWidth, srcHeight)
      const width = Math.max(1, Math.round(srcWidth * scale))
      const height = Math.max(1, Math.round(srcHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new PointSegmentError('画布不可用', 'runtime')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, width, height)
      let data: ImageData
      try {
        data = ctx.getImageData(0, 0, width, height)
      } catch {
        throw new PointSegmentError('图片不允许读取像素', 'cors')
      } finally {
        canvas.width = canvas.height = 0
      }
      await ready
      await call({ type: 'embed', pixels: data.data.buffer, width, height }, [data.data.buffer])
      return { width, height, srcWidth, srcHeight }
    })()
    current = { src, task }
    task.catch(() => {
      if (current?.task === task) current = null
    })
    return task
  }

  async function prepare(src: string) {
    const r = await prepareInternal(src)
    return { width: r.width, height: r.height }
  }

  async function decode(points: PointPrompt[], box?: PointBox | null): Promise<PointMaskResult | null> {
    if (!current) throw new PointSegmentError('图片还没有识别', 'runtime')
    const info = await current.task
    const sx = info.width / info.srcWidth
    const sy = info.height / info.srcHeight
    const res = await call<{ mask: ArrayBuffer | null; width: number; height: number }>({
      type: 'decode',
      points: points.map((p) => ({ x: p.x * sx, y: p.y * sy, label: p.label })),
      box: box ? { x0: box.x0 * sx, y0: box.y0 * sy, x1: box.x1 * sx, y1: box.y1 * sy } : null,
    })
    if (!res.mask) return null
    return {
      mask: new Uint8Array(res.mask),
      width: res.width,
      height: res.height,
      srcWidth: info.srcWidth,
      srcHeight: info.srcHeight,
    }
  }

  async function toMaskBlob(result: PointMaskResult, maxSide = COLORFIX_EXPORT_MAX_SIDE): Promise<Blob> {
    const small = document.createElement('canvas')
    small.width = result.width
    small.height = result.height
    const sctx = small.getContext('2d')
    if (!sctx) throw new PointSegmentError('画布不可用', 'runtime')
    const img = sctx.createImageData(result.width, result.height)
    for (let i = 0; i < result.mask.length; i++) {
      const v = result.mask[i]!
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    sctx.putImageData(img, 0, 0)
    const scale = Math.min(1, maxSide / Math.max(result.srcWidth, result.srcHeight))
    const big = document.createElement('canvas')
    big.width = Math.max(1, Math.round(result.srcWidth * scale))
    big.height = Math.max(1, Math.round(result.srcHeight * scale))
    const bctx = big.getContext('2d')
    if (!bctx) throw new PointSegmentError('画布不可用', 'runtime')
    bctx.imageSmoothingEnabled = true
    bctx.imageSmoothingQuality = 'high'
    bctx.drawImage(small, 0, 0, big.width, big.height)
    const blob = await new Promise<Blob | null>((resolve) => big.toBlob(resolve, 'image/png'))
    small.width = small.height = big.width = big.height = 0
    if (!blob) throw new PointSegmentError('选区导出失败', 'runtime')
    return blob
  }

  function dispose() {
    if (disposed) return
    disposed = true
    worker.terminate()
    const err = new PointSegmentError('已关闭', 'runtime')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    current = null
  }

  return { ready, prepare, decode, toMaskBlob, dispose }
}
