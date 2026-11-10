/**
 * 前后端字段命名边界：前端统一用 camelCase（与 Java 一致）。
 *
 * - 请求体 / 响应体：Go 网关已支持 camelCase（请求侧按白名单映射，响应侧双写别名），直接用 camelCase 即可。
 * - query 参数：Go 的 query 绑定只认 snake_case，发请求前必须用 toSnakeKeys 转一次。
 */

/** 把对象的顶层 camelCase 键转成 snake_case（只转键，值不动；undefined 的键丢弃）。 */
export function toSnakeKeys(obj: object | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!obj) return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v
  }
  return out
}
