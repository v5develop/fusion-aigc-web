/**
 * 「点选」选区的能力探测（同步、极小，可被面板 / 状态机直接引用；模型与推理代码都在懒加载的 pointSegment.ts / worker 里）。
 *
 * <p>本机推理用 onnxruntime-web（WASM SIMD 必需，WebGPU 可选加速），在 Web Worker 里跑：
 * 缺 WebAssembly SIMD / Worker / BigInt64Array（int64 输入）任一项 = 不支持，面板里「点选」置灰并提示。
 * 运行期加载失败（两种后端都起不来）时 {@link markPointSegmentBroken} 把本会话标为不可用。
 */
import { ref } from 'vue'

export const POINT_UNSUPPORTED_HINT = '当前浏览器不支持点选'

// wasm-feature-detect 的 SIMD 探测模块（v128.const + i8x16.popcnt）
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

function detect(): boolean {
  try {
    if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof BigInt64Array === 'undefined')
      return false
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function') return false
    return WebAssembly.validate(SIMD_PROBE)
  } catch {
    return false
  }
}

/** 不支持点选的原因；'' = 支持（运行期起不来时也会写进来） */
export const pointSegmentBlocked = ref(detect() ? '' : POINT_UNSUPPORTED_HINT)

/** 运行期两种后端都加载失败：本会话不再提供点选 */
export function markPointSegmentBroken(reason = POINT_UNSUPPORTED_HINT) {
  pointSegmentBlocked.value = reason
}

// ---------------- 空闲预取（参数台打开时调一次；不在页面加载时做） ----------------

let prefetchScheduled = false

/**
 * 参数台打开时调用：浏览器空闲时把点选的识别引擎 + 模型预取进 Cache Storage（point-segment.ts prefetchPointSegment），
 * 用户点「点选」时就不用再等下载。本会话只排一次；不支持点选、省流量模式（Save-Data）/ 2G 网络 / 小内存设备、Cache Storage 不可用时不做。
 */
export function schedulePointSegmentPrefetch() {
  if (prefetchScheduled || pointSegmentBlocked.value || typeof window === 'undefined') return
  const nav = navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string }
    deviceMemory?: number
  }
  // 省流量 / 2G 网络 / 小内存设备：不主动下 ~40MB，等用户真点「点选」再下
  if (nav.connection?.saveData || /(^|-)2g$/.test(nav.connection?.effectiveType ?? '')) return
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 2) return
  prefetchScheduled = true
  const run = () => {
    void import('./point-segment.ts')
      .then((m) => m.prefetchPointSegment())
      .catch(() => {
        prefetchScheduled = false
      })
  }
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback
  // 先让参数台的首帧 / 烘图跑完再开始下载
  setTimeout(() => (idle ? idle(run, { timeout: 5000 }) : run()), 1500)
}
