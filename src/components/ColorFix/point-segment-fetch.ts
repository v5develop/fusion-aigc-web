/**
 * 点选分割的资源下载（主线程预取与 Worker 共用；不依赖 Vue / DOM，Worker 里可直接 import）。
 *
 * <p>资源 = 识别引擎（onnxruntime-web 的 WASM 运行时，约 28.7MB）+ SlimSAM 模型（.onnx）。每个资源给一串候选地址，
 * 先查 Cache Storage（{@link POINT_SEGMENT_CACHE}，按地址存，跨会话保留），都没有再按顺序下载并写回缓存。
 * 下载按字节回报进度：响应没有可信的 content-length（压缩传输 / 跨域没暴露）时用调用方给的 sizeHint 估总量，
 * 已下载超过估计时总量跟着涨，不会出现 > 100%。
 */

export const POINT_SEGMENT_CACHE = 'fusion-point-segment-v1'

export class PointSegmentFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PointSegmentFetchError'
  }
}

export async function openPointSegmentCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(POINT_SEGMENT_CACHE)
  } catch {
    return null
  }
}

/** WASM 魔数 \0asm：SPA 兜底回的 HTML / 网关错误页不会被当成引擎 */
export function isWasmBinary(bytes: Uint8Array): boolean {
  return bytes.byteLength > 8 && bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d
}

export interface FetchAssetOptions {
  /** 估计大小（字节）：响应没有可信长度时的进度总量 */
  sizeHint?: number
  /** 内容校验（默认只要求 ≥ 1KB） */
  validate?: (bytes: Uint8Array) => boolean
  /** false = 只保证进了缓存（预取用）：命中缓存时不读出内容，返回 null */
  read?: boolean
}

async function cachedHit(cache: Cache | null, candidates: string[]): Promise<{ url: string; resp: Response } | null> {
  if (!cache) return null
  for (const url of candidates) {
    try {
      const resp = await cache.match(url)
      if (resp) return { url, resp }
    } catch {
      /* 缓存读不了就下载 */
    }
  }
  return null
}

/**
 * 取一个资源：缓存命中直接用，否则按候选顺序下载（写回缓存）。onBytes(loaded, total) 回报进度。
 * read=false 且命中缓存时返回 null（不把几十 MB 读进内存）。
 */
export async function fetchPointSegmentAsset(
  candidates: string[],
  onBytes: (loaded: number, total: number) => void,
  opts: FetchAssetOptions = {},
): Promise<Uint8Array | null> {
  const validate = opts.validate ?? ((b: Uint8Array) => b.byteLength >= 1024)
  const cache = await openPointSegmentCache()
  const hit = await cachedHit(cache, candidates)
  if (hit) {
    const len = Number(hit.resp.headers.get('content-length')) || opts.sizeHint || 0
    if (opts.read === false) {
      onBytes(len, len)
      return null
    }
    try {
      const buf = new Uint8Array(await hit.resp.arrayBuffer())
      if (validate(buf)) {
        onBytes(buf.byteLength, buf.byteLength)
        return buf
      }
      await cache?.delete(hit.url)
    } catch {
      /* 读坏了：重新下载 */
    }
  }
  let lastErr: unknown = null
  for (const url of candidates) {
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' })
      const type = resp.headers.get('content-type') || ''
      if (!resp.ok || type.includes('text/html')) throw new Error(`HTTP ${resp.status}`)
      const encoding = (resp.headers.get('content-encoding') || '').toLowerCase()
      const declared = Number(resp.headers.get('content-length')) || 0
      // 压缩传输时 content-length 是压缩后的大小，与读到的（解压后）字节数对不上：改用估计值。
      // 跨域响应拿不到 content-encoding（不在 CORS 安全名单），content-length 却拿得到：明显小于估计值也当压缩后的大小
      const identity = !encoding || encoding === 'identity'
      const plausible = !opts.sizeHint || declared >= opts.sizeHint * 0.8
      let total = declared && identity && plausible ? declared : opts.sizeHint || declared
      let buf: Uint8Array
      if (resp.body) {
        buf = new Uint8Array(Math.max(total, 1 << 20))
        const reader = resp.body.getReader()
        let off = 0
        onBytes(0, total)
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (off + value.byteLength > buf.byteLength) {
            const grown = new Uint8Array(Math.max(buf.byteLength * 2, off + value.byteLength))
            grown.set(buf.subarray(0, off))
            buf = grown
          }
          buf.set(value, off)
          off += value.byteLength
          if (off > total) total = off
          onBytes(off, total)
        }
        // 扩容 / 估计偏大时底层缓冲比内容大：拷成刚好大小，别让几十 MB 的空闲缓冲跟着引擎一起常驻 Worker
        buf = off === buf.byteLength ? buf : buf.slice(0, off)
      } else {
        buf = new Uint8Array(await resp.arrayBuffer())
      }
      onBytes(buf.byteLength, buf.byteLength)
      if (!validate(buf)) throw new Error('文件不完整')
      try {
        await cache?.put(
          url,
          new Response(buf.slice().buffer, {
            headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) },
          }),
        )
      } catch {
        /* 配额满 / 隐私模式：下次重新下载 */
      }
      return buf
    } catch (err) {
      lastErr = err
    }
  }
  throw new PointSegmentFetchError(lastErr instanceof Error ? lastErr.message : String(lastErr))
}

interface GpuLike {
  requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null>
}

/** WebGPU 且支持 shader-f16（编码器用 fp16 权重） */
export async function hasF16Gpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu
    if (!gpu) return false
    const adapter = await gpu.requestAdapter()
    return !!adapter && adapter.features.has('shader-f16')
  } catch {
    return false
  }
}
