/**
 * 校色图层（2026-11-11）：校色状态 = 一个「整图」底层 + 最多 7 个选区图层，自下而上依次合成——
 * 每层把自己的调整（替换颜色 → 五参数）透过自己的软蒙版叠到「下面所有层的结果」上。
 *
 * <p>本文件只有类型与纯函数（无 DOM / Vue，Node 可单测）：合法化、与旧版「一组参数 + 一个选区」的互转、
 * 自动命名、哪些层真正生效。
 *
 * <p>兼容旧数据（{@link layersFromLegacy}）：
 * <ul>
 *   <li>旧选区 = 整图 → 只有底层，参数 = 旧参数；</li>
 *   <li>旧选区 = 自动识别 / 涂抹 / 点选 → 底层全零（不改图）+ 一个 id 为 {@link LEGACY_LAYER_ID} 的选区图层，
 *       参数 / 选区 = 旧值；它的涂抹 / 点选蒙版沿用旧的存储作用域（见 useResultColorFix layerMaskScope），老蒙版原样能用。</li>
 * </ul>
 * <p>像素层（2026-11-11，add-only，不升 v）：「向下合并」把两层栅格化成一个 `kind: 'pixel'` 的图层（内容 = 合并那一刻这两层连同它们下面所有层的
 * 结果，数据在 pixel-store.ts，按 `pixel.pid` 引用），没有调整参数，只有显隐 / 名字 / 顺序。老数据没有 kind，读出来仍是调整层；
 * 像素层的数据只在本机，资产版本里的 colorFixLayers 带 `hasPixelLayers: true`，别的地方据此改用已存的成品图而不是重放图层。
 *
 * 反过来 {@link legacyOf} 把图层折回旧形状（写旧的 localStorage 键、资产版本的 colorFix / colorFixRegion、远端 saver），
 * 只读旧字段的老代码照常工作；折不回去的（多层 / 有替换颜色）标 exact=false，旧字段只是近似。
 */
import {
  COLORFIX_ZERO,
  adjustIsZero,
  adjustSanitize,
  cloneCurves,
  colorFixEquals,
  colorFixIsZero,
  colorFixSanitize,
  normalizeHex,
  type ColorFixAdjust,
  type ColorFixParams,
} from '../../utils/colorfix-math.ts'
import {
  COLORFIX_PART_LABELS,
  COLORFIX_REGION_DEFAULT,
  COLORFIX_TARGET_LABELS,
  colorFixPartsSanitize,
  colorFixRegionSanitize,
  type ColorFixRegion,
} from './types.ts'

/** 图层总数上限（含整图底层） */
export const COLORFIX_LAYERS_MAX = 8
/** 底层的固定 id */
export const BASE_LAYER_ID = 'base'
/** 从旧版单选区迁移来的那层（蒙版沿用旧作用域） */
export const LEGACY_LAYER_ID = 'legacy'
/** 持久化格式版本 */
export const COLORFIX_LAYERS_VERSION = 2

/** 替换为目标颜色 */
export interface ColorFixRecolor {
  /** 源色 '#rrggbb'；null = 自动（选区内主色） */
  source: string | null
  /** 目标色 '#rrggbb' */
  target: string
  /** 强度 0–100 */
  strength: number
}

export const COLORFIX_RECOLOR_DEFAULT: ColorFixRecolor = { source: null, target: '#875f9a', strength: 100 }

export interface ColorFixLayer {
  id: string
  name: string
  /** 名字是自动起的（改识别目标 / 部位时跟着改）；用户改过名就是 false */
  autoName: boolean
  visible: boolean
  params: ColorFixParams
  /** 底层恒为整图；选区图层为 auto / paint / point */
  region: ColorFixRegion
  /** 替换为目标颜色（先于五参数生效）；null / 缺省 = 不替换 */
  recolor: ColorFixRecolor | null
  /**
   * 更多调整（2026-11-11，add-only 字段，不升 v）：白平衡 + HSL 分色 + 色阶 + 曲线（adjust.levels / adjust.curves，
   * 同样 add-only），替换颜色之后、五参数之前生效，顺序：白平衡 → HSL → 色阶 → 曲线；
   * null / 缺省 = 不调。老代码读到会忽略它（legacyOf 此时 exact=false，旧字段只是近似）。
   */
  adjust?: ColorFixAdjust | null
  /** 'pixel' = 像素层（向下合并的产物）；缺省 = 调整层（老数据） */
  kind?: 'pixel'
  /** 像素层的数据：原图尺寸（w × h）与存储里的唯一标识 pid（复制图层共用同一份数据） */
  pixel?: { w: number; h: number; pid: string }
}

