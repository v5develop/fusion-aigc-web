/**
 * 模板入参（slots）：模板详情 / 做同款准备接口下发 `slots: { schemaVersion: 1, items: Slot[] }`，
 * 输入区按它动态渲染；提交时值按 `{ inputs: { key: value } }` 带上（image / video 传地址数组）。
 *
 * 校验与服务端同口径：必填、数量、长度、范围、选项合法；visibleWhen 不满足的槽位不显示、不校验、不提交。
 * 未知 type 或 schemaVersion > 1 → 整个表单降级成一句提示，不崩溃；没有 slots 的旧模板保持单图位行为。
 */
export const SLOT_SCHEMA_VERSION = 1

export type SlotType =
  | 'image'
  | 'video'
  | 'text'
  | 'textarea'
  | 'price'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'switch'
  | 'color'

const KNOWN: readonly string[] = [
  'image', 'video', 'text', 'textarea', 'price', 'number', 'select', 'multiselect', 'switch', 'color',
]

export interface SlotOption {
  value: string
  label: string
}

export interface ISlot {
  key: string
  type: SlotType
  label: string
  help?: string
  placeholder?: string
  required?: boolean
  default?: unknown
  order?: number
  group?: string
  // image / video
  minCount?: number
  maxCount?: number
  guidance?: string
  exampleUrl?: string
  acceptRatio?: string
  maxDurationSec?: number
  // text / textarea
  maxLength?: number
  /** 原样透传，前端不解释 */
  layout?: unknown
  // number / price
  min?: number
  max?: number
  step?: number
  unit?: string
  // select / multiselect（multiselect 可带 maxCount：1~选项数）
  options?: SlotOption[]
  visibleWhen?: { key: string; equals: unknown }
}

export interface ISlotsSchema {
  schemaVersion: number
  items: ISlot[]
}

export type SlotValues = Record<string, unknown>

export type ParsedSlots =
  | { status: 'none' }
  | { status: 'unsupported' }
  | { status: 'ok'; items: ISlot[] }

/** 解析接口下发的 slots：没有 → none；版本更高 / 有未知 type / 结构坏 → unsupported；否则按 order 排好 */
export function parseSlots(raw: unknown): ParsedSlots {
  if (raw == null) return { status: 'none' }
  // Go 存库 / 文档写 `slots`，对外契约写 `items`：两个都认
  const o = raw as { schemaVersion?: unknown; items?: unknown; slots?: unknown }
  const list = Array.isArray(o?.items) ? o.items : Array.isArray(o?.slots) ? o.slots : null
  if (typeof o !== 'object' || typeof o.schemaVersion !== 'number' || !list) return { status: 'unsupported' }
  if (o.schemaVersion > SLOT_SCHEMA_VERSION) return { status: 'unsupported' }
  if (!list.length) return { status: 'none' }
  const s = { items: list as ISlot[] }
  for (const it of s.items) {
    if (!it || typeof it.key !== 'string' || !KNOWN.includes(String(it.type))) return { status: 'unsupported' }
  }
  const items = [...s.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return { status: 'ok', items }
}

export function isVisible(slot: ISlot, values: SlotValues): boolean {
  const w = slot.visibleWhen
  if (!w) return true
  return values[w.key] === w.equals
}

export function emptyValue(slot: ISlot): unknown {
  switch (slot.type) {
    case 'image':
    case 'video':
    case 'multiselect':
      return []
    case 'switch':
      return false
    case 'number':
    case 'price':
      return null
    default:
      return ''
  }
}

export function defaultValues(items: ISlot[]): SlotValues {
  const v: SlotValues = {}
  for (const s of items) v[s.key] = s.default !== undefined && s.default !== null ? s.default : emptyValue(s)
  return v
}

const isEmpty = (v: unknown) =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && Number.isNaN(v))

