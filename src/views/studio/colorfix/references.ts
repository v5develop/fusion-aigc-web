/**
 * 商拍换装的校色参考图：批次 payload（提交快照，JSON 文本）里的 items + garmentImages → 校色浮卡的参考图列表
 * （components/ColorFix/references.ts 的 ColorFixReference）。
 *
 * <p>每件单品一条：label = 单品中文名，part = 它的服装部位（与 mask-parts 同一张表，用于按单品切换校色图层），
 * url = 该单品的主图（优先正面 / 平铺 / 未标角度），其余角度 / 细节图进 details。图按 role（单品中文名）归属；
 * 某单品没有自己的图时退回「整套」图。没有服装图 / 解析失败 / 不是商拍 → []（浮卡不出现）。
 * 细节框（detailCrops）只有归一化坐标没有图，这里不展示。
 */
import type { ColorFixReference } from '@/components/ColorFix/references.ts'
import type { StudioGarmentImage } from '@/api/studio-types.ts'
import { tryonItemParts } from './mask-parts.ts'
import { parseStudioPayload } from '../payload.ts'

/** 单品编码 → 提交时 garmentImages[].role 用的中文名（同时是浮卡页签名） */
const ITEM_LABEL: Record<string, string> = {
  top: '上衣',
  bottom: '下装',
  dress: '连衣裙',
  outer: '外套',
  shoes: '鞋子',
  accessory: '配饰',
  bra: '文胸',
  panties: '内裤',
}
const SET_ROLE = '整套'

const ANGLE_LABEL: Record<string, string> = { front: '正面', back: '背面', side: '侧面', detail: '细节', flat: '平铺' }
/** 作主图的角度优先级：正面 / 平铺 / 未标 > 其它 */
const MAIN_RANK = (angle?: string) => (!angle || angle === 'unknown' ? 1 : angle === 'front' ? 0 : angle === 'flat' ? 1 : 2)

export function tryonReferences(payload: string | undefined | null): ColorFixReference[] {
  const o = parseStudioPayload(payload) as { items?: unknown; garmentImages?: unknown }
  if (!Array.isArray(o.items) || !Array.isArray(o.garmentImages)) return []
  const images = (o.garmentImages as Partial<StudioGarmentImage>[]).filter(
    (g): g is StudioGarmentImage => !!g && typeof g.url === 'string' && !!g.url,
  )
  const seen = new Set<string>()
  const out: ColorFixReference[] = []
  for (const raw of o.items) {
    const code = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    const label = ITEM_LABEL[code]
    if (!label || seen.has(code)) continue
    seen.add(code)
    const own = images.filter((g) => g.role === label)
    const pool = own.length ? own : images.filter((g) => g.role === SET_ROLE)
    if (!pool.length) continue
    const sorted = [...pool].sort((a, b) => MAIN_RANK(a.angle) - MAIN_RANK(b.angle))
    const [main, ...rest] = sorted as [StudioGarmentImage, ...StudioGarmentImage[]]
    const part = tryonItemParts(JSON.stringify({ items: [code] }))
    out.push({
      key: code,
      label,
      url: main.url,
      ...(part.length ? { part } : {}),
      ...(rest.length
        ? {
            details: rest.map((g, i) => ({
              key: `${code}:${i}`,
              label: ANGLE_LABEL[g.angle ?? ''] ?? `图 ${i + 2}`,
              url: g.url,
            })),
          }
        : {}),
    })
  }
  return out
}
