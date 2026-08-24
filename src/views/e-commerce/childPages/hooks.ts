import { computed, type Ref, ref } from 'vue'
import { useSessionIdStore } from '@/stores/e-commerce'
import { useEcTabsStore } from '@/stores/e-commerce/tabs'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'
import { ecommerceSubmit } from '@/api/methods.ts'
import { useUserInfoStore } from '@/stores/userInfo.ts'
import { isAllTasksTerminal } from '@/utils/utils'


export function useInitCheckTaskStatus(type: string) {
  const { updateUserInfo } = useUserInfoStore()
  const { useSessionId } = useSessionIdStore()
  // type 与路由 name/组件 name 同名，直接拿来当标签条上「进行中」小圆点的键
  const { setRunning } = useEcTabsStore()
  const { getSessionId, clearSessionId } = useSessionId(type)

  // AIGC 生成速度无法保证，页面打开期间轮询持续进行：错误不停止（stopOnError: false）、
  // 任务完成也不停止，仅组件卸载时停止。
  // graceLeft：提交后的宽限轮数，刚提交的任务可能尚未写入会话，宽限期内"无未完成任务"不视为完成
  let graceLeft = 0
  // awaitingCompletion：有批次待完成（进页面恢复会话或提交成功后置位），完成副作用只触发一次
  let awaitingCompletion = false
  let polledSessionId = ''

  const { result, start, stop } = usePolling((sessionId) => pollingTask(sessionId!), 3000, {
    stopOnError: false,
    autoStop: (res) => {
      const tasks = res?.data?.tasks ?? []

      if (!isAllTasksTerminal(tasks)) {
        graceLeft = 0
        awaitingCompletion = true
        setRunning(type, true)
        return false
      }

      if (graceLeft > 0) {
        graceLeft--
        return false
      }

      setRunning(type, false)

      if (awaitingCompletion) {
        // 本批任务全部到终态：轮换会话并刷新积分（每批只进入一次），轮询继续
        awaitingCompletion = false
        clearSessionId()
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

  const showList = ref(true)
  const sessionId = getSessionId(true)
  if (sessionId) {
    awaitingCompletion = true
    startPolling(sessionId)
  } else {
    showList.value = false
  }

  const execute = (params: any, loading: Ref<boolean>) => {
    loading.value = true
    params.sessionId = getSessionId()
    ecommerceSubmit(params)
      .then((res) => {
        if (res.code === 0) {
          // 提交即扣费，立即刷新积分余额
          updateUserInfo()
          // 开始轮询
          graceLeft = 5
          awaitingCompletion = true
          // 提交即点亮标签上的小圆点，不必等第一轮轮询回来
          setRunning(type, true)
          startPolling(params.sessionId)
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
