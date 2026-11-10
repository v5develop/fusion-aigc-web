import { computed, onActivated, onDeactivated, type Ref, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionIdStore } from '@/stores/e-commerce'
import { ecSessionKey, useEcTabsStore } from '@/stores/e-commerce/tabs'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'
import { ecommerceSubmit } from '@/api/methods.ts'
import { useUserInfoStore } from '@/stores/user-info.ts'
import { isAllTasksTerminal } from '@/utils/utils'

export function useInitCheckTaskStatus(type: string) {
  const { updateUserInfo } = useUserInfoStore()
  const { useSessionId } = useSessionIdStore()
  const { setRunning } = useEcTabsStore()

  // 同类目可以开多个标签，会话必须按标签实例分片：共用一把键的话两个标签会互相看到对方的结果，
  // 且任一方批次跑完调 clearSessionId() 会把对方还在轮询的会话一并清掉。
  //
  // 只在 setup 里读这一次、定格成常量：组件被 keep-alive 缓存着的期间，全局 route 会随用户
  // 切标签变化，之后任何时候再读都会拿到别的标签的 id。
  const route = useRoute()
  const tabId = route.query.tab as string | undefined
  // 类目部分刻意取 route.name 而不是入参 type：标签条那边算清理用的键取的是 tab.name（= 路由 name），
  // 两边同源才不会分叉。type 只留给没有 tabId 的兜底路径
  const sessionKey = tabId ? ecSessionKey(String(route.name), tabId) : type
  // 小圆点按标签实例点亮；没有 tabId 的兜底路径（理论上不会走到）退回类目名
  const runningKey = tabId ?? type

  const { getSessionId, clearSessionId } = useSessionId(sessionKey)

  // AIGC 生成速度无法保证，页面打开期间轮询持续进行：错误不停止（stopOnError: false）、
  // 任务完成也不停止，仅组件卸载时停止。
  // graceLeft：提交后的宽限轮数，刚提交的任务可能尚未写入会话，宽限期内"无未完成任务"不视为完成
  let graceLeft = 0
  // 本批是否已全部到终态、组件当前是否处于激活态。两者一起决定「还要不要继续轮询」，见下方 autoStop
  let allTerminal = false
  let isActive = true
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
        allTerminal = false
        setRunning(runningKey, true)
        return false
      }

      allTerminal = true

      if (graceLeft > 0) {
        graceLeft--
        return false
      }

      setRunning(runningKey, false)

      if (awaitingCompletion) {
        // 本批任务全部到终态：轮换会话并刷新积分（每批只进入一次）
        awaitingCompletion = false
        clearSessionId()
        updateUserInfo()
      }

      // 前台标签保持轮询（用户看着，随时可能再提交一批）；
      // 后台标签既然已经全部跑完，就没有再轮下去的理由了 —— 标签数不设上限，
      // 光靠 onDeactivated 那一下只能收掉「切走时就已经跑完」的，
      // 而最常见的恰恰是「提交后切走、任务在后台完成」，那种漏掉就会永远空转
      return !isActive
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

  // 标签数不设上限，而 autoStop 恒返回 false、usePolling 只在 onUnmounted 停 —— 标签不关就永远
  // 每 3 秒一轮，任务早跑完了也不停，请求量随标签数线性放大。
  // 这里只收掉「已经跑完、用户又没在看」的那部分：还有任务在跑的后台标签继续轮询，
  // 那正是多标签的价值所在。
  onDeactivated(() => {
    isActive = false
    // 已经跑完的，切走当下就停，不用等下一轮回来才发现
    if (allTerminal) stop()
  })
  onActivated(() => {
    isActive = true
    // 会话还在就续上。批次跑完后 clearSessionId 已把会话轮换掉，这里拿不到，也就不需要再轮询 ——
    // 结果仍留在缓存实例里正常显示
    const current = getSessionId(true)
    if (current) startPolling(current)
  })

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
          setRunning(runningKey, true)
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
