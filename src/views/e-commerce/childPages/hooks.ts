import { useSessionIdStore } from '@/stores/e-commerce'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'


export function useInitCheckTaskStatus(type: string) {
  const { useSessionId } = useSessionIdStore()
  const { getSessionId, clearSessionId } = useSessionId(type)

  const { result, start, stop } = usePolling((sessionId) => pollingTask(sessionId!), 3000, {
    autoStop: (res) => {
      const { data } = res

      if (!data.tasks.length) {
        clearSessionId()
        return true;
      }

      for (const item of data.tasks) {
        // status: 0=排队 1=处理中 2=成功 3=失败 4=取消   terminal: 是否为终态（不再变化）
        if (item.status !== 2 && !item.statusView.terminal) {
          return false
        }
      }

      return true
    },
  })

  const sessionId = getSessionId(true)
  if (sessionId) {
    start(sessionId)
  }

  return { getSessionId, clearSessionId, taskList: result.value?.data, startPolling: start, stopPolling: stop }
}
