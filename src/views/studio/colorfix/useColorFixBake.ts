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
 * <p>蒙版：任务带 `mask_url` 时只校蒙版内（软边 alpha）；没有时整图校色。交接文档要求生产上「服装校色」
 * 没有蒙版应禁用而非整图兜底——后端目前不返回蒙版，先保持整图校色，等 mask_url 上线后再收紧。
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { colorFixFilter, colorFixImage, type ColorFixParams } from '@/utils/colorfix.ts'

/** 下载 / 存资产时的长边上限（舞台预览用 utils 默认 1600） */
export const COLORFIX_EXPORT_MAX = 4096

export function useColorFixBake(opts: {
  /** 原图地址；空 = 没有可校色的图 */
  src: Ref<string>
  params: Ref<ColorFixParams>
  /** 是否校色（关掉时 displaySrc = 原图、不挂滤镜） */
  on: Ref<boolean>
  /** 服装蒙版（软 alpha PNG）；没有 = 整图校色 */
  mask?: Ref<string | undefined | null>
}) {
  const baked = ref('')
  const bakedKey = ref('')
  /** 上一张烘好的图属于哪张原图（有蒙版时拖动期间沿用它） */
  const bakedSrc = ref('')
  const failed = ref(false)
  const baking = ref(false)

  const maskUrl = computed(() => opts.mask?.value || '')
  const keyOf = (src: string, p: ColorFixParams) =>
    `${src}|${maskUrl.value}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}`
  const currentKey = computed(() => (opts.on.value && opts.src.value ? keyOf(opts.src.value, opts.params.value) : ''))

  let timer: ReturnType<typeof setTimeout> | null = null
  let ticket = 0

  watch(
    currentKey,
    (key) => {
      if (timer) clearTimeout(timer)
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
      baking.value = true
      const my = ticket
      const src = opts.src.value
      const p = { ...opts.params.value }
      const mask = maskUrl.value || null
      timer = setTimeout(async () => {
        try {
          const out = await colorFixImage(src, p, mask)
          if (my !== ticket) return
          baked.value = out
          bakedKey.value = key
          bakedSrc.value = src
        } catch {
          if (my === ticket) failed.value = true
        } finally {
          if (my === ticket) baking.value = false
        }
      }, 140)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
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
    if (!currentKey.value || displaySrc.value !== opts.src.value) return undefined
    return colorFixFilter(opts.params.value)
  })

  /** 导出用的真图（下载 / 存资产）：长边最多 4096 的无损 PNG dataURL；失败抛错 */
  function exportBaked(): Promise<string> {
    return colorFixImage(opts.src.value, { ...opts.params.value }, maskUrl.value || null, COLORFIX_EXPORT_MAX)
  }

  return { displaySrc, liveFilter, ready, failed, baking, exportBaked }
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
