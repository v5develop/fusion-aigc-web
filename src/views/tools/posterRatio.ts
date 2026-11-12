/**
 * 图片复刻的出图比例提示：参考海报实测宽高 → 所选模型比例清单里最近的一档（比值取对数距离，横竖对称）。
 *
 * 只是**提示**：真正的出图比例由 Java 按参考图实际宽高、模型在网关声明的比例集合再算一遍，这里的值写进请求体的
 * `aspectRatio` 只用于历史回显与让用户看到「输出比例」。候选里不是 `a:b` 的项（如「自适应」）忽略；
 * 候选集是空 / 没有可用项时返回 null，由调用方不传。
 */

/** 没读到模型比例清单时的候选（与 Java GptImage2Spec 的 13 档一致，顺序同它：并列取靠前） */
export const DEFAULT_POSTER_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '1:3', '3:1', '9:16', '16:9', '21:9', '9:21']

function ratioValue(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(text)
  if (!m) return Number.NaN
  const a = Number(m[1])
  const b = Number(m[2])
  return a > 0 && b > 0 ? a / b : Number.NaN
}

/** 宽高 → 候选里最近的一档比例；宽高无效或候选里没有 a:b 形的项返回 null */
export function nearestAspectRatio(width: number, height: number, candidates: readonly string[]): string | null {
  if (!(width > 0) || !(height > 0)) return null
  const target = Math.log(width / height)
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const value = ratioValue(candidate)
    if (Number.isNaN(value)) continue
    const distance = Math.abs(target - Math.log(value))
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate.trim()
    }
  }
  return best
}

const sizeCache = new Map<string, Promise<{ width: number; height: number } | null>>()

/** 读图片自然宽高（浏览器加载，不涉及跨域像素读取）；读不出返回 null，同一地址只读一次 */
export function readImageSize(url: string): Promise<{ width: number; height: number } | null> {
  const hit = sizeCache.get(url)
  if (hit) return hit
  const task = new Promise<{ width: number; height: number } | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    img.onerror = () => resolve(null)
    img.src = url
  })
  sizeCache.set(url, task)
  return task
}
