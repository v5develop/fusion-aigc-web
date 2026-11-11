/**
 * 磁性套索边缘代价图：Worker 里算（edge-cost.worker.ts），按网格尺寸 + 图片地址缓存一份。
 * Worker 起不来（老浏览器 / CSP）时退回主线程同步算（1024 网格约 80ms，只算一次）。
 */
import { closingPath, edgeCostMap, type EdgeCostMap } from './magnetic-lasso.ts'
import type { Pt } from './selection-geometry.ts'

export interface EdgeCostSource {
  /** 缓存键（图片地址） */
  key: string
  lab: Float32Array
  width: number
  height: number
}

const CLOSED = new Error('已关闭')
let cache: { key: string; w: number; h: number; map: Promise<EdgeCostMap> } | null = null
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (m: EdgeCostMap) => void; reject: (e: unknown) => void }>()
const pendingClosing = new Map<number, { resolve: (p: Pt[]) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./edge-cost.worker.ts', import.meta.url), { type: 'module', name: 'edge-cost' })
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { id: number; kind?: string; ok: boolean; map?: EdgeCostMap; path?: Pt[]; error?: string }
      if (d.kind === 'closing') {
        const c = pendingClosing.get(d.id)
        if (!c) return
        pendingClosing.delete(d.id)
        if (d.ok && d.path) c.resolve(d.path)
        else c.reject(new Error(d.error || '闭合计算失败'))
        return
      }
      const p = pending.get(d.id)
      if (!p) return
      pending.delete(d.id)
      if (d.ok && d.map) p.resolve(d.map)
      else p.reject(new Error(d.error || '边缘计算失败'))
    }
    worker.onerror = (ev) => {
      ev.preventDefault?.()
      const err = new Error(ev.message || '边缘计算组件加载失败')
      for (const p of pending.values()) p.reject(err)
      pending.clear()
      for (const p of pendingClosing.values()) p.reject(err)
      pendingClosing.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    return null
  }
}

/** 取（或开始算）边缘代价图；同一张图同一网格只算一次 */
export function loadEdgeCost(src: EdgeCostSource): Promise<EdgeCostMap> {
  if (cache && cache.key === src.key && cache.w === src.width && cache.h === src.height) return cache.map
  const w = getWorker()
  let map: Promise<EdgeCostMap>
  if (!w) map = Promise.resolve().then(() => edgeCostMap(src.lab, src.width, src.height))
  else {
    const id = ++seq
    const copy = src.lab.slice()
    map = new Promise<EdgeCostMap>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ id, lab: copy.buffer, width: src.width, height: src.height }, [copy.buffer])
    }).catch((err: unknown) => {
      if (err === CLOSED) throw err
      return edgeCostMap(src.lab, src.width, src.height)
    })
  }
  const entry = { key: src.key, w: src.width, h: src.height, map }
  cache = entry
  map.catch(() => {
    if (cache === entry) cache = null
  })
  return map
}

export interface ClosingRequest {
  map: EdgeCostMap
  threshold: number
  last: Pt
  first: Pt
  drawn: readonly Pt[]
  margin: number
}

/**
 * 闭合段最短路（100–300ms 的计算）：放进同一个 Worker，不卡主线程；结果与主线程 {@link closingPath} 逐点一致。
 * 边缘图在主线程手里（算好后整份 transfer 回来了），这里拷一份（约 13MB，几毫秒）送过去。
 * Worker 起不来 / 中途挂了：退回主线程同步算（旧行为）。关弹窗（disposeEdgeCost）时以 CLOSED 拒绝，调用方丢弃结果。
 */
export function computeClosingPath(req: ClosingRequest): Promise<Pt[]> {
  const fallback = () => closingPath(req.map, req.threshold, req.last, req.first, req.drawn, req.margin)
  const w = getWorker()
  if (!w) return Promise.resolve().then(fallback)
  const id = ++seq
  const m = req.map
  const copy: EdgeCostMap = {
    width: m.width,
    height: m.height,
    grad: m.grad.slice(),
    dx: m.dx.slice(),
    dy: m.dy.slice(),
    zc: m.zc.slice(),
  }
  return new Promise<Pt[]>((resolve, reject) => {
    pendingClosing.set(id, { resolve, reject })
    try {
      w.postMessage(
        {
          kind: 'closing',
          id,
          map: copy,
          threshold: req.threshold,
          last: req.last,
          first: req.first,
          drawn: req.drawn,
          margin: req.margin,
        },
        [copy.grad.buffer, copy.dx.buffer, copy.dy.buffer, copy.zc.buffer],
      )
    } catch (e) {
      pendingClosing.delete(id)
      reject(e)
    }
  }).catch((err: unknown) => {
    if (err === CLOSED) throw err
    return fallback()
  })
}

/**
 * 关弹窗时终止 Worker。算好的那一份（只留最近一张图）保留：同一张图再打开智能选区不用重算；
 * 还没算完的作废（缓存一起清掉）。
 */
export function disposeEdgeCost() {
  worker?.terminate()
  worker = null
  if (pending.size) cache = null
  for (const p of pending.values()) p.reject(CLOSED)
  pending.clear()
  for (const p of pendingClosing.values()) p.reject(CLOSED)
  pendingClosing.clear()
}
