import { onScopeDispose, type Ref } from 'vue'
import { useSessionIdStore } from '@/stores/e-commerce'
import { useUserInfoStore } from '@/stores/user-info'
import { usePolling } from '@/utils/hooks/usePolling.ts'
import { pollingTask } from '@/api/methods.ts'
import { creationSubmit } from '@/api/methods.ts'
import { isAllTasksTerminal } from '@/utils/utils'

interface IProps {
  type: string
  loading: Ref<boolean>
  pagingData: any
  getData: (isReplace?: boolean) => Promise<any> | undefined
  /**
   * 每轮会话轮询回来的主任务（结构与 /creation/history 的列表项一致，含 contents 逐条产出）。
   * 页面据此把已出的图 / 视频逐条并回列表，不必等整批到终态再刷新。
   */
  onTasks?: (tasks: any[]) => void
}

export function useInitCheckTaskStatus(props: IProps) {
  const { type, loading, getData, pagingData, onTasks } = props

  const { updateUserInfo } = useUserInfoStore()
  const { useSessionId } = useSessionIdStore()
  const { getSessionId, clearSessionId } = useSessionId(type)

  const refreshData = async (isReplace?: boolean) => {
    try {
      await getData(isReplace)
    } catch {}
  }

  // AIGC 生成速度无法保证：错误不停止（stopOnError: false），直到本批全部到终态（含宽限轮）才停；
  // 节奏走 usePolling 统一口径（提交后 1.5s 快查、隐藏页降频、切回立即补一轮）。完成副作用通过 loading 状态只触发一次。
  // graceLeft：提交后的宽限轮数，刚提交的任务可能尚未写入会话，宽限期内"无未完成任务"不视为完成
  let graceLeft = 0
  // submitting：提交请求期间旧会话仍在空闲轮询，屏蔽完成副作用误触发
  let submitting = false
  // completing：完成副作用中的列表刷新是异步的，防止下一轮轮询重复触发
  let completing = false
  let polledSessionId = ''
  // 组件卸载后停止一切后台重试
  let disposed = false
  onScopeDispose(() => (disposed = true))
  // 提交刷新令牌：新提交使旧的重试循环失效，避免并发/陈旧刷新
  let refreshToken = 0

  const { start, stop } = usePolling((sessionId) => pollingTask(sessionId!), 3000, {
    stopOnError: false,
    autoStop: (res) => {
      const tasks = res?.data?.tasks ?? []
      if (tasks.length) onTasks?.(tasks)

      if (!isAllTasksTerminal(tasks)) {
        graceLeft = 0
        return false
      }

      if (graceLeft > 0) {
        graceLeft--
        return false
      }

      if (loading.value && !submitting && !completing) {
        // 本批任务全部到终态：轮换会话并刷新数据（每批只进入一次）
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
        // 本批已收尾：停掉轮询（会话已轮换，下次提交 startPolling 会按新会话重新开始），
        // 免得对一个已结束的会话每 3 秒空转到页面关闭
        return true
      }

      // 宽限期已过、本批也不在等待中（进页时会话里本就全是终态）：同样没有继续的理由
      return !loading.value && !submitting && !completing
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

  // 提交成功后确保 creation/history 拉取成功：失败（网络错误 / 非 0 code）则每 3s 重试，
  // 直到成功、组件卸载、或被更新的提交取代。后台进行，不阻塞提交按钮与轮询。
  const refreshHistoryUntilSuccess = async () => {
    const myToken = ++refreshToken
    for (;;) {
      if (disposed || myToken !== refreshToken) return
      pagingData.page = 1
      pagingData.hasMore = true
      pagingData.loading = false
      try {
        // getData 成功返回 true；非 0 code 返回 false；被分页 guard 跳过返回 undefined（视为无需重试）
        const ok = await getData(true)
        if (ok !== false) return
      } catch {}
      if (disposed || myToken !== refreshToken) return
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }

  const afterSubmit = (sessionId: string) => {
    graceLeft = 5
    startPolling(sessionId)
    // 后台确保 history 拉取成功（失败每 3s 重试），不阻塞提交流程
    void refreshHistoryUntilSuccess()
  }

  /** 提交任务，返回是否提交成功（成功后任务进入会话，由轮询跟进） */
  const execute = async (params: any) => {
    loading.value = true
    submitting = true

    try {
      params.sessionId = getSessionId()
      const res = await creationSubmit(params)

      if (res.code !== 0) {
        loading.value = false
        return false
      }

      // 提交即扣费，立即刷新积分余额
      updateUserInfo()
      await afterSubmit(params.sessionId)
      return true
    } catch (e: any) {
      // 提交请求超时/断网时后端可能已创建任务，sessionId 已持久化，兜底发起轮询；
      // 若任务确实未创建，宽限轮数耗尽后完成副作用会复位 loading 并轮换会话
      if (e?.code === 'ECONNABORTED' || e?.message === 'Network Error') {
        // 任务可能已创建，同样刷新一次积分余额
        updateUserInfo()
        await afterSubmit(params.sessionId)
        return true
      }
      loading.value = false
      return false
    } finally {
      submitting = false
    }
  }

  return { execute }
}

/** 产出层面会变的字段：只在这些变了时才替换列表项，免得每轮都让虚拟列表重新测量 */
function liveSignature(task: any): string {
  return JSON.stringify([
    task?.status,
    task?.blocked,
    (task?.contents ?? []).map((c: any) => [
      c.status,
      c.resultUrl,
      c.resultUrls,
      c.coverUrl,
      c.watermarkUrl,
      c.blocked,
      c.errorMsg,
    ]),
  ])
}

/**
 * 把会话轮询拿到的主任务按 taskId 并回历史列表（逐条出图）：只替换已在列表里的项，
 * 还没进列表的新任务交给提交后的历史刷新补进来；列表顺序不动。
 */
export function mergeLiveTasks(list: Ref<any[]>, tasks: any[]) {
  if (!tasks?.length || !list.value.length) return
  const byId = new Map(tasks.filter((t) => t?.taskId).map((t) => [t.taskId, t]))
  list.value.forEach((item, i) => {
    const live = item?.taskId ? byId.get(item.taskId) : undefined
    if (live && liveSignature(live) !== liveSignature(item)) list.value.splice(i, 1, { ...item, ...live })
  })
}
