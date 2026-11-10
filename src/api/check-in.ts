/**
 * 每日签到接口（Java CheckInController，/api/v1/users/check-in）。
 *
 * <p>开关在后台「签到设置」（afv_system_config.check_in.enabled），由 GET 状态里的 enabled 下发；
 * GET 只读、开关关闭时也能调。enabled=false 时前端不渲染入口，也不调 POST。
 */
import { get, post } from './index.ts'

export interface ICheckInDay {
  /** yyyy-MM-dd */
  date: string
  checkedIn: boolean
  rewardPoints: number
}

export interface ICheckInStatus {
  enabled: boolean
  todayCheckedIn: boolean
  consecutiveDays: number
  /** 按日期升序，最后一项是今天 */
  recentDays: ICheckInDay[]
  /** 下一次签到可得点数（今日已签则是明天的） */
  nextRewardPoints: number
}

export interface ICheckInResult {
  checkInDate: string
  consecutiveDays: number
  rewardPoints: number
  balanceAfter: number
  nextRewardPoints: number
}

export function checkInStatus() {
  return get<ICheckInStatus>('/api/v1/users/check-in')
}

export function checkInSubmit() {
  return post<ICheckInResult>('/api/v1/users/check-in', {})
}
