/**
 * 画布缩放偏好：按「账号 + 画布」记在本机 localStorage（仅是个人便利，读写全部 try/catch，失败静默）。
 * key：`canvas-zoom:<accountId>:<canvasId>`，值 `{ z, t }`；每个账号最多留最近 200 张画布（按 t 淘汰最久未用的）。
 * 账号 id 取 auth-session 的 currentAccountId（不解 JWT）；取不到时不读不写。
 */
import { currentAccountId } from '@/utils/auth-session.ts'

const PREFIX = 'canvas-zoom:'
const MAX_ENTRIES = 200

export const DEFAULT_CANVAS_ZOOM = 1

function keyOf(canvasId: string): string {
  const who = currentAccountId()
  return who && canvasId ? `${PREFIX}${who}:${canvasId}` : ''
}

function clamp(zoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, zoom))
}

/** 当前用户在这张画布上次的缩放；没有记录 / 取不到账号时返回 undefined */
export function readCanvasZoom(canvasId: string, min: number, max: number): number | undefined {
  const key = keyOf(canvasId)
  if (!key) return undefined
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const z = Number((JSON.parse(raw) as { z?: unknown }).z)
    return Number.isFinite(z) && z > 0 ? clamp(z, min, max) : undefined
  } catch {
    return undefined
  }
}

/** 记下缩放；新增条目时顺带把该账号超出 200 条的最旧记录清掉 */
export function writeCanvasZoom(canvasId: string, zoom: number, min: number, max: number): void {
  const key = keyOf(canvasId)
  if (!key || !Number.isFinite(zoom)) return
  try {
    const isNew = localStorage.getItem(key) === null
    localStorage.setItem(key, JSON.stringify({ z: Math.round(clamp(zoom, min, max) * 1000) / 1000, t: Date.now() }))
    if (isNew) prune(key.slice(0, key.lastIndexOf(':') + 1))
  } catch {
    /* 存储不可用：忽略 */
  }
}

function prune(accountPrefix: string): void {
  const entries: { key: string; t: number }[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(accountPrefix)) continue
    let t = 0
    try {
      t = Number((JSON.parse(localStorage.getItem(k) || '{}') as { t?: unknown }).t) || 0
    } catch {
      t = 0
    }
    entries.push({ key: k, t })
  }
  if (entries.length <= MAX_ENTRIES) return
  entries.sort((a, b) => a.t - b.t)
  for (const old of entries.slice(0, entries.length - MAX_ENTRIES)) localStorage.removeItem(old.key)
}
