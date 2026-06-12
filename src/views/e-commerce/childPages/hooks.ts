import { useSessionIdStore } from '@/stores/e-commerce'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'


export function useInitCheckTaskStatus(type: string) {
  const { useSessionId } = useSessionIdStore()
  const { getSessionId, clearSessionId } = useSessionId(type)

  function pollingTaskRequest(sessionId: string) {
    return pollingTask(sessionId).then((res) => {
      if (res.code === 0) {
      }
    })
  }

  const { result, start, stop } = usePolling((sessionId) => pollingTaskRequest(sessionId!), 3000, {
    // autoStop: (data) => console.log('autoStop: ', data),
  })

  const sessionId = getSessionId(true)
  if (sessionId) {
    start(sessionId)
  }

  return { getSessionId, clearSessionId, result, startPolling: start, stopPolling: stop }
}
