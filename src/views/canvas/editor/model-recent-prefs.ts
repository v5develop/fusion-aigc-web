/**
 * 生成卡「最近用过的模型」：按账号 + 类型（image / video）记在本机 localStorage，只留最近 5 个 modelId。
 * 仅是个人便利，读写全部 try/catch，失败静默；账号 id 取 currentAccountId，取不到时不读不写。
 * key：`xq-canvas-model-recent:<accountId>:<kind>`（前缀已登记在 auth-session 的 ACCOUNT_KEYED_PREFIXES，换号清缓存时保留）。
 */
import { currentAccountId } from '@/utils/auth-session.ts'

const PREFIX = 'xq-canvas-model-recent:'
const MAX_RECENT = 5

function keyOf(kind: 'image' | 'video'): string {
  const who = currentAccountId()
  return who ? `${PREFIX}${who}:${kind}` : ''
}

export function readRecentModels(kind: 'image' | 'video'): string[] {
  const key = keyOf(kind)
  if (!key) return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function rememberRecentModel(kind: 'image' | 'video', modelId: string): void {
  const key = keyOf(kind)
  if (!key || !modelId) return
  try {
    const next = [modelId, ...readRecentModels(kind).filter((id) => id !== modelId)].slice(0, MAX_RECENT)
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    /* 存储不可用：忽略 */
  }
}
