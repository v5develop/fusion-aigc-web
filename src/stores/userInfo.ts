import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getUserInfo } from '@/api/methods.ts'

interface IUserInfo {
  availablePoints: number // 可用点数（不含冻结）
  avatar: string
}

export const useUserInfoStore = defineStore('useUserInfoStore', () => {
  const userInfo = ref<IUserInfo>()

  // 积分在「提交扣费 / 任务终态（成功、失败退款）」时变化，多处会同时触发刷新。
  // inflight：同一时刻只发一个请求；queued：请求进行中又被触发时，结束后补刷一次，
  // 避免拿到发起时刻的旧余额。
  let inflight: Promise<void> | null = null
  let queued = false

  const request = () =>
    getUserInfo()
      .then((res) => {
        if (res.code === 0) {
          const data = res.data

          userInfo.value = {
            availablePoints: data.availablePoints, // 可用点数（不含冻结）
            avatar: data.avatar,
          }
        }
      })
      .catch(() => {})

  /** 主动刷新用户信息（积分余额） */
  const updateUserInfo = (): Promise<void> => {
    if (inflight) {
      queued = true
      return inflight
    }

    inflight = request().finally(() => {
      inflight = null
      if (queued) {
        queued = false
        void updateUserInfo()
      }
    })

    return inflight
  }

  const fetchUserInfo = () => {
    if (userInfo.value) return
    void updateUserInfo()
  }
  fetchUserInfo()

  return { userInfo, updateUserInfo }
})
