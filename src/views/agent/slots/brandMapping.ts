/**
 * 做同款 · 品牌档案带入的映射规则（唯一一处）：按入参的 label / key / type，把档案字段对到入参。
 * 对不上的不填；已有值的位（用户填过、我的模板恢复）由调用方保护，这里只算「档案会填什么」。
 *
 * | 入参（label / key 命中）                     | type        | 档案字段                         |
 * | 门头 / 门店 / 店面 / 环境 / 店内 / 实景照片  | image       | storeImageUrls（门店实景图）      |
 * | Logo / 标志 / 商标                          | image       | logoUrl                          |
 * | 商品 / 菜品 / 产品 / 特色 图                 | image       | features[].imageUrls（特色项图）   |
 * | 店名 / 门店名 / 品牌名 / 商家名 / shopName   | text        | name                             |
 * | 价格 / 人均 / 单价 / price                   | price/number/text | avgPrice，缺则取首个套餐价    |
 * | 地址 / 位置 / address                        | text        | address                          |
 * | 电话 / 手机 / 联系方式 / phone               | text        | phone（现有档案表单没有，有才填）  |
 * | 主色 / 品牌色 / color                        | color       | color（同上，须是 #RRGGBB）       |
 */
import type { BrandProfileView } from '@/api/local-life-full.ts'
import { isVisible, type ISlot, type SlotValues } from './slotTypes.ts'

export type BrandField = 'storePhotos' | 'logo' | 'featurePhotos' | 'name' | 'price' | 'address' | 'phone' | 'color'

const has = (s: ISlot, re: RegExp) => re.test(s.label) || re.test(s.key)

/** 这个入参该取档案哪个字段；对不上返回 null */
export function brandFieldOf(s: ISlot): BrandField | null {
  if (s.type === 'image') {
    if (has(s, /logo|标志|商标/i)) return 'logo'
    if (has(s, /门头|门店|店面|店铺|门脸|环境|店内|实景|storefront|shop|front/i)) return 'storePhotos'
    if (has(s, /商品|菜品|产品|特色|product|dish/i)) return 'featurePhotos'
    return null
  }
  if (s.type === 'color') return has(s, /主色|品牌色|color|colour/i) ? 'color' : null
  if (s.type === 'price') return 'price'
  if (s.type === 'number') return has(s, /价格|人均|单价|price/i) ? 'price' : null
  if (s.type === 'text') {
    if (has(s, /价格|人均|单价|price/i)) return 'price'
    if (has(s, /地址|位置|address/i)) return 'address'
    if (has(s, /电话|手机|联系|phone|tel/i)) return 'phone'
    if (has(s, /店名|门店名|店铺名|商家名|品牌名|shopname|storename|brandname/i) || s.key === 'name') return 'name'
  }
  return null
}

function firstPrice(p: BrandProfileView): number | null {
  for (const raw of [p.avgPrice, p.meals?.find((m) => m.price)?.price]) {
    const n = parseFloat(String(raw ?? '').replace(/[^\d.]/g, ''))
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

/** 档案里这个字段的值，转成该入参能收的形状；取不到 / 超限 / 不合法 → undefined（不填） */
export function brandValueFor(s: ISlot, field: BrandField, p: BrandProfileView): unknown {
  const imgs = (list: string[]) => {
    const urls = [...new Set(list.filter((u) => /^https?:\/\//i.test(u)))].slice(0, s.maxCount ?? 1)
    return urls.length ? urls : undefined
  }
  const str = (v: string | undefined) => {
    const t = (v ?? '').trim()
    if (!t) return undefined
    // 超长宁可不填，也不替用户截断
    return [...t].length > (s.maxLength ?? 100) ? undefined : t
  }
  switch (field) {
    case 'storePhotos':
      return imgs(p.images.filter((i) => i.role === 'store').map((i) => i.url))
    case 'logo':
      return imgs(p.logoUrl ? [p.logoUrl] : [])
    case 'featurePhotos':
      return imgs(p.images.filter((i) => i.role === 'feature').map((i) => i.url))
    case 'name':
      return str(p.title)
    case 'address':
      return str(p.address)
    case 'phone':
      return str(p.phone)
    case 'color':
      return p.color && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : undefined
    case 'price': {
      const n = firstPrice(p)
      if (n == null) return undefined
      if (s.type === 'text') return str(String(n))
      if (s.min != null && n < s.min) return undefined
      if (s.max != null && n > s.max) return undefined
      return n
    }
  }
}

/** 档案能填的所有入参：key → 值（只含可见位、有值的位） */
export function mapProfileToSlots(items: ISlot[], values: SlotValues, p: BrandProfileView): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of items) {
    if (!isVisible(s, values)) continue
    const f = brandFieldOf(s)
    if (!f) continue
    const v = brandValueFor(s, f, p)
    if (v !== undefined) out[s.key] = v
  }
  return out
}

/** 这个模板有没有可由档案带入的位（决定提示条显不显示） */
export const hasBrandSlots = (items: ISlot[]) => items.some((s) => brandFieldOf(s) !== null)
