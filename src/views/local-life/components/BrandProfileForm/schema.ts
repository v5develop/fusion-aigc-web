/**
 * 品牌档案表单 schema 工具（Java /brand-profiles/forms 的 jsonSchema）。
 *
 * <p>只认 schema 里出现的键：additionalProperties=false，多一个键后端整份拒收（「品牌档案数据校验失败」）。
 * 约束镜像后端 schema 校验：required / minLength / maxLength / minItems / maxItems / minimum / maximum / enum；
 * 可选数组只要填了值也要满足 minItems；数字字段用数字输入，enum 用下拉。
 * 空串、空数组、空行对可选字段直接省略（minLength=1 的可选串提交 "" 会被拒）。
 */
export type Node = Record<string, any>

export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'image' | 'images' | 'tags' | 'rows'

/** 一组图的默认上限（schema 没写 maxItems 时的前端兜底，对应常见素材量） */
export const DEFAULT_MAX_IMAGES = 9

export function kindOf(node: Node): FieldKind {
  if (node.type === 'array') {
    const items = (node.items ?? {}) as Node
    if (items.type === 'object') return 'rows'
    return node['x-input-type'] === 'image' ? 'images' : 'tags'
  }
  if (node['x-input-type'] === 'image') return 'image'
  if (Array.isArray(node.enum) && node.enum.length) return 'select'
  if (node.type === 'number' || node.type === 'integer') return 'number'
  return (node.maxLength ?? 0) >= 500 ? 'textarea' : 'text'
}

export interface FieldDef {
  key: string
  node: Node
  kind: FieldKind
  required: boolean
}

/** enum 字段的下拉选项（enumNames / x-enum-names 有就用作显示名） */
export function enumOptions(node: Node): { label: string; value: string | number }[] {
  const names = (node.enumNames ?? node['x-enum-names']) as unknown[] | undefined
  return ((node.enum ?? []) as (string | number)[]).map((v, i) => ({
    label: names?.[i] != null ? String(names[i]) : String(v),
    value: v,
  }))
}

/**
 * 必填却被简化表单隐藏的图组键（x-group 且 required / x-required）：新建时填不了，提交必被后端拒，
 * 由表单提前说明并拦下，而不是让用户撞上「品牌档案数据校验失败」。
 */
export function requiredGroupFields(schema: Node | null | undefined): { key: string; title: string }[] {
  const required: string[] = Array.isArray(schema?.required) ? schema!.required : []
  return Object.entries((schema?.properties ?? {}) as Node)
    .filter(([key, n]) => n && n['x-group'] && !n['x-hide'] && (n['x-required'] === true || required.includes(key)))
    .map(([key, n]) => ({ key, title: String(n.title ?? key) }))
}

/** 按 x-order 排序；required 在前；隐藏项与图组（x-group，简化表单不填）不渲染 */
export function listFields(props: Node, required: string[] = []): FieldDef[] {
  const list = Object.entries(props ?? {})
    .filter(([, n]) => n && !n['x-hide'] && !n['x-group'])
    .map(([key, node]) => ({
      key,
      node: node as Node,
      kind: kindOf(node as Node),
      required: node['x-required'] === true || required.includes(key),
    }))
  return list.sort(
    (a, b) => Number(b.required) - Number(a.required) || (a.node['x-order'] ?? 0) - (b.node['x-order'] ?? 0),
  )
}

export function emptyOf(f: { kind: FieldKind }): any {
  if (f.kind === 'number' || f.kind === 'select') return null
  return f.kind === 'text' || f.kind === 'textarea' || f.kind === 'image' ? '' : []
}

export function newRow(item: Node): Record<string, any> {
  const row: Record<string, any> = {}
  for (const f of listFields(item.properties, item.required)) row[f.key] = emptyOf(f)
  return row
}

const blank = (v: unknown): boolean => (Array.isArray(v) ? v.length === 0 : v == null || String(v).trim() === '')

