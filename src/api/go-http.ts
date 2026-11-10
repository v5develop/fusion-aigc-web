import { del, get } from './index.ts'
import { toSnakeKeys } from '@/utils/api-keys'

/**
 * Go 网关接口的 GET / DELETE：query 参数统一转 snake_case（Go 的 query 绑定只认 snake）。
 * 请求体（POST/PUT）不需要转换：Go 网关按白名单接受 camelCase 请求体。
 * 共享的 get / del 仍给 Java 接口用（Java query 本身是 camelCase），不能改。
 */
export function goGet<T = any>(url: string, query?: object, headers?: any) {
  return get<T>(url, query ? toSnakeKeys(query) : query, headers)
}

export function goDel<T = any>(url: string, query?: object) {
  return del<T>(url, query ? toSnakeKeys(query) : query)
}
