/** 模板文字位的版式判断（layout 在 slots 里原样透传为 unknown，这里只判「有没有框」）。 */
import type { ISlot } from '../slots/slotTypes.ts'

export function hasOverlayLayout(s: ISlot): boolean {
  if (s.type !== 'text') return false
  const l = s.layout as { box?: unknown } | null | undefined
  return !!l && typeof l === 'object' && !!l.box && typeof l.box === 'object'
}

export interface IOverlayField {
  key: string
  label: string
  maxLength?: number
}

export interface IOverlayCtx {
  templateId: number
  /** 本轮提交的文字值（只含带 layout 且非空的位） */
  values: Record<string, string>
  fields: IOverlayField[]
}

/** 由模板 slots 与本轮入参值生成叠字上下文；不满足条件（模板不叠字 / 无版式位 / 全空）返回 null */
export function buildOverlayCtx(
  templateId: number,
  textOverlay: boolean,
  items: ISlot[],
  inputs: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
): IOverlayCtx | null {
  if (!textOverlay) return null
  const out: Record<string, string> = {}
  const fields: IOverlayField[] = []
  for (const s of items) {
    if (!hasOverlayLayout(s)) continue
    const fields0 = { key: s.key, label: s.label, ...(s.maxLength ? { maxLength: s.maxLength } : {}) }
    fields.push(fields0)
    const raw = inputs && s.key in inputs ? inputs[s.key] : values[s.key]
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (v) out[s.key] = v
  }
  return Object.keys(out).length ? { templateId, values: out, fields } : null
}
