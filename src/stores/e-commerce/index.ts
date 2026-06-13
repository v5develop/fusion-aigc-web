import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSessionIdStore = defineStore('counter', () => {
  const sessionIdMap = ref<Record<string, any>>({})

  function useSessionId(type: string) {
    const getSessionId = (init?: boolean) => {
      // 检查store，有则直接返回
      if (sessionIdMap.value[type]) return sessionIdMap.value[type]

      // 检测localStorage，有则赋值给store并且返回
      const localSessionIdMap = localStorage.getItem('sessionIdMap')
      if (localSessionIdMap) {
        sessionIdMap.value = JSON.parse(localSessionIdMap)
        if (sessionIdMap.value[type]) return sessionIdMap.value[type]
      }

      // 初始化页面进入时，store和localStorage都没有不用生成uuid，提交时再生成即可
      if (init) return undefined

      // store和localStorage都没有，则缓存
      sessionIdMap.value[type] = 'AiSession_' + crypto.randomUUID()
      localStorage.setItem('sessionIdMap', JSON.stringify(sessionIdMap.value))

      return sessionIdMap.value[type]
    }

    const clearSessionId = () => {
      sessionIdMap.value[type] = ''
      localStorage.setItem('sessionIdMap', JSON.stringify(sessionIdMap.value))
    }

    return { getSessionId, clearSessionId }
  }

  return { useSessionId }
})
