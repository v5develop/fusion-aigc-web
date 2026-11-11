/**
 * 磁性套索的边缘代价图 Worker：收工作网格（长边 ≤1024）上的 OKLab，算一次 {@link edgeCostMap} 回传（全部 transfer）。
 * 像素只在本机内存里流转。主线程协议见 edge-cost.ts。
 */
import { edgeCostMap } from './magnetic-lasso.ts'

interface InMsg {
  id: number
  lab: ArrayBuffer
  width: number
  height: number
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const { id, lab, width, height } = ev.data
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
