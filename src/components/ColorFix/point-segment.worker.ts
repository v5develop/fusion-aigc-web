/**
 * 点选分割 Worker：onnxruntime-web 跑 SlimSAM（Segment Anything 蒸馏版，Xenova/slimsam-77-uniform ONNX 导出）。
 * 主线程协议见 pointSegment.ts；图片像素只在本机内存里流转，不发往任何服务。
 *
 * <ul>
 *   <li>init：拉模型（Cache Storage 缓存，按来源列表依次尝试）→ 建会话。编码器 WebGPU（需 shader-f16，用 fp16 权重）优先，
 *       起不来退 WASM（int8 量化权重）；解码器一律 WASM（每次点击都跑，小模型留在 CPU 免 GPU 回读）。</li>
 *   <li>embed：收主线程缩好的 RGBA（长边 ≤1024），按 SamProcessor 口径归一化 + 右下补零到 1024²，跑一次编码器，嵌入留在 Worker。</li>
 *   <li>decode：点（缩放后坐标，label 1 = 加 / 0 = 减）+ 可选框（没有正点也没有框 → 不出蒙版）→ 单点取 3 张候选里 IoU 最高、多点取第 0 张 → 在缩放图网格上双线性采 256² logits，
 *       sigmoid 成软蒙版（0–255），框外清零。</li>
 * </ul>
 */
import * as ort from 'onnxruntime-web/webgpu'

const SIZE = 1024
const LOW = 256
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const
const CACHE_NAME = 'fusion-point-segment-v1'

type InMsg =
  | { id: number; type: 'init'; sources: string[]; files: { gpu: string; cpu: string; decoder: string } }
  | { id: number; type: 'embed'; pixels: ArrayBuffer; width: number; height: number }
  | {
      id: number
      type: 'decode'
      points: { x: number; y: number; label: 0 | 1 }[]
      box?: { x0: number; y0: number; x1: number; y1: number } | null
    }

interface WorkerScope {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<InMsg>) => void) | null
}
const scope = self as unknown as WorkerScope

let encoder: ort.InferenceSession | null = null
let decoder: ort.InferenceSession | null = null
let device: 'webgpu' | 'wasm' = 'wasm'
let embeds: { emb: ort.Tensor; pos: ort.Tensor; width: number; height: number } | null = null
let cpuEncoderFile = ''
let sourcesCache: string[] = []

class SegError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'runtime',
  ) {
    super(message)
  }
}

function post(msg: unknown, transfer?: Transferable[]) {
  scope.postMessage(msg, transfer)
}

// ---------------- 模型下载（Cache Storage + 进度） ----------------

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

