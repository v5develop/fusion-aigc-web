/**
 * 校色参考图与「单品」切换（2026-11-12，吸收 5186 原型「校色浮卡」的价值）。
 *
 * <p>宿主把一组参考图交给 useResultColorFix（`references`）：每条 = 一件单品的参考图（商拍换装 = 原服装图）。
 * 校色时它以浮卡（ColorFixReferenceCard）显示，用户肉眼对色；带 `part` 的参考图同时是「单品」——
 * 切换单品 = 选中（没有就按「自动识别 · 服装 · 该部位」新建）对应图层，图上点到那件衣服也一样（{@link pickPiece}）。
 *
 * <p>数据形状通用：`{ key, label, url, part?, details? }`，不绑定商拍；别的表面以后传同样的数组即可。
 * 本文件无 DOM 依赖的只有类型与 {@link referenceParts}；{@link useColorFixPieces} 是按 cf 共享的单品状态
 * （浮卡、图上点选、全屏层共用同一份，免得各算各的）。
 */
import { computed, effectScope, ref, type ComputedRef } from 'vue'
import { colorFixMaskAlpha } from '@/utils/colorfix.ts'
import { isSelectionLayer, layerEffective, type ColorFixLayer } from './layers.ts'
import { colorFixPartsEqual, colorFixPartsSanitize, type ColorFixGarmentPart } from './types.ts'
import type { ResultColorFix } from './useResultColorFix.ts'

/** 参考图的补充视角（同一件单品的其它角度 / 细节图） */
export interface ColorFixReferenceDetail {
  key: string
  label: string
  url: string
}

/** 一件单品的参考图 */
export interface ColorFixReference {
  /** 唯一键（如单品编码 top / bottom） */
  key: string
  /** 给人看的名字：上装 / 下装 / 外套 … */
  label: string
  /** 主参考图地址 */
  url: string
  /** 对应的服装部位（商拍：mask-parts 的映射）；缺省 = 只做对色，不参与图层切换 */
  part?: ColorFixGarmentPart | readonly ColorFixGarmentPart[]
  /** 其它角度 / 细节图（浮卡里可切换） */
  details?: readonly ColorFixReferenceDetail[]
}

/** 参考图的部位（固定顺序、去重；没有 = []） */
export function referenceParts(r: Pick<ColorFixReference, 'part'>): ColorFixGarmentPart[] {
  if (!r.part) return []
  return colorFixPartsSanitize(Array.isArray(r.part) ? r.part : [r.part])
}

/** 单品命中检测用的蒙版 alpha 长边：只判断点在不在里面，不必精细 */
const HIT_SIDE = 512
/** 蒙版 alpha 缓存上限（按地址；蒙版是 blob / 公开地址，换图后旧地址自然不会再被问到） */
const ALPHA_CACHE_MAX = 24

export interface ColorFixPieces {
  /** 有可用的参考图（浮卡出现） */
  hasReferences: ComputedRef<boolean>
  references: ComputedRef<ColorFixReference[]>
  /** 当前单品的键（选中的图层对应哪件就是哪件；没对应的取上次手选，再退回第一件） */
  activeKey: ComputedRef<string>
  active: ComputedRef<ColorFixReference | null>
  /** 这件单品是不是调过（它的图层存在且有非零调整） */
  adjusted: (key: string) => boolean
  /** 切到这件单品：已有图层就选中，没有就按部位新建一层「自动识别」图层；没有部位只切浮卡 */
  select: (key: string) => void
  /** 图上点选单品可用：有带部位的参考图 */
  pickable: ComputedRef<boolean>
  /** 图上 (nx, ny)（0–1，相对整张图）落在哪件单品的区域里并切过去；没命中 / 蒙版读不了 = false */
  pickPiece: (nx: number, ny: number) => Promise<boolean>
}

const shared = new WeakMap<object, ColorFixPieces>()