/** 持久化 / 资产版本里的图层包（add-only：以后加字段不改 v） */
export interface ColorFixLayerStack {
  v: number
  layers: ColorFixLayer[]
  /** 当前选中的图层 id（只本机还原用） */
  selected?: string
  /** 有像素层：它们的像素只在本机，别处不能按图层重放，要用已存的成品图（资产版本 params 里写） */
  hasPixelLayers?: boolean
}

export function isBaseLayer(l: Pick<ColorFixLayer, 'id'>): boolean {
  return l.id === BASE_LAYER_ID
}

/** 像素层（向下合并的产物） */
export function isPixelLayer(l: Pick<ColorFixLayer, 'kind'>): boolean {
  return l.kind === 'pixel'
}

/** 选区图层：既不是整图底层也不是像素层（有选区方式 / 蒙版 / 调整参数） */
export function isSelectionLayer(l: Pick<ColorFixLayer, 'id' | 'kind'>): boolean {
  return !isBaseLayer(l) && !isPixelLayer(l)
}

/** 这组图层里有没有像素层 */
export function layersHavePixel(layers: readonly Pick<ColorFixLayer, 'kind'>[]): boolean {
  return layers.some(isPixelLayer)
}

/** 新像素层的存储标识（本机唯一；复制图层不新建，共用） */
export function newPixelId(): string {
  return `px${newLayerId()}`
}

/** 像素层图层：占 D 的位置（D 是整图底层时沿用底层 id，成为「整幅的像素层」）；名字 / 序号由调用方定 */
export function makePixelLayer(id: string, name: string, pixel: { w: number; h: number; pid: string }): ColorFixLayer {
  return {
    id,
    name,
    autoName: false,
    visible: true,
    params: { ...COLORFIX_ZERO },
    // 占位：像素层没有选区，但 region 是必填字段（老代码读到它时按「没有蒙版的点选层」处理，不生效）
    region: { ...COLORFIX_REGION_DEFAULT, mode: isBaseLayer({ id }) ? 'whole' : 'point' },
    recolor: null,
    kind: 'pixel',
    pixel: { ...pixel },
  }
}