/** 拉一个模型文件：先查 Cache Storage，再按来源依次下载；SPA 兜底回的 HTML 不算成功 */
async function fetchModel(file: string, onBytes: (n: number, total: number) => void): Promise<Uint8Array> {
  const cache = await openCache()
  for (const base of sourcesCache) {
    const url = base + file
    try {
      const hit = await cache?.match(url)
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer())
        onBytes(buf.byteLength, buf.byteLength)
        return buf
      }
    } catch {
      /* 缓存读不了就下载 */
    }
  }
  let lastErr: unknown = null
  for (const base of sourcesCache) {
    const url = base + file
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' })
      const type = resp.headers.get('content-type') || ''
      if (!resp.ok || type.includes('text/html')) throw new Error(`HTTP ${resp.status}`)
      const total = Number(resp.headers.get('content-length')) || 0
      let buf: Uint8Array
      if (resp.body && total > 0) {
        buf = new Uint8Array(total)
        const reader = resp.body.getReader()
        let off = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (off + value.byteLength > buf.byteLength) {
            // content-length 不准（压缩传输）：扩容
            const grown = new Uint8Array(Math.max(buf.byteLength * 2, off + value.byteLength))
            grown.set(buf.subarray(0, off))
            buf = grown
          }
          buf.set(value, off)
          off += value.byteLength
          onBytes(off, total)
        }
        buf = buf.subarray(0, off)
      } else {
        buf = new Uint8Array(await resp.arrayBuffer())
        onBytes(buf.byteLength, buf.byteLength)
      }
      if (buf.byteLength < 1024) throw new Error('模型文件不完整')
      try {
        await cache?.put(
          url,
          new Response(buf.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } }),
        )
      } catch {
        /* 配额满 / 隐私模式：下次重新下载 */
      }
      return buf
    } catch (err) {
      lastErr = err
    }
  }
  throw new SegError(`模型下载失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, 'network')
}

// ---------------- 会话 ----------------

interface GpuLike {
  requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null>
}

async function hasF16Gpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu
    if (!gpu) return false
    const adapter = await gpu.requestAdapter()
    return !!adapter && adapter.features.has('shader-f16')
  } catch {
    return false
  }
}

async function createWasm(bytes: Uint8Array): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  } catch (err) {
    throw new SegError(`推理引擎初始化失败：${err instanceof Error ? err.message : String(err)}`, 'runtime')
  }
}

async function init(msg: Extract<InMsg, { type: 'init' }>) {
  sourcesCache = msg.sources
  cpuEncoderFile = msg.files.cpu
  ort.env.wasm.proxy = false
  ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1
  ort.env.logLevel = 'error'

  const useGpu = await hasF16Gpu()
  const files = [useGpu ? msg.files.gpu : msg.files.cpu, msg.files.decoder]
  const loaded = new Map<string, number>()
  const totals = new Map<string, number>()
  const report = () => {
    let l = 0
    let t = 0
    for (const f of files) {
      l += loaded.get(f) ?? 0
      t += totals.get(f) ?? 0
    }
    post({ type: 'progress', loaded: l, total: t })
  }
  const grab = (f: string) =>
    fetchModel(f, (n, total) => {
      loaded.set(f, n)
      totals.set(f, total)
      report()
    })

  const [encBytes, decBytes] = (await Promise.all(files.map(grab))) as [Uint8Array, Uint8Array]
  decoder = await createWasm(decBytes)
  if (useGpu) {
    try {
      encoder = await ort.InferenceSession.create(encBytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      })
      device = 'webgpu'
    } catch {
      encoder = null
    }
  }
  if (!encoder) {
    device = 'wasm'
    encoder = await createWasm(useGpu ? await grab(cpuEncoderFile) : encBytes)
  }
  return { device }
}

// ---------------- 编码 ----------------

function toPixelValues(pixels: Uint8ClampedArray, w: number, h: number): ort.Tensor {
  const plane = SIZE * SIZE
  const data = new Float32Array(3 * plane) // 补零区 = 0（SamProcessor 在归一化之后补零）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = y * SIZE + x
      data[o] = (pixels[i]! / 255 - MEAN[0]) / STD[0]
      data[plane + o] = (pixels[i + 1]! / 255 - MEAN[1]) / STD[1]
      data[2 * plane + o] = (pixels[i + 2]! / 255 - MEAN[2]) / STD[2]
    }
  }
  return new ort.Tensor('float32', data, [1, 3, SIZE, SIZE])
}

async function runEncoder(pixelValues: ort.Tensor) {
  if (!encoder) throw new SegError('模型尚未加载', 'runtime')
  const out = await encoder.run({ pixel_values: pixelValues })
  return { emb: out.image_embeddings!, pos: out.image_positional_embeddings! }
}

async function embed(msg: Extract<InMsg, { type: 'embed' }>) {
  disposeEmbeds()
  const pv = toPixelValues(new Uint8ClampedArray(msg.pixels), msg.width, msg.height)
  let res: { emb: ort.Tensor; pos: ort.Tensor }
  try {
    res = await runEncoder(pv)
  } catch (err) {
    if (device !== 'webgpu') throw err
    // WebGPU 跑挂（驱动 / 显存）：换 WASM 再来一次
    await encoder?.release().catch(() => {})
    encoder = await createWasm(await fetchModel(cpuEncoderFile, () => {}))
    device = 'wasm'
    res = await runEncoder(pv)
  }
  embeds = { ...res, width: msg.width, height: msg.height }
  return { device }
}

function disposeEmbeds() {
  embeds?.emb.dispose?.()
  embeds?.pos.dispose?.()
  embeds = null
}

// ---------------- 解码 ----------------

async function decode(msg: Extract<InMsg, { type: 'decode' }>) {
  if (!decoder || !embeds) throw new SegError('图片还没有识别', 'runtime')
  const { width: w, height: h } = embeds
  const hasPositive = msg.points.some((p) => p.label === 1)
  // 没有正点也没有框（只点了排除）：没有「要保留的物体」，不出蒙版（UI 提示先点选要保留的物体）
  if (!hasPositive && !msg.box) return { mask: null, width: w, height: h }
  // 有框但没有正点：框心当正点，结果裁到框内（导出的解码器不吃框提示）
  const pts = hasPositive
    ? msg.points
    : [...msg.points, { x: (msg.box!.x0 + msg.box!.x1) / 2, y: (msg.box!.y0 + msg.box!.y1) / 2, label: 1 as const }]
  const coords = new Float32Array(pts.length * 2)
  const labels = new BigInt64Array(pts.length)
  pts.forEach((p, i) => {
    coords[i * 2] = p.x
    coords[i * 2 + 1] = p.y
    labels[i] = BigInt(p.label)
  })
  const out = await decoder.run({
    input_points: new ort.Tensor('float32', coords, [1, 1, pts.length, 2]),
    input_labels: new ort.Tensor('int64', labels, [1, 1, pts.length]),
    image_embeddings: embeds.emb,
    image_positional_embeddings: embeds.pos,
  })
  const scores = out.iou_scores!.data as Float32Array
  const masks = out.pred_masks!.data as Float32Array
  // 单点有歧义（部件 / 整体 / 更大范围），三张候选取 IoU 最高；多点时提示已经消歧，按 SAM 口径用第 0 张（单蒙版输出）
  let best = 0
  if (pts.length === 1) for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i
  const logits = masks.subarray(best * LOW * LOW, (best + 1) * LOW * LOW)

  // 256² logits 覆盖的是补零后的 1024²：缩放图像素 (x, y) 的采样点 = (x + 0.5) / 4 - 0.5（align_corners=false）
  const mask = new Uint8Array(w * h)
  const scale = LOW / SIZE
  const box = msg.box
  for (let y = 0; y < h; y++) {
    const v = Math.min(LOW - 1, Math.max(0, (y + 0.5) * scale - 0.5))
    const y0 = Math.floor(v)
    const y1 = Math.min(LOW - 1, y0 + 1)
    const fy = v - y0
    const inY = !box || (y >= box.y0 && y <= box.y1)
    for (let x = 0; x < w; x++) {
      if (!inY || (box && (x < box.x0 || x > box.x1))) continue
      const u = Math.min(LOW - 1, Math.max(0, (x + 0.5) * scale - 0.5))
      const x0 = Math.floor(u)
      const x1 = Math.min(LOW - 1, x0 + 1)
      const fx = u - x0
      const top = logits[y0 * LOW + x0]! * (1 - fx) + logits[y0 * LOW + x1]! * fx
      const bottom = logits[y1 * LOW + x0]! * (1 - fx) + logits[y1 * LOW + x1]! * fx
      const l = top * (1 - fy) + bottom * fy
      mask[y * w + x] = Math.round(255 / (1 + Math.exp(-l)))
    }
  }
  for (const t of Object.values(out)) t.dispose?.()
  return { mask: mask.buffer, width: w, height: h, score: scores[best] }
}

scope.onmessage = async (ev) => {
  const msg = ev.data
  try {
    if (msg.type === 'init') post({ id: msg.id, ok: true, result: await init(msg) })
    else if (msg.type === 'embed') post({ id: msg.id, ok: true, result: await embed(msg) })
    else if (msg.type === 'decode') {
      const result = await decode(msg)
      post({ id: msg.id, ok: true, result }, result.mask ? [result.mask] : [])
    }
  } catch (err) {
    post({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      kind: err instanceof SegError ? err.kind : 'runtime',
    })
  }
}
