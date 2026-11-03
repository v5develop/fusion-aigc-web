/** 商拍工作室套件共享常量与展示辅助 */

import type { StudioKind, StudioTask } from '@/api/studioTypes.ts'

// ---------------- 选项 ----------------

/** 生图模型四档：label 为页面展示名，value 为传值（空 = 通用） */
export const MODEL_OPTIONS = [
  { label: '通用', value: '通用' },
  { label: 'GPT Image 2', value: 'GPT' },
  { label: 'Nano Banana Pro', value: 'Banana' },
  { label: 'Seedream 5 Pro', value: 'Seedream' },
]

export const RESOLUTION_OPTIONS = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
]

/** 比例 10 档；tryon / pose 另加「自动」（空 = 按输入图比例取最近档） */
export const ASPECT_RATIO_OPTIONS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].map(
  (v) => ({ label: v, value: v }),
)

/** 张数 1–9（商拍每位模特张数 / 图片生成张数共用） */
export const COUNT_OPTIONS = Array.from({ length: 9 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))

// ---------------- 商拍换装：单品 ----------------

export interface StudioOutfitItem {
  key: string
  label: string
  length: string[]
  sleeve: string[]
}

/** 单品 1–3 件；length / sleeve 为该单品可选的长度 / 袖长档（空数组 = 无此参数） */
export const OUTFIT_ITEMS: StudioOutfitItem[] = [
  {
    key: 'top',
    label: '上衣',
    length: ['及腰', '及胯', '遮臀', '长款'],
    sleeve: ['无袖', '短袖', '五分袖', '七分袖', '长袖'],
  },
  {
    key: 'bottom',
    label: '下装',
    length: ['短裤', '五分裤', '七分裤', '九分裤', '长裤', '短裙', '中裙', '长裙'],
    sleeve: [],
  },
  {
    key: 'dress',
    label: '连衣裙',
    length: ['膝上', '及膝', '小腿中部', '及踝', '及地'],
    sleeve: ['无袖', '短袖', '五分袖', '七分袖', '长袖'],
  },
  {
    key: 'outer',
    label: '外套',
    length: ['短款', '中长', '长款'],
    sleeve: ['无袖', '短袖', '五分袖', '七分袖', '长袖'],
  },
  { key: 'shoes', label: '鞋子', length: [], sleeve: [] },
  { key: 'accessory', label: '配饰', length: [], sleeve: [] },
  { key: 'bra', label: '文胸', length: [], sleeve: [] },
  { key: 'panties', label: '内裤', length: [], sleeve: [] },
]

export const OUTFIT_MAP: Record<string, StudioOutfitItem> = Object.fromEntries(OUTFIT_ITEMS.map((i) => [i.key, i]))

/** 单品互斥（双向表）：连衣裙↔上衣/下装、文胸↔上衣/连衣裙、内裤↔下装/连衣裙 */
export const OUTFIT_CONFLICTS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {}
  for (const [a, b] of [
    ['dress', 'top'],
    ['dress', 'bottom'],
    ['bra', 'top'],
    ['bra', 'dress'],
    ['panties', 'bottom'],
    ['panties', 'dress'],
  ] as const) {
    ;(map[a] = map[a] ?? []).push(b)
    ;(map[b] = map[b] ?? []).push(a)
  }
  return map
})()

export const MAX_ITEMS = 3
export const MAX_GARMENT_IMAGES = 9
export const MAX_GARMENT_PER_ROLE = 6
export const MAX_MODEL_IMAGES = 9
export const MAX_POSE_IMAGES = 9
export const MAX_REF_IMAGES = 9

/** 服装图角度：中文 label ↔ 接口传值 */
export const ANGLE_OPTIONS = [
  { label: '正面', value: 'front' },
  { label: '背面', value: 'back' },
  { label: '侧面', value: 'side' },
  { label: '细节', value: 'detail' },
  { label: '平铺', value: 'flat' },
  { label: '其他', value: 'unknown' },
]

/** 新增服装图的默认角度：按组内顺次占用 */
export const ANGLE_SEQUENCE = ['front', 'back', 'side', 'detail', 'flat', 'unknown'] as const

// ---------------- 状态文案 ----------------

/** 语义类型 → UnoCSS 字面量 class（UnoCSS 只扫源码字面量，不能运行时拼接） */
export const CHIP_CLS: Record<string, string> = {
  running: 'll-chip-running',
  success: 'll-chip-success',
  error: 'll-chip-error',
  warning: 'll-chip-warning',
}

/** 批次状态：0 排队 / 1 切图中 / 2 反推中 / 3 生图中 / 4 全部成功 / 5 全部失败 / 6 部分成功 / 7 已取消 / 8 提交中 */
export const BATCH_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' | 'warning' }> = {
  0: { label: '排队中', type: 'running' },
  1: { label: '切图中', type: 'running' },
  2: { label: '反推中', type: 'running' },
  3: { label: '生图中', type: 'running' },
  4: { label: '全部成功', type: 'success' },
  5: { label: '全部失败', type: 'error' },
  6: { label: '部分成功', type: 'warning' },
  7: { label: '已取消', type: 'warning' },
  8: { label: '提交中', type: 'running' },
}

/** 任务状态：0 排队 / 1 生成中 / 5 交付中 / 2 成功 / 3 失败 / 4 已取消 */
export const TASK_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' | 'warning' }> = {
  0: { label: '排队', type: 'running' },
  1: { label: '生成中', type: 'running' },
  5: { label: '交付中', type: 'running' },
  2: { label: '成功', type: 'success' },
  3: { label: '失败', type: 'error' },
  4: { label: '已取消', type: 'warning' },
}

// ---------------- 判定与辅助 ----------------

/** 终态 = 4–7（8 是提交中，不是终态；不要写成 >=4） */
export const isBatchTerminal = (status: number) => status >= 4 && status <= 7

/** 批次状态 chip：label + 字面量 class */
export function batchChip(status: number) {
  const info = BATCH_STATUS_MAP[status]
  return { label: info?.label ?? '未知', cls: CHIP_CLS[info?.type ?? 'running'] ?? 'll-chip-running' }
}

/** 任务状态 chip：label + 字面量 class */
export function taskChip(status: number) {
  const info = TASK_STATUS_MAP[status]
  return { label: info?.label ?? '未知', cls: CHIP_CLS[info?.type ?? 'running'] ?? 'll-chip-running' }
}

/** 批次进度 = (task_done + task_failed) / task_total，0–100 */
export function batchProgress(batch: { task_total: number; task_done: number; task_failed: number }) {
  if (!batch.task_total) return 0
  return Math.round(((batch.task_done + batch.task_failed) / batch.task_total) * 100)
}

export const KIND_LABEL: Record<StudioKind, string> = {
  tryon: '商拍换装',
  pose: '姿态复刻',
  imagegen: '图片生成',
}

/** 任务备注行：商拍=模特 N · 第 M 张；姿态=「姿态复刻 · 姿势 N」（s1.1 E6）；图片生成=第 N 张 */
export function taskCaption(task: StudioTask) {
  if (task.kind === 'tryon') return `模特${task.model_index + 1} · 第${task.shot_index + 1}张`
  if (task.kind === 'pose') return `姿态复刻 · 姿势 ${task.pose_index + 1}`
  return `第${task.shot_index + 1}张`
}

export function formatTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
