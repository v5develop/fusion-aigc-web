import { ApiError, toApiError } from '@/api'

/** GET /api/v1/auth/user-info 中本页用到的字段 */
export interface IUserCenterInfo {
  username?: string
  nickname?: string
  email?: string
  phone?: string
  avatar?: string
  status?: string | number | null
  createTime?: string | number | null
  availablePoints?: number
}

/** 与导航栏一致的默认头像 */
export const DEFAULT_AVATAR =
  'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp'

/** 手机号脱敏：前 3 位 + **** + 后 4 位；位数不足 7 时不展示（同导航栏） */
export function maskPhone(phone?: string): string {
  const p = (phone ?? '').replace(/\s|-/g, '')
  return p.length >= 7 ? `${p.slice(0, 3)}****${p.slice(-4)}` : ''
}

/** 注册时间格式化为 yyyy-MM-dd；接受 'yyyy-MM-dd HH:mm:ss' / ISO 字符串 / 毫秒时间戳 */
export function formatDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(typeof v === 'number' ? v : s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 输入框统一样式：sx-input + 校验失败时的危险色描边与焦点环 */
export function inputClass(invalid: boolean): string[] {
  return ['sx-input w-full', invalid ? '!border-danger focus:!shadow-focus-danger' : '']
}

/**
 * 请求失败提示。业务失败（code ≠ 0）已由请求拦截器 toast 后端 msg，这里不重复弹；
 * 只有 HTTP / 网络层失败（拦截器不 toast）才在这里提示错误原文。
 */
export function reportRequestError(err: unknown, error: (msg: string) => void) {
  if (err instanceof ApiError) return
  const e = toApiError(err)
  if (e?.message) error(e.message)
}
