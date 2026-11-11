/**
 * 磁性套索的边缘代价图 Worker：收工作网格（长边 ≤1024）上的 OKLab，算一次 {@link edgeCostMap} 回传（全部 transfer）。
 * 像素只在本机内存里流转。主线程协议见 edge-cost.ts。
 */
import { closingPath, edgeCostMap, type EdgeCostMap } from './magnetic-lasso.ts'
import type { Pt } from './selection-geometry.ts'

interface CostMsg {
  kind?: 'cost'
  id: number
  lab: ArrayBuffer
  width: number
  height: number
}

/** 闭合段：主线程把边缘图拷一份过来（transfer），这里跑 closingPath，结果只是一条折线 */
interface ClosingMsg {
  kind: 'closing'
  id: number
  map: EdgeCostMap
  threshold: number
  last: Pt
  first: Pt
  drawn: Pt[]
  margin: number
}

self.onmessage = (ev: MessageEvent<CostMsg | ClosingMsg>) => {
  const msg = ev.data
  if (msg.kind === 'closing') {
    try {
      const path = closingPath(msg.map, msg.threshold, msg.last, msg.first, msg.drawn, msg.margin)
      ;(self as unknown as Worker).postMessage({ id: msg.id, kind: 'closing', ok: true, path })
    } catch (err) {
      ;(self as unknown as Worker).postMessage({
        id: msg.id,
        kind: 'closing',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }
  const { id, lab, width, height } = msg
  try {
    const t0 = performance.now()
    const m = edgeCostMap(new Float32Array(lab), width, height)
    const ms = performance.now() - t0
    ;(self as unknown as Worker).postMessage({ id, ok: true, map: m, ms }, [
      m.grad.buffer,
      m.dx.buffer,
      m.dy.buffer,
      m.zc.buffer,
    ])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
