/**
 * 校色参数剪贴板（2026-11-11）：「复制校色参数」把当前整套图层存成一份预设，「粘贴校色参数」/ 资产库「应用校色」把它套到别的图上。
 *
 * <p>预设 = 图层本身（不含蒙版，图层里本来就只有参数与选区描述）。能带到别的图上的只有整图底层与「自动识别」图层
 * （换图后按同一识别目标 / 部位重新识别）；涂抹 / 点选的蒙版是对着原图画的，复制时照样记下（便于列出「哪些层带不走」），
 * 粘贴 / 批量应用时跳过。
 *
 * <p>存在 localStorage（同一浏览器跨页面 / 跨标签页可用，`storage` 事件同步），读写失败只是剪贴板不可用，不影响校色本身。
 */
import { ref } from 'vue'
import { COLORFIX_ZERO } from '@/utils/colorfix-math.ts'
import { COLORFIX_REGION_LABELS, COLORFIX_TARGET_LABELS } from './types.ts'
import {
  COLORFIX_LAYERS_MAX,
  cloneLayers,
  isBaseLayer,
  isPixelLayer,
  layerEffective,
  layerTransferable,
  makeBaseLayer,
  layersSanitize,
  newLayerId,
  type ColorFixLayer,
} from './layers.ts'

const STORAGE_KEY = 'colorfix:preset-clipboard'
export const COLORFIX_PRESET_VERSION = 1

export interface ColorFixPreset {
  v: number
  /** 完整图层（含带不走的，见文件头）；第一层恒为整图底层 */
  layers: ColorFixLayer[]
  /** 复制时间（ms） */
  at: number
}

export function presetSanitize(raw: unknown): ColorFixPreset | null {
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
  // 更新版本写进来的剪贴板（别的标签页跑着新代码）：本版本读不懂，当作没有，免得丢字段后误套
  if (typeof o.v === 'number' && o.v > COLORFIX_PRESET_VERSION) return null
  const stack = layersSanitize({ layers: o.layers })
  if (!stack) return null
  return { v: COLORFIX_PRESET_VERSION, layers: stack.layers, at: typeof o.at === 'number' ? o.at : 0 }
}

function readStored(): ColorFixPreset | null {
  try {
    return presetSanitize(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

/** 当前剪贴板里的预设（响应式）；null = 还没复制过 */
export const colorFixClipboard = ref<ColorFixPreset | null>(typeof window === 'undefined' ? null : readStored())

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) colorFixClipboard.value = readStored()
  })
}

export interface PresetLayerRow {
  layer: ColorFixLayer
  /** 能带到别的图上 */
  transferable: boolean
  /** 会改图（可见且调过） */
  effective: boolean
  /** 一句话说明：选区来源 + 为什么带不走 / 不生效 */
  note: string
}

/** 预设逐层说明（粘贴确认 / 批量弹窗列表用），顺序与图层一致（底层在前） */
export function presetRows(preset: ColorFixPreset): PresetLayerRow[] {
  return preset.layers.map((l) => {
    const transferable = layerTransferable(l)
    const effective = layerEffective(l)
    let note: string
    if (isPixelLayer(l)) note = '像素层（向下合并的产物）：内容属于原图，不能带走'
    else if (isBaseLayer(l)) note = '整幅图片'
    else if (l.region.mode === 'auto') note = `自动识别 · ${COLORFIX_TARGET_LABELS[l.region.target]}，每张图重新识别`
    else note = `${COLORFIX_REGION_LABELS[l.region.mode]}：手动选区只属于原图，不能带走`
    if (transferable && !l.visible) note += '（已隐藏，不生效）'
    else if (transferable && !effective) note += '（没有调整，不生效）'
    return { layer: l, transferable, effective, note }
  })
}

export interface CopyResult {
  total: number
  /** 带不走的层数（涂抹 / 点选） */
  skipped: number
}

/** 复制：把整套图层写进剪贴板 */
export function copyColorFixPreset(layers: readonly ColorFixLayer[]): CopyResult {
  const preset: ColorFixPreset = { v: COLORFIX_PRESET_VERSION, layers: cloneLayers(layers), at: Date.now() }
  colorFixClipboard.value = preset
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preset))
  } catch {
    /* 存储满 / 隐私模式：本页内仍可粘贴 */
  }
  return { total: layers.length, skipped: layers.filter((l) => !layerTransferable(l)).length }
}

/**
 * 粘贴用的图层：底层 + 能带走的选区图层（新 id，蒙版要在新图上重新识别），不超过图层上限。
 * skipped = 因为带不走被丢掉的层数。
 */
export function presetLayersForPaste(preset: ColorFixPreset): { layers: ColorFixLayer[]; skipped: number } {
  const all = cloneLayers(preset.layers)
  // 底层是像素层（合并进了整图）：内容带不走，换回零参数的整图底层
  const base0 = all.find(isBaseLayer)!
  const base = isPixelLayer(base0) ? makeBaseLayer(COLORFIX_ZERO) : base0
  const rest = all.filter((l) => !isBaseLayer(l))
  const keep = rest.filter(layerTransferable).map((l) => ({ ...l, id: newLayerId() }))
  return { layers: [base, ...keep].slice(0, COLORFIX_LAYERS_MAX), skipped: rest.length - keep.length }
}

/** 批量应用用的图层：粘贴口径 + 只留会改图的选区图层（底层总在，零参数时不改图） */
export function presetLayersForApply(preset: ColorFixPreset): ColorFixLayer[] {
  const { layers } = presetLayersForPaste(preset)
  return layers.filter((l) => isBaseLayer(l) || layerEffective(l))
}

/** 预设会不会改图（批量应用前判断「没有可应用的调整」） */
export function presetHasEffect(preset: ColorFixPreset | null | undefined): boolean {
  return !!preset && presetLayersForApply(preset).some(layerEffective)
}
