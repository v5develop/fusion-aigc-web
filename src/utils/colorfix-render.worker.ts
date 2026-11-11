/**
 * 校色重活 Worker（2026-11-11）：导出真图与全屏局部高清的逐像素合成在这里算，主线程只负责解码原图、整理蒙版、
 * 编码失败时兜底。协议（主线程侧见 colorfix-offload.ts）：
 *
 * <ul>
 *   <li>`begin`：整幅 RGBA 帧（transfer）+ 尺寸 + exact；</li>
 *   <li>`layer`：一层的调整 + 它的 alpha（transfer，null = 整幅）+ 替换颜色源色；每层处理完回 `ack`（主线程据此限流，
 *       Worker 里最多压两层 alpha）；</li>
 *   <li>`end`：OffscreenCanvas 可用时直接编码成无损 PNG 回 Blob，否则把像素缓冲 transfer 回去由主线程编码；</li>
 *   <li>`abort`：丢掉这个会话。</li>
 * </ul>
 * 合成公式与主线程同一份（utils/colorfix-math compositeOneLayer），结果逐像素相同。像素只在本机内存里流转。
 */
import { compositeOneLayer, type CompositeLayerSpec, type Lab } from './colorfix-math.ts'

interface Session {
  width: number
  height: number
  exact: boolean
  running: Uint8ClampedArray
  adjusted: Uint8ClampedArray
}

type InMsg =
  | { type: 'begin'; id: number; width: number; height: number; frame: ArrayBuffer; exact: boolean }
  | { type: 'layer'; id: number; seq: number; spec: CompositeLayerSpec; alpha: ArrayBuffer | null; source: Lab | null }
  | { type: 'end'; id: number; encode: boolean }
  | { type: 'abort'; id: number }

const sessions = new Map<number, Session>()
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const m = ev.data
  try {
    if (m.type === 'begin') {
      const running = new Uint8ClampedArray(m.frame)
      sessions.set(m.id, {
        width: m.width,
        height: m.height,
        exact: m.exact,
        running,
        adjusted: new Uint8ClampedArray(running.length),
      })
      return
    }
    const s = sessions.get(m.id)
    if (m.type === 'abort') {
      sessions.delete(m.id)
      return
    }
    if (!s) throw new Error('渲染会话不存在')
    if (m.type === 'layer') {
      compositeOneLayer(s.running, s.adjusted, m.spec, m.alpha ? new Uint8Array(m.alpha) : null, m.source, s.exact)
      post({ id: m.id, type: 'ack', seq: m.seq })
      return
    }
    // end
    sessions.delete(m.id)
    if (m.encode && typeof OffscreenCanvas !== 'undefined') {
      try {
        const canvas = new OffscreenCanvas(s.width, s.height)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.putImageData(new ImageData(s.running as Uint8ClampedArray<ArrayBuffer>, s.width, s.height), 0, 0)
          const blob = await canvas.convertToBlob({ type: 'image/png' })
          canvas.width = canvas.height = 0
          post({ id: m.id, type: 'done', blob })
          return
        }
      } catch {
        /* 编码不了：退回把像素交给主线程 */
      }
    }
    post({ id: m.id, type: 'done', buffer: s.running.buffer }, [s.running.buffer as ArrayBuffer])
  } catch (err) {
    sessions.delete(m.id)
    post({ id: m.id, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