/** 某图层是不是「自动识别 · 服装 · 这些部位」 */
function layerIsPieceOf(l: ColorFixLayer, parts: readonly ColorFixGarmentPart[]): boolean {
  return (
    isSelectionLayer(l) &&
    l.region.mode === 'auto' &&
    l.region.target === 'garment' &&
    parts.length > 0 &&
    colorFixPartsEqual(colorFixPartsSanitize(l.region.parts), parts)
  )
}

/** 同一份 cf 共用一份单品状态（浮卡、图上点选、全屏层都问它） */
export function useColorFixPieces(cf: ResultColorFix): ColorFixPieces {
  const hit = shared.get(cf)
  if (hit) return hit
  // 脱离调用组件的作用域：先创建它的组件卸载不能把别处还在用的 computed 一起停掉
  const made = effectScope(true).run(() => build(cf))!
  shared.set(cf, made)
  return made
}

function build(cf: ResultColorFix): ColorFixPieces {
  const references = computed(() => cf.references.value.filter((r) => !!r.key && !!r.url))
  const hasReferences = computed(() => references.value.length > 0)
  const chosen = ref('')

  const layerOf = (r: ColorFixReference): ColorFixLayer | undefined => {
    const parts = referenceParts(r)
    return cf.layers.value.find((l) => layerIsPieceOf(l, parts))
  }

  const activeKey = computed(() => {
    const sel = cf.selectedLayer.value
    const byLayer = references.value.find((r) => layerIsPieceOf(sel, referenceParts(r)))
    if (byLayer) return byLayer.key
    if (references.value.some((r) => r.key === chosen.value)) return chosen.value
    return references.value[0]?.key ?? ''
  })
  const active = computed(() => references.value.find((r) => r.key === activeKey.value) ?? null)

  function adjusted(key: string): boolean {
    const r = references.value.find((x) => x.key === key)
    const l = r && layerOf(r)
    return !!l && layerEffective(l)
  }

  function select(key: string) {
    const r = references.value.find((x) => x.key === key)
    if (!r) return
    chosen.value = key
    const parts = referenceParts(r)
    if (!parts.length) return
    const l = layerOf(r)
    if (l) cf.selectLayer(l.id)
    else cf.addLayer('auto', { target: 'garment', parts })
  }

  const pickable = computed(() => references.value.some((r) => referenceParts(r).length > 0))

  const alphas = new Map<string, Promise<{ data: Uint8Array; width: number; height: number } | null>>()
  function alphaOf(url: string) {
    let p = alphas.get(url)
    if (!p) {
      if (alphas.size >= ALPHA_CACHE_MAX) alphas.clear()
      p = colorFixMaskAlpha(url, { maxSide: HIT_SIDE }).catch(() => null)
      alphas.set(url, p)
    }
    return p
  }

  /** 这件单品当前能拿到的蒙版：它的图层已识别好的优先，其次任务自带的逐件蒙版 */
  function maskOf(r: ColorFixReference): string {
    const parts = referenceParts(r)
    const l = layerOf(r)
    return (l && cf.layerMask(l.id)) || cf.presetMaskFor(parts)
  }

  let pickTicket = 0
  async function pickPiece(nx: number, ny: number): Promise<boolean> {
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false
    const my = ++pickTicket
    const cands = references.value.filter((r) => referenceParts(r).length > 0 && maskOf(r))
    const hits: string[] = []
    for (const r of cands) {
      const a = await alphaOf(maskOf(r))
      if (my !== pickTicket) return false
      if (!a) continue
      const x = Math.min(a.width - 1, Math.floor(nx * a.width))
      const y = Math.min(a.height - 1, Math.floor(ny * a.height))
      if ((a.data[y * a.width + x] ?? 0) >= 128) hits.push(r.key)
    }
    if (!hits.length) return false
    // 区域重叠（如外套罩着上衣）：连点轮流切，不卡在同一件上
    const cur = hits.indexOf(activeKey.value)
    select(hits[cur >= 0 ? (cur + 1) % hits.length : 0]!)
    return true
  }

  return { hasReferences, references, activeKey, active, adjusted, select, pickable, pickPiece }
}
