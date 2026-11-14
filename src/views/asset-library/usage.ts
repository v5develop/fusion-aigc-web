/**
 * 资产分类（kind）前端口径：槽位名 → 默认 kind（素材库选择器用）与标签上限。
 * 取值与展示名见 api/asset-library.ts 的 ASSET_KINDS；这里只放映射规则，规则是数据（数组），加一条就多一个映射。
 */

/** 槽位 label 命中任一关键词就取对应 kind；自上而下先中先得 */
const SLOT_KIND_RULES: { kind: string; words: RegExp }[] = [
  { kind: 'storefront', words: /门头|门店|店面|招牌|外立面/ },
  { kind: 'dish', words: /菜品|菜|餐品|美食/ },
  { kind: 'logo', words: /logo/i },
  { kind: 'model', words: /人物|模特|人像|技师|店长/ },
  { kind: 'scene', words: /环境|场景|氛围|大堂|包间/ },
  { kind: 'product', words: /商品|产品|套餐|主图/ },
]

/** 智能体图片位的 label → 默认 kind；映射不到返回空串（= 不预选，列全部） */
export function kindForSlotLabel(label: string | undefined | null): string {
  const s = (label ?? '').trim()
  if (!s) return ''
  return SLOT_KIND_RULES.find((r) => r.words.test(s))?.kind ?? ''
}

/** 用户标签数量 / 长度上限（契约）。系统标签只读，卡片 / 详情里按 sysTags 数组区分，不靠名字 */
export const MAX_TAGS_PER_ASSET = 20
export const TAG_NAME_MAX = 32
