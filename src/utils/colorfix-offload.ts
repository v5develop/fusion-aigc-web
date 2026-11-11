/**
 * 校色重活下放 Worker 的主线程侧（2026-11-11，协议见 colorfix-render.worker.ts）。
 *
 * <p>用在导出真图（长边 > 预览尺寸）与全屏局部高清：主线程画原图取帧、逐层整理蒙版 alpha，像素合成与 PNG 编码在 Worker 里做，
 * 拖动滑杆、缩放平移不再被几百毫秒的长任务卡住。预览（≤1600，3D 查找表）仍在主线程，够快。
 *
 * <p>限流：每层 alpha transfer 过去前先等「上上层」的 ack，Worker 里最多压两层 alpha（4096² 一层 16MB）。
 * Worker 起不来（老浏览器 / CSP）或中途崩了：{@link offloadAvailable} 为 false / 会话 reject {@link OffloadUnavailable}，
 * 调用方退回主线程同一套公式重算（结果逐像素相同，只是会卡一下）。
 */
import type { CompositeLayerSpec, Lab } from './colorfix-math.ts'

/** Worker 不可用 / 崩溃：调用方退回主线程 */
export class OffloadUnavailable extends Error {
  constructor(msg = '渲染组件不可用') {
    super(msg)
    this.name = 'OffloadUnavailable'
  }
}

interface Pending {
  acks: Map<number, () => void>
  done: (r: { blob?: Blob; buffer?: ArrayBuffer }) => void
  fail: (e: unknown) => void
}

let worker: Worker | null = null
let broken = false
let seq = 0
const sessions = new Map<number, Pending>()

function failAll(err: unknown) {
  for (const p of sessions.values()) p.fail(err)
  sessions.clear()
}

function getWorker(): Worker | null {
  if (worker) return worker
  if (broken || typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./colorfix-render.worker.ts', import.meta.url), { type: 'module', name: 'colorfix-render' })
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { id: number; type: string; seq?: number; blob?: Blob; buffer?: ArrayBuffer; error?: string }
      const p = sessions.get(d.id)
      if (!p) return
      if (d.type === 'ack') {
        const a = p.acks.get(d.seq ?? -1)
        p.acks.delete(d.seq ?? -1)
        a?.()
      } else if (d.type === 'done') {
        sessions.delete(d.id)
        p.done({ blob: d.blob, buffer: d.buffer })
      } else {
        sessions.delete(d.id)
        p.fail(new Error(d.error || '渲染失败'))
      }
    }
    worker.onerror = (ev) => {
      ev.preventDefault?.()
      broken = true
      worker?.terminate()
      worker = null
      failAll(new OffloadUnavailable(ev.message || '渲染组件加载失败'))
    }
    return worker
  } catch {
    broken = true
    return null
  }
}

/** 当前环境能不能下放（第一次调用时尝试起 Worker） */
export function offloadAvailable(): boolean {
  return !!getWorker()
}

export interface OffloadLayer {
  spec: CompositeLayerSpec
  /** 这一层的 alpha（null = 整幅）；按需取，取完 transfer 给 Worker */
  alpha: () => Uint8Array | null
  source: Lab | null
  /** 像素层：整幅 RGBA（A = 覆盖度）；有它时 spec / alpha / source 不用。按需取，取完 transfer 给 Worker */
  pixels?: () => Uint8ClampedArray
  /** 向下合并：把这一层的覆盖范围并进结果的 A 通道（compositeInWorker 要带 opts.cover） */
  cover?: boolean
}

/**
 * 在 Worker 里逐层合成一帧。frame 会被 transfer（调用后主线程不能再用它）。
 * encode = 让 Worker 直接编码 PNG（可用时回 blob，否则回像素 buffer）。alpha 取值抛的错（如蒙版读不了）原样抛出。
 */
export async function compositeInWorker(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  layers: readonly OffloadLayer[],
  opts: { exact: boolean; encode: boolean; cover?: boolean },
): Promise<{ blob?: Blob; buffer?: ArrayBuffer }> {
  const w = getWorker()
  if (!w) throw new OffloadUnavailable()
  const id = ++seq
  const acks = new Map<number, () => void>()
  let fail: (e: unknown) => void = () => {}
  const finished = new Promise<{ blob?: Blob; buffer?: ArrayBuffer }>((resolve, reject) => {
    fail = reject
    sessions.set(id, { acks, done: resolve, fail: reject })
  })
  // 会话失败时还在等的 ack 一并放行（下面的循环据此退出）
  let dead: unknown = null
  finished.catch((e) => {
    dead = e
    for (const a of acks.values()) a()
    acks.clear()
  })
  const ackOf = (n: number) =>
    new Promise<void>((resolve) => {
      if (dead) return resolve()
      acks.set(n, resolve)
    })
  try {
    const buf = frame.buffer as ArrayBuffer
    w.postMessage({ type: 'begin', id, width, height, frame: buf, exact: opts.exact, cover: !!opts.cover }, [buf])
    const waits: Promise<void>[] = []
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!
      let alpha = l.pixels ? null : l.alpha()
      let pixels = l.pixels ? l.pixels() : null
      // 只 transfer 自己独占的缓冲（子视图先拷一份，免得把别人的整块内存送走）
      if (alpha && (alpha.byteOffset !== 0 || alpha.byteLength !== alpha.buffer.byteLength)) alpha = alpha.slice()
      if (pixels && (pixels.byteOffset !== 0 || pixels.byteLength !== pixels.buffer.byteLength)) pixels = pixels.slice()
      if (i >= 2) await waits[i - 2]
      if (dead) break
      waits.push(ackOf(i))
      const ab = alpha ? (alpha.buffer as ArrayBuffer) : null
      const pb = pixels ? (pixels.buffer as ArrayBuffer) : null
      w.postMessage(
        {
          type: 'layer',
          id,
          seq: i,
          spec: { params: l.spec.params, recolor: l.spec.recolor ?? null, adjust: l.spec.adjust ?? null },
          alpha: ab,
          source: l.source,
          pixels: pb,
          cover: !!l.cover,
        },
        [...(ab ? [ab] : []), ...(pb ? [pb] : [])],
      )
    }
    if (!dead) w.postMessage({ type: 'end', id, encode: opts.encode })
  } catch (err) {
    sessions.delete(id)
    w.postMessage({ type: 'abort', id })
    fail(err)
  }
  return finished
}
