/**
 * 「身份未知期间改的偏好」的临时落盘（字体 / 外观共用）。
 *
 * <p>老会话首次进站时本机没有账号 id（fusion_identity），要等 /auth/user-info 回来才有。这段时间内改的偏好
 * 没有账号 key 可写，早先只留内存——窗口内刷新就丢。这里把它存到一个<b>绑定当前 accessToken 指纹</b>的临时 key：
 * - key = `xq-prefs-provisional:<scope>:<sha256(token)>`，只存 token 的摘要，不存 token 本身；
 * - 身份一到由各偏好模块迁移到账号 key 并清掉本 key；
 * - token 变了（登出 / 换号重登）指纹就对不上，读取时顺手清掉别的指纹留下的残留，改动不会落到别人名下；
 * - 不在 auth-session 的保留白名单里，resetAccountScope（换人清缓存）会一并清掉。
 *
 * <p>只依赖 localStorage，不发请求、不 import 业务模块；auth-session 引用它（saveTokens 续期改挂、换人清理），不会成环。
 */

export type ProvisionalScope = 'text' | 'theme'

const PREFIX = 'xq-prefs-provisional:'
const TOKEN_KEY = 'fusion_accessToken'

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]

/**
 * 同步 SHA-256（十六进制）。不用 crypto.subtle：它是异步的、且只在安全上下文可用，
 * 而偏好写盘需要同步完成（改完立刻刷新也要在）。输入按 UTF-8 编码。
 */
export function sha256Hex(input: string): string {
  const msg = new TextEncoder().encode(input)
  const bitLen = msg.length * 8
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) << 6)
  padded.set(msg)
  padded[msg.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(padded.length - 4, bitLen >>> 0)

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!
      const b = w[i - 2]!
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + next[i]!) >>> 0
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('')
}

/** 当前 accessToken 的指纹（sha-256 十六进制）；没有 token / 读不了存储时为空串 */
export function tokenFingerprint(): string {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    return token ? sha256Hex(token) : ''
  } catch {
    return ''
  }
}

function scopePrefix(scope: ProvisionalScope) {
  return `${PREFIX}${scope}:`
}

function sweep(scope: ProvisionalScope, keep: string) {
  try {
    const prefix = scopePrefix(scope)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix) && key !== `${prefix}${keep}`) localStorage.removeItem(key)
    }
  } catch {
    /* 存储不可用：没有可清的 */
  }
}

/** 写临时偏好；没有 token 指纹（没登录）时不写、返回 false */
export function writeProvisional(scope: ProvisionalScope, json: string): boolean {
  const fp = tokenFingerprint()
  if (!fp) return false
  try {
    sweep(scope, fp)
    localStorage.setItem(`${scopePrefix(scope)}${fp}`, json)
    return true
  } catch {
    return false
  }
}

/** 读绑定当前 token 的临时偏好（原始 JSON，由调用方清洗）；顺手清掉别的 token 留下的残留 */
export function readProvisional(scope: ProvisionalScope): string | null {
  const fp = tokenFingerprint()
  sweep(scope, fp)
  if (!fp) return null
  try {
    return localStorage.getItem(`${scopePrefix(scope)}${fp}`)
  } catch {
    return null
  }
}

const resetListeners = new Set<() => void>()

/**
 * 订阅「全部临时偏好被作废」（登出 / 换人清缓存）：偏好模块据此丢掉内存里的 pendingUnsaved，
 * 免得登出后换号登录时，上一个人在身份未知期间改的偏好被落到新账号名下。
 */
export function onProvisionalReset(fn: () => void): () => void {
  resetListeners.add(fn)
  return () => resetListeners.delete(fn)
}

/**
 * accessToken 续期（同一会话换了一个新 token）：把旧指纹下的临时偏好改挂到新指纹，不丢。
 * 必须在新 token 写盘之后调用；fromFp 是写盘前的 {@link tokenFingerprint}。
 */
export function rebindProvisional(fromFp: string) {
  const to = tokenFingerprint()
  if (!fromFp || !to || fromFp === to) return
  try {
    for (const scope of ['text', 'theme'] as const) {
      const old = `${scopePrefix(scope)}${fromFp}`
      const raw = localStorage.getItem(old)
      if (raw == null) continue
      localStorage.setItem(`${scopePrefix(scope)}${to}`, raw)
      localStorage.removeItem(old)
    }
  } catch {
    /* 存储不可用 */
  }
}

/**
 * 清掉某类临时偏好：已迁移到账号 key 时传 scope；登出 / 换号时不传 = 全部清并通知订阅者。
 */
export function clearProvisional(scope?: ProvisionalScope) {
  if (!scope) resetListeners.forEach((fn) => fn())
  try {
    const prefix = scope ? scopePrefix(scope) : PREFIX
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
  } catch {
    /* 存储不可用 */
  }
}
