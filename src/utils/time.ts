/**
 * 时间展示（历史卡等窄空间用短格式，完整时间放 title / aria）。
 *
 * 入参兼容毫秒时间戳、Date、`yyyy-MM-dd HH:mm:ss` / ISO 字符串（无时区的串按本地时间解析）。
 */
export type TimeInput = number | string | Date | null | undefined

const p = (n: number) => String(n).padStart(2, '0')

export function toDate(input: TimeInput): Date | null {
  if (input === null || input === undefined || input === '' || input === 0) return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  if (typeof input === 'number') {
    const d = new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // "2026-11-09 12:30:00" 在部分浏览器解析为无效日期，统一换成 T
  const d = new Date(input.trim().replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 今天 → HH:mm；同年 → MM-DD；跨年 → YYYY-MM-DD；解析失败返回空串 */
export function formatShortTime(input: TimeInput, now: Date = new Date()): string {
  const d = toDate(input)
  if (!d) return ''
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  if (d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return `${p(d.getHours())}:${p(d.getMinutes())}`
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** YYYY-MM-DD HH:mm:ss，放 title / aria-label */
export function formatFullTime(input: TimeInput): string {
  const d = toDate(input)
  if (!d) return ''
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
