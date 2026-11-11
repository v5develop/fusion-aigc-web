/**
 * 「重新存入素材库」失败提示（画布 run 3.4.3 / 商拍任务 §5.2.3 共用口径）。
 *
 * 4002 有两种：距上次失败不到 1 分钟（后端原话「操作太频繁，请稍后再试（每分钟最多一次）」）/ 转存记录已作废、
 * 无法再转存——契约都要求「展示 msg」，原话缺失时才给兜底。其余失败用原话，没有原话给兜底文案。
 * 登录失效（401 / 403 / 2001 等）返回空串：拦截器已提示「登录已过期」并跳登录，按钮不再叠一条。
 */
import { toApiError } from '@/api'

export const LIBRARY_RETRY_TOO_FREQUENT = '操作太频繁，请稍后再试'

/** 登录失效类：拦截器统一处理（刷新重放 / 跳登录），调用方不再提示 */
const AUTH_CODES = new Set([2001, 2002, 2003, 2007])

export function libraryRetryErrorText(err: unknown): string {
  const e = toApiError(err)
  // 调用方自己抛的说明（如「找不到这条运行记录，请刷新后再试」）
  if (!e && err instanceof Error && err.message) return err.message
  if (e && (AUTH_CODES.has(e.code) || e.httpStatus === 401 || e.httpStatus === 403)) return ''
  if (e?.code === 4002) return e.message || LIBRARY_RETRY_TOO_FREQUENT
  if (e && e.code !== -1 && e.message) return e.message
  return '重新存入素材库失败，请稍后再试'
}
