/**
 * 视频工作流提交前报价：POST /api/v1/workflows/video/quote（Java `CreaftV1WorkflowQuoteController`）。
 *
 * <p>请求体与 `POST /api/v1/workflows/video` 完全相同（全部标题：video-clone 带 / 不带 `videoClone` 标注、带货复刻…）。
 * 后端走与提交同一段受理与同一报价口径，只读：不建任务、不冻结、不占免费额度；`points` 就是此刻提交会冻结的点数。
 * 用户改参数就能过的受理拒收（原片超过模型上限、参数不合法、视频未解锁、模型暂不可用）回 `available=false` + `reason`
 * （与提交时同一句中文）；归属 / 配置类错误按业务失败返回（已加入静默白名单，不弹全局 toast）。
 */
import { post } from './index.ts'

export interface WorkflowQuoteResolved {
  model?: string | null
  resolution?: string | null
  ratio?: string | null
  duration?: number | null
  /** 是否生成配音；null = 请求没给（按模型默认） */
  generateAudio?: boolean | null
  /** 任务件数（视频工作流恒为 1） */
  count?: number | null
}

export interface WorkflowQuoteResp {
  available: boolean
  /** available=false 时提交会报的原因（用户可读中文） */
  reason: string | null
  reasonCode: string | null
  /** 合计点数 = 提交时冻结的点数；available=false 时为 null */
  points: number | null
  /** 每 priceUnit 的点数；调价后除不尽时为 null */
  unitPoints: number | null
  /** PER_SECOND / PER_VIDEO / PER_REQUEST / POINT … */
  priceUnit: string | null
  /** 按秒为计费秒数（件数 × 秒），其余为件数 */
  quantity: number | null
  resolved: WorkflowQuoteResolved | null
  /** 此刻提交会用上每日免费额度（报价本身不占） */
  freeQuotaApplied: boolean
  balance: number | null
  balanceKnown: boolean
  sufficient: boolean
}

export function workflowVideoQuote(body: Record<string, unknown>) {
  return post<WorkflowQuoteResp>('/api/v1/workflows/video/quote', body)
}
