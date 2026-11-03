/**
 * 点数（fusion-aigc 原生用户接口 /api/v1/points）。
 *
 * <p>契约见 fusion-aigc contracts/user-api-compat-v1/manifest.json 的 points/balance；
 * 响应体字段取自 PointsBalanceRespVO（balance 为可用余额，不含冻结）。
 */
import { get } from './index.ts'

/** 点数余额（只声明前端用到的字段） */
export interface PointsBalance {
  /** 可用余额（不含冻结） */
  balance: number
  /** 冻结余额 */
  frozenBalance?: number
  /** 总余额（可用 + 冻结） */
  totalBalance?: number
}

/** 查询当前用户点数余额 */
export function getPointsBalance() {
  return get<PointsBalance>('/api/v1/points/balance')
}