/** 新像素层的名字：「像素层 N」，N = 现有最大序号 + 1 */
export function nextPixelName(layers: readonly ColorFixLayer[]): string {
  let max = layers.filter(isPixelLayer).length
  for (const l of layers) {
    const m = /^像素层 (\d+)$/.exec(l.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `像素层 ${max + 1}`
}

/**
 * 能不能把 index 这一层向下合并（栅格化到它下面那层）：'' = 可以，否则是原因。
 * 只看图层本身；选区蒙版是否就绪、图片是否过大由调用方（useResultColorFix.mergeDown）再判。
 */
export function mergeDownBlocked(layers: readonly ColorFixLayer[], index: number): string {
  const upper = layers[index]
  if (!upper) return '没有选中图层'
  if (index <= 0) return '最下面的图层没有可合并的下层'
  const lower = layers[index - 1]!
  // 合并只栅格化可见结果，隐藏层会随之消失；不静默丢弃用户的调整
  if (!upper.visible || !lower.visible) return '有隐藏的图层，请先显示或删除后再合并'
  if (!layerEffective(upper) && !layerEffective(lower)) return '这两层都没有可见的调整，无需合并'
  return ''
}

export function makeBaseLayer(params: ColorFixParams): ColorFixLayer {
  return {
    id: BASE_LAYER_ID,
    name: '整图',
    autoName: true,
    visible: true,
    params: { ...params },
    region: { ...COLORFIX_REGION_DEFAULT, mode: 'whole' },
    recolor: null,
  }
}

export function recolorSanitize(raw: unknown): ColorFixRecolor | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const target = normalizeHex(o.target)
  if (!target) return null
  const strength =
    typeof o.strength === 'number' && Number.isFinite(o.strength) ? Math.min(100, Math.max(0, Math.round(o.strength))) : 100
  return { source: normalizeHex(o.source), target, strength }
}

/** 替换颜色是否真的会改图（开着且强度 > 0） */
export function recolorActive(r: ColorFixRecolor | null | undefined): r is ColorFixRecolor {
  return !!r && r.strength > 0
}

/** 更多调整是否真的会改图（白平衡 / HSL 有非零值） */
export function adjustActive(a: ColorFixAdjust | null | undefined): a is ColorFixAdjust {
  return !!a && !adjustIsZero(a)
}

/** 这一层会不会改图：可见，且（五参数非零 / 有替换颜色 / 有更多调整） */
export function layerEffective(l: ColorFixLayer): boolean {
  // 像素层：可见就生效（内容本身就是调整的结果）
  if (isPixelLayer(l)) return l.visible
  return l.visible && (!colorFixIsZero(l.params) || recolorActive(l.recolor) || adjustActive(l.adjust))
}

/** 选区图层的自动名字：识别部位（单选时）/ 识别目标 / 「选区 N」 */
export function autoLayerName(region: ColorFixRegion, index: number): string {
  if (region.mode === 'auto') {
    const parts = colorFixPartsSanitize(region.parts)
    if (parts.length === 1) return COLORFIX_PART_LABELS[parts[0]!]
    if (parts.length > 1) return parts.map((p) => COLORFIX_PART_LABELS[p]).join('+')
    return COLORFIX_TARGET_LABELS[region.target]
  }
  return `选区 ${index}`
}

/** 新图层的序号：现有「选区 N」里最大的 N + 1（删了中间的不重号） */
export function nextLayerIndex(layers: readonly ColorFixLayer[]): number {
  let max = layers.filter((l) => !isBaseLayer(l)).length
  for (const l of layers) {
    const m = /^选区 (\d+)$/.exec(l.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

let seq = 0
/** 新图层 id（本机唯一即可：蒙版作用域用它区分） */
export function newLayerId(): string {
  seq = (seq + 1) % 1e6
  return `l${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

function pixelSanitize(raw: unknown): { w: number; h: number; pid: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const pid = typeof o.pid === 'string' && /^[\w-]{1,60}$/.test(o.pid) ? o.pid : ''
  const w = typeof o.w === 'number' && Number.isInteger(o.w) && o.w > 0 && o.w <= 65536 ? o.w : 0
  const h = typeof o.h === 'number' && Number.isInteger(o.h) && o.h > 0 && o.h <= 65536 ? o.h : 0
  return pid && w && h ? { w, h, pid } : null
}

function layerSanitize(raw: unknown, index: number): ColorFixLayer | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : ''
  if (!id) return null
  const params = colorFixSanitize(o.params) ?? { ...COLORFIX_ZERO }
  const base = id === BASE_LAYER_ID
  const region = base
    ? { ...COLORFIX_REGION_DEFAULT, mode: 'whole' as const }
    : colorFixRegionSanitize(o.region) ?? { ...COLORFIX_REGION_DEFAULT, mode: 'point' as const }
  // 选区图层不允许是整图（没有意义，也会和底层混淆）
  if (!base && region.mode === 'whole') region.mode = 'point'
  const autoName = o.autoName !== false
  const px = o.kind === 'pixel' ? pixelSanitize(o.pixel) : null
  if (px) {
    const name =
      typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 24) : base ? '整图' : '像素层'
    return { ...makePixelLayer(id, base ? '整图' : name, px), autoName: false, visible: o.visible !== false }
  }
  const adjust = adjustSanitize(o.adjust)
  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 24) : base ? '整图' : autoLayerName(region, index)
  return {
    id,
    name: base ? '整图' : name,
    autoName,
    visible: o.visible !== false,
    params,
    region,
    recolor: recolorSanitize(o.recolor),
    // 全零且没开保护肤色的不留（与没有这个字段等价）
    ...(adjust && (!adjustIsZero(adjust) || adjust.skin) ? { adjust } : {}),
  }
}

/** 任意来源的图层包 → 合法图层列表（底层补在最前、重复 id 去掉、超出上限截断）；不认识返回 null */
export function layersSanitize(raw: unknown): ColorFixLayerStack | null {
  let v = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.layers)) return null
  const seen = new Set<string>()
  const list: ColorFixLayer[] = []
  o.layers.forEach((item, i) => {
    const l = layerSanitize(item, i)
    if (!l || seen.has(l.id)) return
    seen.add(l.id)
    list.push(l)
  })
  const baseAt = list.findIndex(isBaseLayer)
  const base = baseAt >= 0 ? list.splice(baseAt, 1)[0]! : makeBaseLayer(COLORFIX_ZERO)
  const layers = [base, ...list].slice(0, COLORFIX_LAYERS_MAX)
  const selected = typeof o.selected === 'string' && layers.some((l) => l.id === o.selected) ? o.selected : undefined
  return { v: COLORFIX_LAYERS_VERSION, layers, ...(selected ? { selected } : {}), ...(layersHavePixel(layers) ? { hasPixelLayers: true } : {}) }
}

/** 旧版「一组参数 + 一个选区」→ 图层（见文件头） */
export function layersFromLegacy(params: ColorFixParams, region: ColorFixRegion | null | undefined): ColorFixLayer[] {
  const r = region ?? COLORFIX_REGION_DEFAULT
  if (r.mode === 'whole') return [makeBaseLayer(params)]
  return [
    makeBaseLayer(COLORFIX_ZERO),
    {
      id: LEGACY_LAYER_ID,
      name: autoLayerName(r, 1),
      autoName: true,
      visible: true,
      params: { ...params },
      region: { ...r },
      recolor: null,
    },
  ]
}

export interface LegacyShape {
  params: ColorFixParams
  region: ColorFixRegion
  /** true = 图层能无损折回旧形状（只有底层，或底层全零 + 一个没有替换颜色的选区图层） */
  exact: boolean
}

/**
 * 图层 → 旧形状（见文件头）。不可见的层当作不存在；折不回去时：参数 = 底层参数、
 * 选区 = 第一个生效选区图层的选区（老代码据此知道「这不是整图校色」，不会挂整图 CSS filter 糊弄）。
 */
export function legacyOf(layers: readonly ColorFixLayer[]): LegacyShape {
  const base = layers.find(isBaseLayer) ?? makeBaseLayer(COLORFIX_ZERO)
  const whole0: ColorFixRegion = { ...COLORFIX_REGION_DEFAULT, mode: 'whole' }
  // 有像素层：旧形状里没有「已栅格化的内容」，折不回去；旧字段只是近似（参数 = 零，选区 = 整图，老代码不会挂整图 CSS filter 糊弄）
  if (layersHavePixel(layers)) return { params: { ...COLORFIX_ZERO }, region: whole0, exact: false }
  const sel = layers.filter((l) => !isBaseLayer(l) && layerEffective(l))
  const whole: ColorFixRegion = { ...COLORFIX_REGION_DEFAULT, ...(layers.find((l) => !isBaseLayer(l))?.region ?? {}), mode: 'whole' }
  const baseVisible = base.visible ? base.params : COLORFIX_ZERO
  // 替换颜色 / 更多调整旧形状里没有：有它们就折不回去
  const extra = (l: ColorFixLayer) => recolorActive(l.recolor) || adjustActive(l.adjust)
  if (!sel.length) return { params: { ...baseVisible }, region: whole, exact: !extra(base) || !base.visible }
  if (sel.length === 1 && colorFixIsZero(baseVisible) && !extra(sel[0]!) && (!base.visible || !extra(base)))
    return { params: { ...sel[0]!.params }, region: { ...sel[0]!.region }, exact: true }
  return { params: { ...baseVisible }, region: { ...sel[0]!.region }, exact: false }
}

/** 两份图层是否等价（持久化去抖 / 签名用；比较会影响出图的字段 + 名字 / 可见性） */
export function layersEqual(a: readonly ColorFixLayer[], b: readonly ColorFixLayer[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    return (
      x.id === y.id &&
      x.name === y.name &&
      x.visible === y.visible &&
      x.kind === y.kind &&
      x.pixel?.pid === y.pixel?.pid &&
      colorFixEquals(x.params, y.params) &&
      JSON.stringify(x.region) === JSON.stringify(y.region) &&
      JSON.stringify(x.recolor) === JSON.stringify(y.recolor) &&
      JSON.stringify(x.adjust ?? null) === JSON.stringify(y.adjust ?? null)
    )
  })
}

/** 深拷贝（历史快照 / 复制图层用） */
export function cloneLayers(layers: readonly ColorFixLayer[]): ColorFixLayer[] {
  return layers.map((l) => ({
    ...l,
    params: { ...l.params },
    region: { ...l.region, ...(l.region.parts ? { parts: [...l.region.parts] } : {}) },
    recolor: l.recolor ? { ...l.recolor } : null,
    ...(l.adjust ? { adjust: cloneAdjust(l.adjust) } : {}),
    ...(l.pixel ? { pixel: { ...l.pixel } } : {}),
  }))
}

export function cloneAdjust(a: ColorFixAdjust): ColorFixAdjust {
  return {
    ...a,
    hsl: a.hsl.map((b) => ({ ...b })),
    ...(a.levels ? { levels: { ...a.levels } } : {}),
    ...(a.curves ? { curves: cloneCurves(a.curves) } : {}),
  }
}

/**
 * 这一层能不能带到别的图上（复制 / 粘贴校色参数、批量应用）：整图底层与「自动识别」图层可以（换图后重新识别），
 * 涂抹 / 点选的蒙版是对着这张图画的，带不走。
 */
export function layerTransferable(l: Pick<ColorFixLayer, 'id' | 'region' | 'kind'>): boolean {
  if (isPixelLayer(l)) return false
  return isBaseLayer(l) || l.region.mode === 'auto'
}

/** 图层是否需要本机蒙版（涂抹 / 点选）：这类出图不能按参数去重，换设备也还原不了 */
export function layersNeedLocalMask(layers: readonly ColorFixLayer[]): boolean {
  return layers.some(
    (l) => layerEffective(l) && (isPixelLayer(l) || (!isBaseLayer(l) && (l.region.mode === 'paint' || l.region.mode === 'point'))),
  )
}

/**
 * 像素层数据在 pixel-store 里的作用域：`<key>::px::<pid>::<full|preview>::<原图>`（以 `<key>::` 开头，clearStoredColorFix 一并清）。
 * full = 原图分辨率；preview = 预览分辨率副本（原图不大于预览尺寸时没有）。
 */
export function pixelScope(key: string, src: string, pid: string, kind: 'full' | 'preview'): string {
  return key && src && pid ? `${key}::px::${pid}::${kind}::${src}` : ''
}

/**
 * 图层的手动蒙版（涂抹 / 点选）在 mask-store 里的作用域：从旧版迁移来的那层沿用旧作用域（`<key>::<原图>` /
 * `<key>::point::<原图>`），其余 `<key>::<图层 id>::<方式>::<原图>`；都以 `<key>::` 开头，clearStoredColorFix 一并清。
 */
export function layerMaskScope(key: string, src: string, layerId: string, mode: 'paint' | 'point'): string {
  if (!src) return ''
  if (layerId === LEGACY_LAYER_ID) return mode === 'paint' ? `${key}::${src}` : `${key}::point::${src}`
  return `${key}::${layerId}::${mode}::${src}`
}
