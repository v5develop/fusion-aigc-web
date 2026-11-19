import { createSafeUuid } from '@/utils/utils'

/**
 * 幂等键：同一用户动作（scope + 载荷哈希）重试复用同一个 Idempotency-Key，成功后丢弃。
 *
 * - 键存 sessionStorage（TTL 10 分钟），请求在途时刷新页面、再点一次也复用原键，不会重复预留点数；
 * - sessionStorage 不可用（隐私模式 / 被禁用）时退回内存 Map；
 * - scope 标识动作（路径等），payload 参与哈希：载荷变了就是一次新提交，换新键。
 */

const TTL_MS = 10 * 60 * 1000
const PREFIX = 'fusion_idem:'
const mem = new Map<string, { k: string; t: number }>()

/** 占位头：调用方不关心键怎么来时传它，由 {@link resolveIdem} 换成按 scope+载荷稳定的键 */
export const AUTO_IDEM = '__auto__'

/** 稳定序列化（键排序），保证同内容的对象哈希一致 */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`
}

/** 32 位 FNV-1a，够区分「同一动作的不同载荷」，不用于安全用途 */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function storageKey(scope: string, payload?: unknown): string {
  return PREFIX + scope + (payload === undefined ? '' : `#${hash(stable(payload))}`)
}

function read(sk: string): { k: string; t: number } | null {
  try {
    const raw = sessionStorage.getItem(sk)
    if (raw) {
      const v = JSON.parse(raw) as { k?: unknown; t?: unknown }
      if (typeof v.k === 'string' && typeof v.t === 'number') return { k: v.k, t: v.t }
    }
  } catch {
    /* sessionStorage 不可用，走内存 */
  }
  return mem.get(sk) ?? null
}

function write(sk: string, v: { k: string; t: number }) {
  mem.set(sk, v)
  try {
    sessionStorage.setItem(sk, JSON.stringify(v))
  } catch {
    /* 忽略：内存里已有 */
  }
}

/** 取（或新建）该动作的幂等头 */
export function idemHeaders(scope: string, payload?: unknown): { 'Idempotency-Key': string } {
  const sk = storageKey(scope, payload)
  const hit = read(sk)
  if (hit && Date.now() - hit.t < TTL_MS) return { 'Idempotency-Key': hit.k }
  const k = createSafeUuid() // 36 位
  write(sk, { k, t: Date.now() })
  return { 'Idempotency-Key': k }
}

/** 动作成功后丢弃键，下一次同类动作换新键 */
export function idemDone(scope: string, payload?: unknown) {
  const sk = storageKey(scope, payload)
  mem.delete(sk)
  try {
    sessionStorage.removeItem(sk)
  } catch {
    /* 忽略 */
  }
}

/** 调用方传了 {@link AUTO_IDEM} 占位头（或没传）就换成稳定键；显式给的键原样用 */
export function resolveIdem<H extends Record<string, string> | undefined>(
  scope: string,
  payload: unknown,
  headers: H,
): Record<string, string> {
  if (!headers || headers['Idempotency-Key'] === AUTO_IDEM) {
    return { ...(headers ?? {}), ...idemHeaders(scope, payload) }
  }
  return headers
}

/** 带幂等键执行：成功才丢键（失败 / 网络中断保留，重试沿用） */
export async function withIdem<T>(
  scope: string,
  payload: unknown,
  fn: (headers: { 'Idempotency-Key': string }) => Promise<T>,
): Promise<T> {
  const r = await fn(idemHeaders(scope, payload))
  idemDone(scope, payload)
  return r
}
