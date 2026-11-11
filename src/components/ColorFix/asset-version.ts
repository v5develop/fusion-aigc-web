/**
 * 校色后存为素材库资产版本（工具页 / 结果列表舞台 / 资产详情共用一个口径）：
 * 烘 PNG → goUpload 直传 → assetLibAddVersion 追加版本，params = { colorFix, colorFixRegion?, colorFixLayers?, sourceImage }
 * （详情页版本胶囊按 colorFix 标「校色后」）。
 *
 * <p>上传图长边 3072，超 9.5MB 降到 2048（goUpload 上限 10MB）。
 *
 * <p>去重：同一资产 + 同一组（原图 + 各图层的 五参数 / 替换颜色 / 选区含服装部位）只追加一次——本会话存过的、以及调用方传进来的已有版本都算；
 * 涂抹选区永不去重（蒙版不在参数里，判不出是否相同）。
 *
 * <p>任务结果对资产：{@link findTaskAsset} 按任务号查任务中心详情，对号顺序 ①图片地址（去域名与查询串）与原图或
 * 水印副本一致（免费用户看到的是水印副本）②任务只有一张资产 ③资产数与结果图数相同时按序号。
 */
import { assetLibAddVersion } from '@/api/asset-library.ts'
import { goUploadImage } from '@/api/go-upload.ts'
import { taskCenterTask, type ITaskCenterAssetRef } from '@/api/task-center.ts'
import { colorFixSanitize, type ColorFixParams } from '@/utils/colorfix.ts'
import { COLORFIX_REGION_DEFAULT, colorFixRegionSanitize, type ColorFixRegion } from './types.ts'
import {
  COLORFIX_LAYERS_VERSION,
  isBaseLayer,
  layerEffective,
  layersNeedLocalMask,
  layersSanitize,
  legacyOf,
  recolorActive,
  type ColorFixLayer,
} from './layers.ts'
import type { ResultColorFix } from './useResultColorFix.ts'
import { bakeForUpload } from './files.ts'

const savedSignatures = new Set<string>()

const normalize = (u: string | null | undefined) => (u || '').split('?')[0]?.replace(/^https?:\/\/[^/]+/, '') ?? ''

/** 校色参数签名（去重用）：原图 + 五参数 + 选区；涂抹选区返回 '' = 不去重 */
export function colorFixSignatureOf(
  params: ColorFixParams | null | undefined,
  region: ColorFixRegion | null | undefined,
  sourceImage: string,
): string {
  if (!params) return ''
  const r = region ?? COLORFIX_REGION_DEFAULT
  if (r.mode === 'paint' || r.mode === 'point') return ''
  const p = params
  // 服装细分部位也算进去：同参数换了部位（上衣 → 裤子）是另一版
  const reg =
    r.mode === 'whole' ? 'whole' : `${r.mode}:${r.target}:${(r.parts ?? []).join(',')}:${r.invert ? 1 : 0}:${r.feather}`
  return `${normalize(sourceImage)}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}|${reg}`
}

/**
 * 图层签名：能无损折回旧形状的（只有底层 / 底层全零 + 一个选区）用旧签名——与旧版存的版本照样能去重；
 * 其余按生效图层的 参数 + 选区 + 替换颜色 拼；有涂抹 / 点选蒙版的返回 ''（不去重）。
 */
export function colorFixLayersSignature(layers: readonly ColorFixLayer[], sourceImage: string): string {
  const leg = legacyOf(layers)
  if (leg.exact) return colorFixSignatureOf(leg.params, leg.region, sourceImage)
  if (layersNeedLocalMask(layers)) return ''
  const body = layers.filter(layerEffective).map((l) => {
    const p = l.params
    const r = l.region
    const reg = isBaseLayer(l) ? 'whole' : `${r.mode}:${r.target}:${(r.parts ?? []).join(',')}:${r.invert ? 1 : 0}:${r.feather}`
    const rc = recolorActive(l.recolor) ? `${l.recolor.source ?? 'auto'}>${l.recolor.target}@${l.recolor.strength}` : ''
    return `${p.hue},${p.sat},${p.light},${p.bright},${p.contrast}:${reg}:${rc}`
  })
  return `${normalize(sourceImage)}|L${COLORFIX_LAYERS_VERSION}|${body.join(';')}`
}

export function colorFixSignature(cf: ResultColorFix, sourceImage: string): string {
  return colorFixLayersSignature(cf.layers.value, sourceImage)
}

/** 资产版本 params JSON 里的校色签名（不是校色版本 / 解析失败返回 ''） */
export function colorFixSignatureOfVersion(paramsJson: string | null | undefined): string {
  try {
    const o = paramsJson ? JSON.parse(paramsJson) : null
    const params = colorFixSanitize(o?.colorFix)
    if (!params || typeof o?.sourceImage !== 'string') return ''
    const stack = o.colorFixLayers ? layersSanitize(o.colorFixLayers) : null
    if (stack) return colorFixLayersSignature(stack.layers, o.sourceImage)
    return colorFixSignatureOf(params, colorFixRegionSanitize(o.colorFixRegion), o.sourceImage)
  } catch {
    return ''
  }
}

