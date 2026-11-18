/** 视频做同款的页面常量与小函数（文案取自 video-replicate-agent/EXPERIENCE.md §4 文案表） */
import type { VideoCloneDimKey } from '@/api/replicate.ts'

/** 「视频里的这些地方」的名称；不出现「维度」二字 */
export const DIM_LABEL: Record<VideoCloneDimKey, string> = {
  model: '人物',
  garment: '服装',
  accessory: '配饰',
  product: '商品',
  motion: '动作',
  expression: '表情',
  line: '台词',
  camera: '镜头',
  light: '光线',
  scene: '场景·门店',
  style: '风格',
}

export type SlotKey = 'person' | 'product' | 'garment' | 'scene'
/** 素材的类别：四类对应各自的「换成我的图」，other = 不参与替换 */
export type AssetKind = SlotKey | 'other'

export const KIND_LABEL: Record<AssetKind, string> = {
  person: '人物',
  product: '商品',
  garment: '服装',
  scene: '场景·门店',
  other: '其他',
}
export const KIND_ORDER: AssetKind[] = ['person', 'product', 'garment', 'scene', 'other']

/** 素材区最多放几张（引擎上限 9） */
export const MAX_ASSETS = 9
/** 「想怎么改」最长字数 */
export const WISH_MAX = 300

export const SLOTS: { key: SlotKey; label: string; hint: string }[] = [
  { key: 'person', label: '人物', hint: '放上技师或店员的正脸照' },
  { key: 'product', label: '商品', hint: '放一张正面清晰的就行' },
  { key: 'garment', label: '服装', hint: '放一张服装的正面图' },
  { key: 'scene', label: '场景·门店', hint: '放上你的门店照片（门头、店内环境）' },
]

/** 哪些地方可以「换成我的图」，以及要用哪个槽位里的图 */
export const DIM_SLOT: Partial<Record<VideoCloneDimKey, SlotKey>> = {
  model: 'person',
  product: 'product',
  accessory: 'product',
  garment: 'garment',
  scene: 'scene',
}

/** 「想换什么」快捷项 → 它会勾上的地方 */
export const INTENTS: { label: string; dims: VideoCloneDimKey[] }[] = [
  { label: '换商品', dims: ['product'] },
  { label: '换人', dims: ['model'] },
  { label: '换服装', dims: ['garment'] },
  { label: '换场景·门店', dims: ['scene'] },
]

export const MISSING_SLOT_TEXT: Record<SlotKey, string> = {
  product: '要把商品换掉，需要一张你的商品图。放一张正面清晰的就行',
  person: '换人需要一张人物正脸照，生成才稳定',
  garment: '换服装需要一张服装图',
  scene: '要换场景，需要一张门店照片',
}

export const mm = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export const fmtPts = (n: number) => n.toLocaleString('en-US')
