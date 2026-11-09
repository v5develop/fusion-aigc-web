/**
 * 按「已存的校色」直接操作，不挂状态机、不需要组件 setup：
 *
 * - {@link hasStoredColorFix}：这条存过校色参数（结果卡打「已校色」、决定下载 / 引用时要不要烘）；
 * - {@link bakeStoredColorFix}：按存的 参数 + 选区 烘出 PNG（结果卡上的 下载 / 引用编辑 / 在画布中打开）；
 * - {@link clearStoredColorFix}：删掉这条的参数、选区与所有涂抹蒙版（「移除校色」）。
 *
 * <p>与 useResultColorFix 同一口径：选了「自动识别 / 手动涂抹」但蒙版拿不到 = 不校色（返回 null，调用方用原图）。
 */
import {
  COLORFIX_EXPORT_MAX_SIDE,
  clearColorFix,
  colorFixDataUrlToBlob,
  colorFixImage,
  loadColorFix,
} from '@/utils/colorfix.ts'
import { deletePaintedMasksOf, deleteRegion, loadPaintedMask, loadRegion } from './maskStore.ts'
import {
  colorFixPresetFor,
  colorFixRequestParts,
  colorFixSegmentSupported,
  defaultColorFixSegmenter,
  type ColorFixPresetPart,
  type ColorFixSegmenter,
} from './segment.ts'
import { COLORFIX_REGION_DEFAULT, type ColorFixAutoTarget } from './types.ts'
import { withPngExt } from './files.ts'

export interface BakeStoredOptions {
  /** 文件名（自动补 .png），默认 colorfix.png */
  name?: string
  /** 导出长边上限（只缩不放），默认 4096；要走 10M 上传口时传小些（如 2048） */
  maxSide?: number
  /** 现成蒙版（同 useResultColorFix maskUrl） */
  maskUrl?: string
  /** maskUrl 代表的识别目标，默认 garment */
  maskTarget?: ColorFixAutoTarget
  /** 现成逐件蒙版（同 useResultColorFix maskParts） */
  maskParts?: ColorFixPresetPart[] | null
  /** 自动识别函数；null = 不识别（只认 maskUrl） */
  segmenter?: ColorFixSegmenter | null
  /** 等自动识别的上限，默认 15s */
  segmentTimeoutMs?: number
}

/** 这条存过校色参数 */
export function hasStoredColorFix(key: string | null | undefined): boolean {
  return !!key && !!loadColorFix(key)
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    task.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

/**
 * 按已存的校色烘图。返回 null = 这条没校色，或选区蒙版拿不到（按套件口径等于不校色），调用方用原图；烘图失败抛错。
 *
 * <p>⚠️ src 必须是当前观看者有权下载的那张（免费档 = 带水印的交付图，与它平时的「下载」同一个地址），
 * 不能是干净原件——烘出来的 PNG 会被下载 / 上传。
 */
export async function bakeStoredColorFix(key: string, src: string, opts: BakeStoredOptions = {}): Promise<File | null> {
  const params = key ? loadColorFix(key) : null
  if (!params || !src) return null
  const region = loadRegion(key) ?? COLORFIX_REGION_DEFAULT
  let mask: string | null = null
  if (region.mode === 'paint' || region.mode === 'point') {
    mask = (await loadPaintedMask(region.mode === 'point' ? `${key}::point::${src}` : `${key}::${src}`)) || null
    if (!mask) return null
  } else if (region.mode === 'auto') {
    const target = region.target
    const parts = colorFixRequestParts(target, region.parts)
    const preset = target === (opts.maskTarget ?? 'garment') ? colorFixPresetFor(parts, opts.maskUrl ?? '', opts.maskParts) : ''
    if (preset) mask = preset
    else {
      const seg = opts.segmenter === undefined ? defaultColorFixSegmenter : opts.segmenter
      if (!seg || !colorFixSegmentSupported.value) return null
      mask = await withTimeout(seg(src, target, parts), opts.segmentTimeoutMs ?? 15000).catch(() => null)
      if (!mask) return null
    }
  }
  const dataUrl = await colorFixImage(src, { ...params }, mask, opts.maxSide ?? COLORFIX_EXPORT_MAX_SIDE, {
    invert: region.invert,
    feather: region.feather,
  })
  return new File([colorFixDataUrlToBlob(dataUrl)], withPngExt(opts.name || 'colorfix.png'), { type: 'image/png' })
}

/** 删掉这条的校色参数、选区与所有涂抹蒙版（本机）；正在显示它的 useResultColorFix 请改用 cf.clear() */
export async function clearStoredColorFix(key: string | null | undefined): Promise<void> {
  if (!key) return
  clearColorFix(key)
  deleteRegion(key)
  await deletePaintedMasksOf(key)
}
