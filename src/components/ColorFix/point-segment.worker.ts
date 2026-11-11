/**
 * 点选分割 Worker：onnxruntime-web 跑 SlimSAM（Segment Anything 蒸馏版，Xenova/slimsam-77-uniform ONNX 导出）。
 * 主线程协议见 pointSegment.ts；图片像素只在本机内存里流转，不发往任何服务。
 *
 * <ul>
 *   <li>init：拉识别引擎（onnxruntime 的 WASM 运行时，交给 ort.env.wasm.wasmBinary）与模型（都走 Cache Storage，
 *       按候选地址依次尝试；主线程多半已预取进缓存）→ 建会话。编码器 WebGPU（需 shader-f16，用 fp16 权重）优先，
 *       起不来退 WASM（int8 量化权重）；解码器一律 WASM（每次点击都跑，小模型留在 CPU 免 GPU 回读）。</li>
 *   <li>embed：收主线程缩好的 RGBA（长边 ≤1024），按 SamProcessor 口径归一化 + 右下补零到 1024²，跑一次编码器，嵌入留在 Worker。</li>
 *   <li>decode：点（缩放后坐标，label 1 = 加 / 0 = 减）+ 可选框（没有正点也没有框 → 不出蒙版）→ 3 张候选取「与提示点最一致、再看 IoU」的一张 → 在缩放图网格上双线性采 256² logits，
 *       sigmoid 成软蒙版（0–255），框外清零。</li>
 * </ul>
 */
import * as ort from 'onnxruntime-web/webgpu'
import { fetchPointSegmentAsset, isWasmBinary } from './point-segment-fetch.ts'

const SIZE = 1024
const LOW = 256
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/** 同 point-segment.ts 的 PointSegmentAsset */
interface Asset {
  group: 'engine' | 'model'
  candidates: string[]
  sizeHint: number
  wasm?: boolean
}

type InMsg =
  | {
      id: number
      type: 'init'
      useGpu: boolean
      wasm: Asset
      encoder: Asset
      decoder: Asset
      cpuEncoder: Asset
    }
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
let cpuEncoderAsset: Asset | null = null

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

// ---------------- 下载（Cache Storage + 进度，见 point-segment-fetch.ts） ----------------

async function grabAsset(asset: Asset, onBytes: (n: number, total: number) => void): Promise<Uint8Array> {
  try {
    const bytes = await fetchPointSegmentAsset(asset.candidates, onBytes, {
      sizeHint: asset.sizeHint,
      validate: asset.wasm ? isWasmBinary : undefined,
    })
    if (!bytes) throw new Error('empty')
    return bytes
  } catch (err) {
    const what = asset.wasm ? '识别引擎' : '模型'
    throw new SegError(`${what}下载失败：${err instanceof Error ? err.message : String(err)}`, 'network')
  }
}

// ---------------- 会话 ----------------

async function createWasm(bytes: Uint8Array): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  } catch (err) {
    throw new SegError(`推理引擎初始化失败：${err instanceof Error ? err.message : String(err)}`, 'runtime')
  }
}

async function init(msg: Extract<InMsg, { type: 'init' }>) {
  cpuEncoderAsset = msg.cpuEncoder
  ort.env.wasm.proxy = false
  ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1
  ort.env.logLevel = 'error'

  const assets = [msg.wasm, msg.encoder, msg.decoder]
  const state = assets.map((a) => ({ loaded: 0, total: a.sizeHint }))
  const report = () => {
    const progress = { engine: { loaded: 0, total: 0 }, model: { loaded: 0, total: 0 } }
    assets.forEach((a, i) => {
      const s = state[i]!
      progress[a.group].loaded += s.loaded
      progress[a.group].total += Math.max(s.total, s.loaded)
    })
    post({ type: 'progress', progress })
  }
  const onBytes = (i: number) => (n: number, total: number) => {
    state[i]!.loaded = n
    if (total > 0) state[i]!.total = total
    report()
  }

  const [wasmBytes, encBytes, decBytes] = await Promise.all([
    // 引擎下不下来（CDN / 资源地址都挂）：不设 wasmBinary，退回 onnxruntime 自己按打包地址拉一次
    grabAsset(msg.wasm, onBytes(0)).catch(() => null),
    grabAsset(msg.encoder, onBytes(1)),
    grabAsset(msg.decoder, onBytes(2)),
  ])
  if (wasmBytes) ort.env.wasm.wasmBinary = wasmBytes
  decoder = await createWasm(decBytes)
  if (msg.useGpu) {
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
    encoder = await createWasm(msg.useGpu ? await grabAsset(msg.cpuEncoder, () => {}) : encBytes)
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
    if (!cpuEncoderAsset) throw err
    encoder = await createWasm(await grabAsset(cpuEncoderAsset, () => {}))
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
  // 三张候选（导出时 multimask=true，第 0 张并不是 SAM 的「单蒙版」token）：先比「与提示一致的点数」
  // （正点落在蒙版内、负点落在蒙版外），一样多再比 IoU。实测多点时第 0 张常把背景带进来或无视排除点，
  // 单点时等价于原来的「IoU 最高」。
  const best = pickMask(pts, masks, scores)
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

/** 候选蒙版里与提示最一致的一张：一致点数优先，IoU 次之 */
function pickMask(pts: { x: number; y: number; label: 0 | 1 }[], masks: Float32Array, scores: Float32Array): number {
  const n = Math.min(scores.length, Math.floor(masks.length / (LOW * LOW)))
  const scale = LOW / SIZE
  let best = 0
  let bestHit = -1
  for (let k = 0; k < n; k++) {
    const base = k * LOW * LOW
    let hit = 0
    for (const p of pts) {
      const ix = Math.min(LOW - 1, Math.max(0, Math.floor(p.x * scale)))
      const iy = Math.min(LOW - 1, Math.max(0, Math.floor(p.y * scale)))
      const inside = masks[base + iy * LOW + ix]! > 0
      if (inside === (p.label === 1)) hit++
    }
    if (hit > bestHit || (hit === bestHit && scores[k]! > scores[best]!)) {
      best = k
      bestHit = hit
    }
  }
  return best
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