/**
 * 资产版本的 params JSON：colorFix / colorFixRegion 照旧（折回旧形状的值，老读法照常）；
 * 折不回去（多层 / 替换颜色）时另加 colorFixLayers = { v, layers }（只增不改，蒙版不在里面）。
 */
export function colorFixVersionParams(cf: ResultColorFix, sourceImage: string): string {
  const layers = cf.layers.value
  const leg = legacyOf(layers)
  return JSON.stringify({
    colorFix: leg.params,
    sourceImage,
    ...(leg.region.mode !== 'whole' ? { colorFixRegion: leg.region } : {}),
    ...(leg.exact ? {} : { colorFixLayers: { v: COLORFIX_LAYERS_VERSION, layers } }),
  })
}

export type SaveColorFixVersionResult =
  | { status: 'saved'; url: string }
  /** versionId：撞上的是调用方传进来的已有版本（本会话刚存过的没有 id） */
  | { status: 'duplicate'; versionId?: number }
  | { status: 'not-active' }

export interface SaveColorFixVersionOptions {
  /** 校色底图地址（= cf.src，写进 params.sourceImage） */
  sourceImage: string
  /** 上传文件名（自动补 .png） */
  fileName?: string
  /** 版本说明，默认「校色后」 */
  prompt?: string
  /** 资产已有的版本：同参数的校色版本已在时不再追加，返回它的 id */
  existingVersions?: { id: number; params?: string | null }[]
}

/** 校色后追加资产版本（见文件头）；烘图 / 上传 / 追加失败抛错 */
export async function saveColorFixVersion(
  assetId: number,
  cf: ResultColorFix,
  opts: SaveColorFixVersionOptions,
): Promise<SaveColorFixVersionResult> {
  if (!cf.active.value || !opts.sourceImage) return { status: 'not-active' }
  const sig = colorFixSignature(cf, opts.sourceImage)
  if (sig) {
    const dup = opts.existingVersions?.find((v) => colorFixSignatureOfVersion(v.params) === sig)
    if (dup) return { status: 'duplicate', versionId: dup.id }
    if (savedSignatures.has(`${assetId}|${sig}`)) return { status: 'duplicate' }
  }
  const name = opts.fileName || `colorfix-asset-${assetId}.png`
  const file = await bakeForUpload((side) => cf.bakeToFile(/\.png$/i.test(name) ? name : `${name}.png`, side))
  if (!file) return { status: 'not-active' }
  const url = await goUploadImage(file)
  await assetLibAddVersion(assetId, {
    imageUrl: url,
    prompt: opts.prompt || '校色后',
    params: colorFixVersionParams(cf, opts.sourceImage),
  })
  if (sig) savedSignatures.add(`${assetId}|${sig}`)
  return { status: 'saved', url }
}

/** 任务结果图 → 素材库资产（对号规则见文件头）；对不上返回 undefined */
export async function findTaskAsset(opts: {
  taskUid: string
  /** 结果图地址 */
  src: string
  /** 这张在本组图片结果里的序号（-1 = 不知道） */
  index: number
  /** 本组图片结果数 */
  total: number
}): Promise<ITaskCenterAssetRef | undefined> {
  const detail = await taskCenterTask(opts.taskUid)
  const assets = detail.data?.assets ?? []
  const s = normalize(opts.src)
  return (
    assets.find((a) => normalize(a.image) === s || (!!a.watermark && normalize(a.watermark) === s)) ??
    (assets.length === 1 ? assets[0] : undefined) ??
    (assets.length > 1 && assets.length === opts.total && opts.index >= 0 ? assets[opts.index] : undefined)
  )
}

export type ColorFixTaskAssetResult = 'saved' | 'duplicate' | 'no-asset' | 'not-active'

/** 任务结果图校色后存为它那条资产的新版本 */
export async function saveColorFixToTaskAsset(opts: {
  taskUid: string
  cf: ResultColorFix
  /** 结果图地址（= cf.src） */
  src: string
  index: number
  total: number
  fileName?: string
  prompt?: string
}): Promise<ColorFixTaskAssetResult> {
  if (!opts.cf.active.value) return 'not-active'
  const target = await findTaskAsset(opts)
  if (!target) return 'no-asset'
  const r = await saveColorFixVersion(target.id, opts.cf, {
    sourceImage: opts.src,
    fileName: opts.fileName || `colorfix-${opts.taskUid}-${opts.index + 1}.png`,
    prompt: opts.prompt,
  })
  return r.status
}