/** key → 错误文案；没有错误的不出现 */
export function validateSlots(items: ISlot[], values: SlotValues): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const s of items) {
    if (!isVisible(s, values)) continue
    const v = values[s.key]
    const L = s.label
    switch (s.type) {
      case 'image':
      case 'video': {
        const n = Array.isArray(v) ? v.length : 0
        const min = s.minCount ?? (s.required ? 1 : 0)
        const max = s.maxCount ?? 1
        const unit = s.type === 'image' ? '张' : '条'
        if (n < min) errs[s.key] = min <= 1 ? `先放一${unit}${L}` : `${L}至少放 ${min} ${unit}`
        else if (n > max) errs[s.key] = `${L}最多放 ${max} ${unit}`
        break
      }
      case 'text':
      case 'textarea': {
        const t = typeof v === 'string' ? v.trim() : ''
        // Go：maxLength 缺省时 text 100 / textarea 500，按字（rune）数
        const maxLen = s.maxLength ?? (s.type === 'text' ? 100 : 500)
        if (s.required && !t) errs[s.key] = `请填写${L}`
        else if ([...t].length > maxLen) errs[s.key] = `${L}最多 ${maxLen} 个字`
        break
      }
      case 'number':
      case 'price': {
        // Go：price 的 min 缺省为 0；有 step 时须是 step 的整倍数（从 min 起算）
        const min = s.min ?? (s.type === 'price' ? 0 : undefined)
        if (isEmpty(v)) {
          if (s.required) errs[s.key] = `请填写${L}`
        } else if (typeof v !== 'number') errs[s.key] = `${L}要填数字`
        else if (min != null && v < min) errs[s.key] = `${L}不能小于 ${min}`
        else if (s.max != null && v > s.max) errs[s.key] = `${L}不能大于 ${s.max}`
        else if (s.step && s.step > 0) {
          const k = (v - (min ?? 0)) / s.step
          if (Math.abs(k - Math.round(k)) > 1e-6) errs[s.key] = `${L}要是 ${s.step} 的整倍数`
        }
        break
      }
      case 'select': {
        if (isEmpty(v)) {
          if (s.required) errs[s.key] = `请选择${L}`
        } else if (s.options && !s.options.some((o) => o.value === v)) errs[s.key] = `请重新选择${L}`
        break
      }
      case 'multiselect': {
        const arr = Array.isArray(v) ? v : []
        if (s.required && !arr.length) errs[s.key] = `请选择${L}`
        else if (s.options && arr.some((x) => !s.options!.some((o) => o.value === x))) errs[s.key] = `请重新选择${L}`
        else if (s.maxCount && arr.length > s.maxCount) errs[s.key] = `${L}最多选 ${s.maxCount} 项`
        break
      }
      case 'color': {
        if (isEmpty(v)) {
          if (s.required) errs[s.key] = `请选择${L}`
        } else if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) errs[s.key] = `请重新选择${L}`
        break
      }
      default:
        break
    }
  }
  return errs
}

/** 提交用：只含可见槽位，文本去首尾空格，空值（可选未填）不带 */
export function buildInputs(items: ISlot[], values: SlotValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of items) {
    if (!isVisible(s, values)) continue
    let v = values[s.key]
    if (typeof v === 'string') v = v.trim()
    if (s.type !== 'switch' && isEmpty(v)) continue
    out[s.key] = v
  }
  return out
}

/** 「还差：…」给发送按钮旁的一句说明，只取第一条 */
export function missingText(items: ISlot[], errs: Record<string, string>): string {
  for (const s of items) if (errs[s.key]) return errs[s.key]!
  return ''
}

/**
 * 发给 Java /agent/stream 的 imageUrls：所有 image 位的 URL 按 slots 的 order 顺序展开（video 位不进）。
 * 传 prepare 规整后的 inputs（不可见项已被丢弃）；值可能是单个地址或地址数组。最多 9 个（服务端上限）。
 */
export function imageUrlsOf(items: ISlot[], inputs: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const s of items) {
    if (s.type !== 'image') continue
    const v = inputs[s.key]
    const arr = Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []
    for (const u of arr) if (typeof u === 'string' && /^https?:\/\//i.test(u) && !out.includes(u)) out.push(u)
  }
  return out.slice(0, 9)
}
