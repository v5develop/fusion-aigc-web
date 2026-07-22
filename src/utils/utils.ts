export function createSafeUuid() {
  try {
    const cryptoObj = globalThis.crypto
    const randomUUID = cryptoObj?.randomUUID
    if (randomUUID) return randomUUID.call(cryptoObj)

    if (cryptoObj?.getRandomValues) {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch {}

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 会话下所有任务内容是否都已到终态。
 * status: 0=排队 1=处理中 2=成功 3=失败 4=取消   statusView.terminal: 是否为终态（不再变化）
 * tasks 为空时也返回 true，调用方需自行处理"任务尚未写入会话"的宽限。
 */
export function isAllTasksTerminal(tasks: any[]) {
  for (const task of tasks) {
    for (const content of task.contents ?? []) {
      if (content.status !== 2 && !content.statusView?.terminal) return false
    }
  }
  return true
}

/**
 * 失败(status===3)是否为「超时」：失败原因取 content.errorMsg（= statusView.message），含"超时"即超时。
 * 用于区分超时占位（还在来的路上）与一般生成失败占位。
 */
export function isTimeout(item: any): boolean {
  return /超时/.test(String(item?.errorMsg ?? item?.statusView?.message ?? ''))
}