/** 单个标量/数组字段的校验，返回错误文案；通过返回 '' */
export function checkField(f: FieldDef, v: any): string {
  const title = String(f.node.title ?? f.key)
  if (f.kind === 'rows') {
    const rows = ((v as any[]) ?? []).filter((r) => !isBlankRow(r))
    if (f.required && rows.length < Math.max(1, f.node.minItems ?? 1)) return `请至少添加一项「${title}」`
    // 可选的行列表：一行都不填可以省略，填了就要满足 minItems
    if (rows.length && f.node.minItems && rows.length < f.node.minItems) return `「${title}」至少 ${f.node.minItems} 项`
    if (f.node.maxItems && rows.length > f.node.maxItems) return `「${title}」最多 ${f.node.maxItems} 项`
    const item = (f.node.items ?? {}) as Node
    for (let i = 0; i < rows.length; i++) {
      for (const sub of listFields(item.properties, item.required)) {
        const err = checkField(sub, rows[i][sub.key])
        if (err) return `「${title}」第 ${i + 1} 项：${err}`
      }
    }
    return ''
  }
  if (blank(v)) {
    if (!f.required) return ''
    if (f.kind === 'image' || f.kind === 'images') return `请上传${title}`
    return f.kind === 'select' ? `请选择${title}` : `请填写${title}`
  }
  if (f.kind === 'text' || f.kind === 'textarea') {
    const len = String(v).trim().length
    if (f.node.minLength && len < f.node.minLength) return `${title}至少 ${f.node.minLength} 个字`
    if (f.node.maxLength && len > f.node.maxLength) return `${title}不能超过 ${f.node.maxLength} 个字`
    return ''
  }
  if (f.kind === 'number') {
    const n = Number(v)
    if (!Number.isFinite(n)) return `${title}请填写数字`
    if (f.node.type === 'integer' && !Number.isInteger(n)) return `${title}请填写整数`
    if (typeof f.node.minimum === 'number' && n < f.node.minimum) return `${title}不能小于 ${f.node.minimum}`
    if (typeof f.node.maximum === 'number' && n > f.node.maximum) return `${title}不能大于 ${f.node.maximum}`
    return ''
  }
  if (f.kind === 'select') {
    return (f.node.enum as unknown[]).includes(v) ? '' : `请从选项中选择${title}`
  }
  if (f.kind === 'images' || f.kind === 'tags') {
    const n = (v as unknown[]).length
    if (f.node.minItems && n < f.node.minItems) return `${title}至少 ${f.node.minItems} 项`
    if (f.node.maxItems && n > f.node.maxItems) return `${title}最多 ${f.node.maxItems} 项`
    const max = f.node.items?.maxLength
    if (f.kind === 'tags' && max && (v as string[]).some((t) => t.length > max))
      return `${title}每项不能超过 ${max} 个字`
    const min = f.node.items?.minLength
    if (f.kind === 'tags' && min && (v as string[]).some((t) => t.trim().length < min))
      return `${title}每项至少 ${min} 个字`
  }
  return ''
}

function isBlankRow(row: Record<string, any>): boolean {
  return !row || Object.values(row).every(blank)
}

/** 把表单状态清成提交值（去空、去首尾空白、标签去重） */
export function cleanValue(f: FieldDef, v: any): any {
  if (f.kind === 'text' || f.kind === 'textarea' || f.kind === 'image') {
    const s = String(v ?? '').trim()
    return s === '' ? undefined : s
  }
  if (f.kind === 'number') {
    if (v == null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  if (f.kind === 'select') return v == null || v === '' ? undefined : v
  if (f.kind === 'images') return (v as string[]).length ? [...(v as string[])] : undefined
  if (f.kind === 'tags') {
    const tags = [...new Set(((v as string[]) ?? []).map((t) => t.trim()).filter(Boolean))]
    return tags.length ? tags : undefined
  }
  const item = (f.node.items ?? {}) as Node
  const rows = ((v as Record<string, any>[]) ?? [])
    .filter((r) => !isBlankRow(r))
    .map((r) => {
      const out: Record<string, any> = {}
      for (const sub of listFields(item.properties, item.required)) {
        const c = cleanValue(sub, r[sub.key])
        if (c !== undefined) out[sub.key] = c
      }
      return out
    })
  return rows.length ? rows : undefined
}

/** 详情 data（schema + 每项 value）→ 扁平取值 */
export function valuesFromDetail(data: Node | null | undefined): Record<string, any> {
  const out: Record<string, any> = {}
  const props = (data?.properties ?? {}) as Node
  for (const [k, n] of Object.entries(props)) if (n && 'value' in n && n.value != null) out[k] = n.value
  return out
}

/** 编辑回填：把详情里的值灌进字段状态（行对象补齐缺的子键） */
export function hydrate(f: FieldDef, raw: any): any {
  if (raw == null) return emptyOf(f)
  if (f.kind === 'rows') {
    const item = (f.node.items ?? {}) as Node
    return (Array.isArray(raw) ? raw : []).map((r) => ({ ...newRow(item), ...(r as object) }))
  }
  if (f.kind === 'images' || f.kind === 'tags') return Array.isArray(raw) ? raw.map(String) : []
  if (f.kind === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (f.kind === 'select') return raw
  return String(raw)
}
