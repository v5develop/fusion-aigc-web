/**
 * 按「已存的校色」直接操作，不挂状态机、不需要组件 setup：
 *
 * - {@link hasStoredColorFix}：这条存过校色参数（结果卡打「已校色」、决定下载 / 引用时要不要烘）；
 * - {@link bakeStoredColorFix}：按存的校色图层（旧数据 = 参数 + 选区）烘出 PNG（结果卡上的 下载 / 引用编辑 / 在画布中打开）；
 * - {@link clearStoredColorFix}：删掉这条的参数、选区与所有涂抹蒙版（「移除校色」）。
 *
 * <p>与 useResultColorFix 同一口径：选了「自动识别 / 手动涂抹」但蒙版拿不到 = 不校色（返回 null，调用方用原图）。
 */
import {
  COLORFIX_EXPORT_MAX_SIDE,
  clearColorFix,
  colorFixDataUrlToBlob,
  colorFixFilter,
  colorFixRenderLayers,
  loadColorFix,
  type ColorFixRenderLayer,
} from '@/utils/colorfix.ts'
import { loadPixel } from './pixel-store.ts'
import {
  deleteLayers,
  deletePaintedMasksOf,
  deleteRegion,
  legacySignature,
  loadLayers,
  loadPaintedMask,
  loadRegion,
} from './mask-store.ts'
import {
  adjustActive,
  cloneAdjust,
  isBaseLayer,
  isPixelLayer,
  layerEffective,
  layerMaskScope,
  layersFromLegacy,
  layersHavePixel,
  pixelScope,
  recolorActive,
  type ColorFixLayer,
} from './layers.ts'
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
  const layers = key && src ? loadStoredLayers(key) : null
  if (!layers) return null
  const render: ColorFixRenderLayer[] = []
  for (const l of layers.filter(layerEffective)) {
    if (isPixelLayer(l)) {
      // 像素层的数据只在本机：拿不到（被淘汰 / 换了设备 / 清了站点数据）= 不校色，调用方用原图（与蒙版同口径，不悄悄少一层）
      const pid = l.pixel?.pid ?? ''
      const full = await loadPixel(pixelScope(key, src, pid, 'full'))
      if (!full) return null
      const preview = (await loadPixel(pixelScope(key, src, pid, 'preview'))) || undefined
      render.push({ params: { ...l.params }, mask: null, pixel: { full, preview } })
      continue
    }
    let mask: string | null = null
    if (!isBaseLayer(l)) {
      mask = await resolveLayerMask(key, src, l, opts)
      // 选区拿不到 = 不校色（与 useResultColorFix 导出口径一致：不悄悄少一层）
      if (!mask) return null
    }
    render.push({
      params: { ...l.params },
      mask,
      invert: !!mask && l.region.invert,
      feather: mask ? l.region.feather : 0,
      recolor: recolorActive(l.recolor) ? { ...l.recolor } : null,
      adjust: adjustActive(l.adjust) ? cloneAdjust(l.adjust) : null,
    })
  }
  const dataUrl = await colorFixRenderLayers(src, render, opts.maxSide ?? COLORFIX_EXPORT_MAX_SIDE)
  return new File([colorFixDataUrlToBlob(dataUrl)], withPngExt(opts.name || 'colorfix.png'), { type: 'image/png' })
}

/** 这条存的校色有没有像素层（向下合并的产物，数据只在本机） */
export function storedHasPixelLayers(key: string): boolean {
  const layers = key ? loadStoredLayers(key) : null
  return !!layers && layersHavePixel(layers)
}

/** 这条存的校色图层（图层包优先，没有 / 过期按旧键迁移）；没校色返回 null */
export function loadStoredLayers(key: string): ColorFixLayer[] | null {
  const params = key ? loadColorFix(key) : null
  if (!params) return null
  const region = loadRegion(key)
  return loadLayers(key, legacySignature(params, region))?.layers ?? layersFromLegacy(params, region ?? COLORFIX_REGION_DEFAULT)
}

async function resolveLayerMask(key: string, src: string, l: ColorFixLayer, opts: BakeStoredOptions): Promise<string | null> {
  const mode = l.region.mode
  if (mode === 'paint' || mode === 'point') return (await loadPaintedMask(layerMaskScope(key, src, l.id, mode))) || null
  if (mode !== 'auto') return null
  const target = l.region.target
  const parts = colorFixRequestParts(target, l.region.parts)
  const preset =
    target === (opts.maskTarget ?? 'garment') ? colorFixPresetFor(parts, opts.maskUrl ?? '', opts.maskParts) : ''
  if (preset) return preset
  const seg = opts.segmenter === undefined ? defaultColorFixSegmenter : opts.segmenter
  if (!seg || !colorFixSegmentSupported.value) return null
  return withTimeout(seg(src, target, parts), opts.segmentTimeoutMs ?? 15000).catch(() => null)
}

/** 删掉这条的校色参数、选区与所有涂抹蒙版（本机）；正在显示它的 useResultColorFix 请改用 cf.clear() */
export async function clearStoredColorFix(key: string | null | undefined): Promise<void> {
  if (!key) return
  clearColorFix(key)
  deleteRegion(key)
  deleteLayers(key)
  await deletePaintedMasksOf(key)
}

/**
 * 这条存的校色能不能只靠 CSS filter 预览（只有整图底层在起作用、没有替换颜色 / 更多调整）：能 → filter 串；不能（有选区 / 多层 /
 * 替换颜色）→ ''；没校色 → null。列表缩略图「先挂 filter、要真图再烘」用。
 */
export function storedColorFixFilter(key: string): string | null {
  const layers = key ? loadStoredLayers(key) : null
  if (!layers) return null
  const eff = layers.filter(layerEffective)
  if (!eff.length) return colorFixFilter({ hue: 0, sat: 0, light: 0, bright: 0, contrast: 0 })
  const only = eff[0]!
  return eff.length === 1 && isBaseLayer(only) && !isPixelLayer(only) && !recolorActive(only.recolor) && !adjustActive(only.adjust)
    ? colorFixFilter(only.params)
    : ''
}
