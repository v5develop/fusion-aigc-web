import type { Ref } from 'vue'
import { useSessionIdStore } from '@/stores/e-commerce'
import { useUserInfoStore } from '@/stores/userInfo'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'
import { creationSubmit } from '@/api/methods.ts'
import { isAllTasksTerminal } from '@/utils/utils'

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

  const refreshData = async (isReplace?: boolean) => {
    try {
      await getData(isReplace)
    } catch {}
  }

  // AIGC 生成速度无法保证，页面打开期间轮询持续进行：错误不停止（stopOnError: false）、
  // 任务完成也不停止，仅组件卸载时停止。完成副作用通过 loading 状态只触发一次。
  // graceLeft：提交后的宽限轮数，刚提交的任务可能尚未写入会话，宽限期内"无未完成任务"不视为完成
  let graceLeft = 0
  // submitting：提交请求期间旧会话仍在空闲轮询，屏蔽完成副作用误触发
  let submitting = false
  // completing：完成副作用中的列表刷新是异步的，防止下一轮轮询重复触发
  let completing = false
  let polledSessionId = ''

  const { start, stop } = usePolling((sessionId) => pollingTask(sessionId!), 3000, {
    stopOnError: false,
    autoStop: (res) => {
      const tasks = res?.data?.tasks ?? []

      if (!isAllTasksTerminal(tasks)) {
        graceLeft = 0
        return false
      }

      if (graceLeft > 0) {
        graceLeft--
        return false
      }

      if (loading.value && !submitting && !completing) {
        // 本批任务全部到终态：轮换会话并刷新数据（每批只进入一次），轮询继续
        completing = true
        clearSessionId()
        pagingData.page = 1
        pagingData.hasMore = true
        pagingData.loading = false
        refreshData(true).finally(() => {
          loading.value = false
          completing = false
        })
        updateUserInfo()
      }

      return false // 页面打开期间持续轮询，永不自动停止
    },
  })

  // 换会话时先停再启，让轮询指向新的 sessionId（start 对同会话幂等）
  const startPolling = (sessionId: string) => {
    if (polledSessionId !== sessionId) stop()
    polledSessionId = sessionId
    start(sessionId)
  }

  const sessionId = getSessionId(true)
  if (sessionId) {
    loading.value = true
    startPolling(sessionId)
  }

  const afterSubmit = async (sessionId: string) => {
    pagingData.page = 1
    pagingData.hasMore = true
    pagingData.loading = false
    await refreshData(true)
    graceLeft = 5
    startPolling(sessionId)
  }

  const execute = async (params: any) => {
    loading.value = true
    submitting = true

    try {
      params.sessionId = getSessionId()
      const res = await creationSubmit(params)

      if (res.code !== 0) {
        loading.value = false
        return
      }

      await afterSubmit(params.sessionId)
    } catch (e: any) {
      // 提交请求超时/断网时后端可能已创建任务，sessionId 已持久化，兜底发起轮询；
      // 若任务确实未创建，宽限轮数耗尽后完成副作用会复位 loading 并轮换会话
      if (e?.code === 'ECONNABORTED' || e?.message === 'Network Error') {
        await afterSubmit(params.sessionId)
      } else {
        loading.value = false
      }
    } finally {
      submitting = false
    }
  }

  return { execute }
}
