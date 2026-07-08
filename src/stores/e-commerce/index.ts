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

  return { useSessionId }
})
