/**
 * 批次 payload 解析。
 * Go studio 把 batch.payload 存成 JSON 字符串（snake_case 键），网关的 jsoncase 层不改写字符串里的 JSON；
 * 旧版 / 前端自写的 payload 是 camelCase。这里统一解析并把键转成 camelCase（对 camel 输入幂等）。
 */

/** 值是「键即数据」的映射（按图序号 / 部位码做键）：只转它自己的字段名，值原样保留 */
const MAP_FIELDS = new Set(['lengths', 'sleeves', 'fabrics', 'posePrompts'])

const snakeToCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function convert(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(convert)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const key = snakeToCamel(k)
      out[key] = MAP_FIELDS.has(key) ? val : convert(val)
    }
    return out
  }
  return v
}

/** 解析 batch.payload；非法 JSON / 非对象 → {} */
export function parseStudioPayload(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {}
    return convert(p) as Record<string, unknown>
  } catch {
    return {}
  }
}
