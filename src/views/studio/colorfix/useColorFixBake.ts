/**
 * 校色烘图（结果舞台 / 灯箱 / 对比右侧 / 下载 / 存资产共用）：把五参数烘进真像素，CSS filter 只做拖动时的即时预览。
 *
 * <p>流程：参数或原图变了 → 停手 140ms 后调 colorFixImage 烘一张 PNG（按 原图 + 蒙版 + 参数 缓存，见 utils/colorfix.ts）。
 * 新图出来之前：
 * <ul>
 *   <li>没有蒙版（整图校色）：原图 + CSS filter 预览，和烘出来的结果一致，拖动跟手；</li>
 *   <li>有蒙版：CSS filter 只能整图生效，会把背景也染色——改为沿用上一张已烘好的图，等新图替换（同一张原图时）。</li>
 * </ul>
 * 烘图失败（原图 / 蒙版跨域读不了像素、加载失败）：`failed=true`，舞台退回原图 + CSS filter 预览，
 * 下载 / 存资产由调用方提示「校色效果未能写入」。
 *
 * <p>蒙版（局部调色）：传了 `mask` 时只校蒙版内（软边 alpha，可反选 / 柔化，见 utils/colorfix ColorFixMaskOptions）；
 * 没有时整图校色。CSS filter 只能整图生效，所以有蒙版时拖动预览改走画布：停手 60ms 先烘长边 720 的小图，
 * 260ms 再烘 1600 的预览图，新图出来前沿用上一张烘好的。`pending=true`（选了选区但蒙版还没就绪）时不校色、显示原图。
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { ColorFixMaskLoadError, colorFixFilter, colorFixImage, type ColorFixMaskOptions, type ColorFixParams } from '@/utils/colorfix.ts'

/** 下载 / 存资产时的长边上限（舞台预览用 utils 默认 1600） */
export const COLORFIX_EXPORT_MAX = 4096
/** 有蒙版时拖动预览的小图长边 */
const QUICK_SIDE = 720

export function useColorFixBake(opts: {
  /** 原图地址；空 = 没有可校色的图 */
  src: Ref<string>
  params: Ref<ColorFixParams>
  /** 是否校色（关掉时 displaySrc = 原图、不挂滤镜） */
  on: Ref<boolean>
  /** 选区蒙版（软 alpha PNG / 黑底白笔 PNG）；没有 = 整图校色 */
  mask?: Ref<string | undefined | null>
  /** 蒙版的反选 / 柔化（只在有蒙版时生效） */
  maskOpts?: Ref<ColorFixMaskOptions>
  /** 选了局部选区但蒙版还没就绪：不校色（显示原图），导出抛错 */
  pending?: Ref<boolean>
}) {
  const baked = ref('')
  const bakedKey = ref('')
  /** 上一张烘好的图属于哪张原图（有蒙版时拖动期间沿用它） */
  const bakedSrc = ref('')
  const failed = ref(false)
  /** 失败原因是选区蒙版拿不到（提示「选区蒙版加载失败，未应用校色」） */
  const maskLoadFailed = ref(false)
  const baking = ref(false)

  const maskUrl = computed(() => opts.mask?.value || '')
  const maskOpts = computed<ColorFixMaskOptions>(() => (maskUrl.value ? { ...opts.maskOpts?.value } : {}))
  const keyOf = (src: string, p: ColorFixParams) =>
    `${src}|${maskUrl.value}|${maskOpts.value.invert ? 'i' : ''}${maskOpts.value.feather ?? 0}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}`
  const currentKey = computed(() =>
    opts.on.value && opts.src.value && !opts.pending?.value ? keyOf(opts.src.value, opts.params.value) : '',
  )

  let timers: ReturnType<typeof setTimeout>[] = []
  let ticket = 0
  const clearTimers = () => {
    timers.forEach(clearTimeout)
    timers = []
  }

  watch(
    currentKey,
    (key) => {
      clearTimers()
      ticket += 1
      if (!key) {
        baking.value = false
        return
      }
      if (key === bakedKey.value) {
        baking.value = false
        return
      }
      failed.value = false
      maskLoadFailed.value = false
      baking.value = true
      const my = ticket
      const src = opts.src.value
      const p = { ...opts.params.value }
      const mask = maskUrl.value || null
      const mo = { ...maskOpts.value }
      const run = (side: number | undefined, final: boolean) => async () => {
        try {
          const out = await colorFixImage(src, p, mask, side, mo)
          if (my !== ticket) return
          baked.value = out
          bakedSrc.value = src
          if (final) bakedKey.value = key
        } catch (err) {
          if (my !== ticket) return
          // 蒙版加载失败：小图那一轮就定论（再跑大图也一样拿不到）
          if (err instanceof ColorFixMaskLoadError) maskLoadFailed.value = true
          if (final || err instanceof ColorFixMaskLoadError) failed.value = true
        } finally {
          if (my === ticket && final) baking.value = false
        }
      }
      if (mask) {
        // 有蒙版：CSS filter 预览不了局部，先出一张小图跟手，再出预览尺寸
        timers.push(setTimeout(run(QUICK_SIDE, false), 60))
        timers.push(setTimeout(run(undefined, true), 260))
      } else {
        timers.push(setTimeout(run(undefined, true), 140))
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    clearTimers()
    ticket += 1
  })

  /** 当前参数下的烘好的图已就绪 */
  const ready = computed(() => !!currentKey.value && bakedKey.value === currentKey.value && !!baked.value)

  /** 舞台 / 对比右侧 / 灯箱该显示的图 */
  const displaySrc = computed(() => {
    const src = opts.src.value
    if (!currentKey.value) return src
    if (ready.value) return baked.value
    // 有蒙版、同一张原图：等新图期间沿用上一张烘好的
    if (maskUrl.value && !failed.value && bakedSrc.value === src && baked.value) return baked.value
    return src
  })

  /** 挂在 displaySrc 上的 CSS filter（只有在显示原图且需要校色时才有） */
  const liveFilter = computed<string | undefined>(() => {
    if (!currentKey.value || maskUrl.value || displaySrc.value !== opts.src.value) return undefined
    return colorFixFilter(opts.params.value)
  })

  /** 导出用的真图（下载 / 存资产）：长边最多 maxSide（默认 4096）的无损 PNG dataURL；失败抛错 */
  function exportBaked(maxSide = COLORFIX_EXPORT_MAX): Promise<string> {
    if (opts.pending?.value) return Promise.reject(new Error('选区尚未就绪'))
    return colorFixImage(opts.src.value, { ...opts.params.value }, maskUrl.value || null, maxSide, { ...maskOpts.value })
  }

  return { displaySrc, liveFilter, ready, failed, maskLoadFailed, baking, exportBaked }
}

/** dataURL → 触发浏览器下载（Blob URL，延迟回收，Safari / 旧 Firefox 立即回收会落空） */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([buf], { type: 'image/png' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** 从地址推扩展名（下载「校色前」原图用），认不出按 jpg */
export function extOf(url: string): string {
  try {
    const ext = new URL(url, location.href).pathname.match(/\.(png|jpe?g|webp|gif|bmp)$/i)?.[1]
    return ext ? ext.toLowerCase().replace('jpeg', 'jpg') : 'jpg'
  } catch {
    return 'jpg'
  }
}
