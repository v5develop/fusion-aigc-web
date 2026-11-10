/**
 * 本地生活（Go 网关）提交前报价：POST /api/v1/local-life/quote（契约见 Go 仓库 docs/api/api-app.md「提交前报价」）。
 *
 * <p>只读：不冻结、不落库。报价由真正冻结点数的服务用提交时同一个计费请求算，回的 points 就是提交会冻结的点数。
 * 参数不合法 / 未配价格 / 未开通该功能不报错，回 available=false + reason；业务失败已加入静默白名单，不弹全局 toast。
 */
import { post } from './index.ts'

/** 工具 = 计费入口码 */
export type LLQuoteTool =
  | 'poster'
  | 'longImage'
  | 'actionTransfer'
  | 'voiceover'
  | 'digitalHuman'
  | 'copywriting'
  | 'imageTextNote'
  | 'exploreShop'
  | 'shortDrama'
  | 'videoRemake'

export interface LLQuoteReq {
  tool: LLQuoteTool
  /** 模型档位；不传用后台默认（海报档位不影响价格） */
  model?: string
  /** 视频时长（秒）：口播 / 探店 / 短剧 */
  duration?: number
  /** 海报 / 长图张数、图文笔记套图张数 */
  imageCount?: number
  /** 探店 / 短剧 / 复刻：已构思 / 已解析的记录 id；图文笔记：方案已出（配图阶段）的笔记 id，按记录张数报并校验不超过方案张数 */
  id?: number
}

export interface LLQuoteResp {
  available: boolean
  reason: string
  /** on 真扣 / shadow 只算价不扣 / off 不计费 */
  billingMode: string
  /** 提交是否真的冻结点数；false 时提交冻结 0 点 */
  charged: boolean
  /** 本次会冻结的点数；exact=false 时为最低价（数字人）或每秒单价（复刻未解析） */
  points: number
  unitPoints: number
  priceUnit: string
  quantity: number
  exact: boolean
  /** exact=false 时的最高价；0 = 不知道 */
  pointsMax: number
  /** submit 提交即冻结 / generate 构思免费、出片（出图）时冻结 */
  stage: 'submit' | 'generate' | string
  balance: number
  balanceKnown: boolean
  sufficient: boolean
  /** 余额是否够 points_max（只有数字人有最高价，其余同 sufficient）；不够只提示、不拦提交 */
  sufficientMax: boolean
  /** 本地生活冻结不扣免费额度，恒为 0 */
  freeQuota: number
}

export function llQuote(data: LLQuoteReq) {
  return post<LLQuoteResp>('/api/v1/local-life/quote', data)
}
