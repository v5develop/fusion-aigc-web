/**
 * 指针跟随 3D 倾斜（原型 components/motion/useTilt）：指针在元素内移动时只写 CSS 变量，
 * transform 由样式层组合——perspective(800px) rotateX/rotateY（默认上限 8°/10°）+ 上抬 -2px，
 * 图片再沿反向位移（默认 10px/6px）。离开时清掉变量回正。
 *
 * <p>用法：const tilt = useTilt({ prefix: 'hero' })；元素绑 @pointermove="tilt.onMove" @pointerleave="tilt.onLeave"
 * @pointercancel="tilt.onCancel"（变量写入按 requestAnimationFrame 合帧）；
 * 样式读 --{prefix}-rx / -ry / -lift / -img-x / -img-y（未设置时用 0deg / 0px 兜底）。
 * 落地页三张 banner 卡（白卡 + 紫卡）都用它；白卡原先 hover:-translate-y 的上抬已并入 lift 变量，
 * 同一个元素上只有这一条 transform，不会互相打架。
 *
 * <p>触摸 / 粗指针（pointer: coarse）与 prefers-reduced-motion 直接跳过，不写变量。
 */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export interface TiltOptions {
  /** 变量前缀，默认 tilt */
  prefix?: string
  rotateX?: number
  rotateY?: number
  /** 悬停上抬，默认 -2px */
  lift?: string
  imageX?: number
  imageY?: number
}

export function useTilt(options: TiltOptions = {}) {
  const prefix = options.prefix ?? 'tilt'
  const rotateX = options.rotateX ?? 8
  const rotateY = options.rotateY ?? 10
  const lift = options.lift ?? '-2px'
  const imageX = options.imageX ?? 10
  const imageY = options.imageY ?? 6

  // pointermove 一帧可能来好几次：只记最新位置，每帧最多写一次变量
  const queued = new Map<HTMLElement, { dx: number; dy: number }>()
  let frame = 0
  const flush = () => {
    frame = 0
    queued.forEach(({ dx, dy }, el) => {
      el.style.setProperty(`--${prefix}-rx`, `${(-dy * rotateX).toFixed(2)}deg`)
      el.style.setProperty(`--${prefix}-ry`, `${(dx * rotateY).toFixed(2)}deg`)
      el.style.setProperty(`--${prefix}-lift`, lift)
      el.style.setProperty(`--${prefix}-img-x`, `${(dx * imageX).toFixed(1)}px`)
      el.style.setProperty(`--${prefix}-img-y`, `${(dy * imageY).toFixed(1)}px`)
    })
    queued.clear()
  }

  const onMove = (event: PointerEvent) => {
    if (prefersReducedMotion()) return
    if (event.pointerType === 'touch') return
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return
    const el = event.currentTarget
    if (!(el instanceof HTMLElement)) return
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dx = (event.clientX - rect.left) / rect.width - 0.5
    const dy = (event.clientY - rect.top) / rect.height - 0.5
    queued.set(el, { dx, dy })
    if (!frame) frame = requestAnimationFrame(flush)
  }

  /** 离开 / 指针被取消（pointercancel：系统手势、触控板滚动接管等）都回正；先丢掉本帧还没写的位置，免得回正后又被写回去 */
  const onLeave = (event: PointerEvent) => {
    const el = event.currentTarget
    if (!(el instanceof HTMLElement)) return
    queued.delete(el)
    if (!queued.size && frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    for (const k of ['rx', 'ry', 'lift', 'img-x', 'img-y']) el.style.removeProperty(`--${prefix}-${k}`)
  }
  const onCancel = onLeave

  return { onMove, onLeave, onCancel }
}
