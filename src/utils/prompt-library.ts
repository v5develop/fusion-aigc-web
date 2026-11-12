/**
 * 提示词库的纯函数：二级分类中文名兜底、摘要、插入时的拼接截断。
 * 分类中文名以后端返回的 label / groupLabel 为准；这张表只在后端没带时兜底（与后端 PromptGroupOrder 同口径）。
 */

export const PROMPT_GROUP_LABELS: Record<string, string> = {
  model: '模特 / 人像',
  scene: '场景',
  product: '商品图 / 主图',
  detail: '详情页',
  apparel: '服装',
  photo: '摄影 / 光线',
  composition: '构图 / 镜头',
  style: '风格 / 艺术',
  material: '材质 / 质感',
  text: '文字 / 排版',
  mine: '我的',
  favorite: '我的收藏',
}

/** 展示顺序（未登记的 key 排在最后） */
const GROUP_ORDER = Object.keys(PROMPT_GROUP_LABELS)

export function promptGroupLabel(key: string, label?: string): string {
  return label || PROMPT_GROUP_LABELS[key] || key
}

export function promptGroupRank(key: string): number {
  const i = GROUP_ORDER.indexOf(key)
  return i < 0 ? GROUP_ORDER.length : i
}

/** 卡片摘要：折叠空白，最多 84 字（原型口径），再由 line-clamp-3 兜住视觉 */
export function promptSummary(text: string, max = 84): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export const PROMPT_MAX_LEN = 3000

/**
 * 把提示词接到已有文本后面：已有内容去掉末尾空白后换行再接（原型口径）；超过 3000 字截断。
 * 空的已有内容直接用提示词本身。
 */
export function joinPrompt(current: string, prompt: string, max = PROMPT_MAX_LEN): { text: string; truncated: boolean } {
  const base = current.trimEnd()
  const merged = base ? `${base}\n${prompt}` : prompt
  return merged.length > max ? { text: merged.slice(0, max), truncated: true } : { text: merged, truncated: false }
}
