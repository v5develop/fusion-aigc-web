import { ref } from 'vue'
import { defineStore } from 'pinia'
import { createSafeUuid } from '@/utils/utils'

export const useSessionIdStore = defineStore('useSessionIdStore', () => {
  const sessionIdMap = ref<Record<string, any>>({})

  function useSessionId(type: string) {
    const getSessionId = (init?: boolean) => {
      // 检查store，有则直接返回
      if (sessionIdMap.value[type]) return sessionIdMap.value[type]

      try {
        const localSessionIdMap = localStorage.getItem('sessionIdMap')
        if (localSessionIdMap) {
          sessionIdMap.value = JSON.parse(localSessionIdMap)
          if (sessionIdMap.value[type]) return sessionIdMap.value[type]
        }
      } catch {
        sessionIdMap.value = {}
      }

      // 初始化页面进入时，store和localStorage都没有不用生成uuid，提交时再生成即可
      if (init) return undefined

      // store和localStorage都没有，则缓存
      sessionIdMap.value[type] = 'AiSession_' + createSafeUuid()
      try {
        localStorage.setItem('sessionIdMap', JSON.stringify(sessionIdMap.value))
      } catch {}

      return sessionIdMap.value[type]
    }

    const clearSessionId = () => {
      sessionIdMap.value[type] = ''
      try {
        localStorage.setItem('sessionIdMap', JSON.stringify(sessionIdMap.value))
      } catch {}
    }

    return { getSessionId, clearSessionId }
  }

  /**
   * 清掉无主的电商标签会话，防止 localStorage 里越积越多。
   *
   * 只动含 '#' 的键 —— 那是电商标签的实例键格式（`<类目>#<标签id>`）。
   * 图片模块（views/image/hooks.ts）用的是同一份 sessionIdMap，键是裸的 'picture'，
   * 少了这道前置条件会把它的会话一起清掉。
   */
  function pruneSessionIds(validKeys: Set<string>) {
    try {
      const raw = localStorage.getItem('sessionIdMap')
      if (raw) sessionIdMap.value = { ...JSON.parse(raw), ...sessionIdMap.value }
    } catch {}

    let changed = false
    for (const key of Object.keys(sessionIdMap.value)) {
      if (!key.includes('#') || validKeys.has(key)) continue
      delete sessionIdMap.value[key]
      changed = true
    }

    if (!changed) return
    try {
      localStorage.setItem('sessionIdMap', JSON.stringify(sessionIdMap.value))
    } catch {}
  }

  return { useSessionId, pruneSessionIds }
})
