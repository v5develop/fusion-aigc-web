/**
 * 商拍换装单品 → 校色「服装部位」（与服务端 studio-rpc tryonItemParts 同一张表）：
 * top / bra → 上衣，bottom / panties → 下装，dress → 裙装，outer → 外套，shoes → 鞋，accessory → 包 + 帽。
 * 用于商拍成品的默认选区「自动识别 · 服装 · 所选单品」。
 */
import { colorFixPartsSanitize, type ColorFixGarmentPart } from '@/components/ColorFix/types.ts'
import { parseStudioPayload } from '../payload.ts'

const ITEM_PARTS: Record<string, ColorFixGarmentPart[]> = {
  top: ['tops'],
  bra: ['tops'],
  bottom: ['pants'],
  panties: ['pants'],
  dress: ['skirt'],
  outer: ['coat'],
  shoes: ['shoes'],
  accessory: ['bag', 'hat'],
}

/** 批次 payload（JSON 文本）里的 items → 部位（固定顺序）；不是商拍 / 解析失败 / 都映射不上 → []（全部服装） */
export function tryonItemParts(payload: string | undefined | null): ColorFixGarmentPart[] {
  const items = parseStudioPayload(payload).items
  if (!Array.isArray(items)) return []
  return colorFixPartsSanitize(
    items.flatMap((it) => (typeof it === 'string' ? (ITEM_PARTS[it.trim().toLowerCase()] ?? []) : [])),
  )
}
