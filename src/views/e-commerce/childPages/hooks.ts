import { computed, type Ref, ref } from 'vue'
import { useSessionIdStore } from '@/stores/e-commerce'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'
import { ecommerceSubmit } from '@/api/methods.ts'


export function useInitCheckTaskStatus(type: string) {
  const { useSessionId } = useSessionIdStore()
  const { getSessionId, clearSessionId } = useSessionId(type)

  const { result, start } = usePolling((sessionId) => pollingTask(sessionId!), 3000, {
    autoStop: (res) => {
      const { data } = res

      for (const item of data.tasks) {
        // status: 0=排队 1=处理中 2=成功 3=失败 4=取消   terminal: 是否为终态（不再变化）
        if (item.status !== 2 && !item.statusView.terminal) {
          return false
        }
      }

      clearSessionId()
      return true
    },
  })

  const showList = ref(true)
  const sessionId = getSessionId(true)
  if (sessionId) {
    start(sessionId)
  } else {
    showList.value = false
  }

  const execute = (params: any, loading: Ref<boolean>) => {
    loading.value = true
    params.sessionId = getSessionId()
    ecommerceSubmit(params)
      .then((res) => {
        if (res.code === 0) {
          // 开始轮询
          start(params.sessionId)
          showList.value = true
        }
      })
      .finally(() => (loading.value = false))
  }

  return {
    taskList: computed(() => result.value?.data?.tasks),
    showList,
    execute,
  }
}
