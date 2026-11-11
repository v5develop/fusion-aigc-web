import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getUserInfo } from '@/api/methods.ts'
import { rememberAccount } from '@/utils/auth-session.ts'

interface IUserInfo {
  availablePoints: number // 可用点数（不含冻结）
  avatar: string
  phone: string // 手机号（明文，仅用于本地脱敏展示，不得打日志）
}

export const useUserInfoStore = defineStore('useUserInfoStore', () => {
  const userInfo = ref<IUserInfo>()

  // 积分在「提交扣费 / 任务终态（成功、失败退款）」时变化，多处会同时触发刷新。
  // inflight：同一时刻只发一个请求；queued：请求进行中又被触发时，结束后补刷一次，
  // 避免拿到发起时刻的旧余额。
  let inflight: Promise<void> | null = null
  let queued = false

  const request = () => {
    // 记下发请求时的 token：响应回来时 token 已经换了（登录 / 换号 / 刷新），这份用户信息就不能拿来认账号
    const tokenAtRequest = localStorage.getItem('fusion_accessToken')
    return getUserInfo()
      .then((res) => {
        if (res.code === 0) {
          const data = res.data

          // 账号 id 只有这里和登录响应能给（token 是不透明 UUID，解不出身份）。
          // 老会话（身份修好前登录的）也在这里补记，按账号存的字体偏好、「最近」资产随即生效，不必重新登录
          if (tokenAtRequest && tokenAtRequest === localStorage.getItem('fusion_accessToken')) {
            if (rememberAccount(data?.id)) {
              // 本机记的账号和 token 实际所属账号不一致：账号级缓存已清，内存里的 store 还是旧账号的，整页重建
              window.location.reload()
              return
            }
          }

          userInfo.value = {
            availablePoints: data.availablePoints, // 可用点数（不含冻结）
            avatar: data.avatar,
            phone: data.phone ?? '',
          }
        }
      })
      .catch(() => {})
  }

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

  /**
   * 清掉内存里的用户信息。
   *
   * <p>容器内登出走的是整页 reload，用不上这个；但独立运行时 logoutToLogin 只是
   * `location.hash = '#/login'`，页面不重载——不清的话旧账号的积分和头像会一直挂在导航栏上。
   */
  const reset = () => {
    userInfo.value = undefined
  }

  return { userInfo, updateUserInfo, reset }
})
