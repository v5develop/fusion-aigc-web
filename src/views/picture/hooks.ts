import type { Ref } from 'vue'
import { useSessionIdStore } from '@/stores/e-commerce'
import { useUserInfoStore } from '@/stores/userInfo'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'
import { creationSubmit } from '@/api/methods.ts'

interface IProps {
  type: string
  loading: Ref<boolean>
  pagingData: any
  getData: (isReplace?: boolean) => Promise<any> | undefined
}

export function useInitCheckTaskStatus(props: IProps) {
  const { type, loading, getData, pagingData } = props

  const { updateUserInfo } = useUserInfoStore()
  const { useSessionId } = useSessionIdStore()
  const { getSessionId, clearSessionId } = useSessionId(type)

  const { start } = usePolling((sessionId) => pollingTask(sessionId!), 3000, {
    autoStop: (res) => {
      const { data } = res

      for (const item of data.tasks) {
        for (const jtem of item.contents) {
          // status: 0=排队 1=处理中 2=成功 3=失败 4=取消   terminal: 是否为终态（不再变化）
          if (jtem.status !== 2 && !jtem.statusView.terminal) {
            return false
          }
        }
      }

      clearSessionId()
      pagingData.page = 1
      pagingData.hasMore = true
      pagingData.loading = false
      getData(true)?.finally(() => (loading.value = false))
      updateUserInfo()

      return true
    },
    onError() {
      loading.value = false
    }
  })

  const sessionId = getSessionId(true)
  if (sessionId) {
    loading.value = true
    start(sessionId)
  }

  const execute = (params: any) => {

    loading.value = true
    params.sessionId = getSessionId()

    creationSubmit(params).then((res) => {
      if (res.code === 0) {
        pagingData.page = 1
        pagingData.hasMore = true
        getData(true)?.finally(() => {
          // 开始轮询
          start(params.sessionId)
        })
      }
    }).catch(() => loading.value = false)
  }

  return { execute }
}
