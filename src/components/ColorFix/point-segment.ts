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
 * <p>流程：{@link createPointSegmenter} 立刻起 Worker 拉模型（`ready`）；首次点击时 {@link PointSegmenter.prepare}
 * 读图像素（CORS，与烘图同一要求）、缩到长边 1024、编码一次（同一张图只编一次）；之后每次点击
 * {@link PointSegmenter.decode} 只跑轻量解码器（几十毫秒）。{@link PointSegmenter.toMaskBlob} 导出与原图同尺寸
 * （长边 ≤4096）的黑底白选区 PNG（软边），直接喂给 utils/colorfix 的蒙版管线（反选 / 柔化照常）。
 * 关闭弹窗时 {@link PointSegmenter.dispose} 终止 Worker，WASM 堆与 GPU 显存随之释放。
 */
import { COLORFIX_EXPORT_MAX_SIDE } from '@/utils/colorfix.ts'

/** 模型修订版（Hugging Face 兜底源固定到这一版，与 public/models 里的文件一致） */
const HF_REVISION = '5850ab45f587c112167512ffef949107115e26a0'
const MODEL_FILES = {
  gpu: 'vision_encoder_fp16.onnx',
  cpu: 'vision_encoder_quantized.onnx',
  decoder: 'prompt_encoder_mask_decoder_quantized.onnx',
}
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

export interface PointSegmentProgress {
  loaded: number
  total: number
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

function modelSources(): string[] {
  const dir = (u: string) => (u.endsWith('/') ? u : `${u}/`)
  const list: string[] = []
  const custom = import.meta.env.VITE_POINT_SEGMENT_MODEL_BASE?.trim()
  if (custom) list.push(dir(new URL(custom, location.href).href))
  list.push(new URL(`${import.meta.env.BASE_URL || '/'}models/slimsam-77-uniform/`, location.href).href)
  list.push(`https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${HF_REVISION}/onnx/`)
  return list
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
      loaded?: number
      total?: number
    }
    if (d.type === 'progress') {
      opts.onProgress?.({ loaded: d.loaded ?? 0, total: d.total ?? 0 })
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

  const ready = call<{ device: 'webgpu' | 'wasm' }>({ type: 'init', sources: modelSources(), files: MODEL_FILES })
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
