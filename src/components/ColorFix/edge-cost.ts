/**
 * 磁性套索边缘代价图：Worker 里算（edge-cost.worker.ts），按网格尺寸 + 图片地址缓存一份。
 * Worker 起不来（老浏览器 / CSP）时退回主线程同步算（1024 网格约 80ms，只算一次）。
 */
import { edgeCostMap, type EdgeCostMap } from './magnetic-lasso.ts'

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

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./edge-cost.worker.ts', import.meta.url), { type: 'module', name: 'edge-cost' })
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { id: number; ok: boolean; map?: EdgeCostMap; error?: string }
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
}
