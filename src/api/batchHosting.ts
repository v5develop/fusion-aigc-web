/**
 * 批量托管（一键铺货，Java /api/v1/batch-hosting/*）接口封装。
 *
 * <p>字段照 fusion-aigc CreaftV1BatchController：响应键一律 lowerCamel；请求体也用驼峰
 * （服务端同时收下划线别名）。query 参数只认驼峰（agentSkillId）。
 *
 * <p>提交是计费接口（按子项数 = modules × num 计费，进入生成后逐子项冻结）。
 * 服务端按 Idempotency-Key 幂等：不带时每次调用都是新批次，所以由调用方传入幂等键，
 * 结果未知时沿用同一个键重发。
 */
import { ApiError, authorizedFetch, del, get, post } from './index.ts'

const PREFIX = '/api/v1/batch-hosting'

/** 分页信封 {current, pages, total, data} */
export interface IBatchPage<T> {
  current: number
  pages: number
  total: number
  data: T[]
}

/** 一个出图模块：按 num 展开成 num 个子项 */
export interface IBatchModuleReq {
  imageType: string
  resolution: string
  aspectRatio: string
  /** 原样回传 /agent/skills 下发的字符串（雪花 id，转 number 会丢精度） */
  agentSkillId: string
  language: string
  num: number
}

/** 批次里的一个任务：一组输入图 + 若干出图模块 */
export interface IBatchTaskReq {
  content: string
  imageUrls: string[]
  modules: IBatchModuleReq[]
}

export interface IBatchSubmitReq {
  title: string
  tasks: IBatchTaskReq[]
}

/** GET /ecom-image/info：某技能可选的图种与分辨率 / 比例 */
export interface IBatchInfo {
  imageTypes: string[]
  resolutionConfigs: { resolution: string; aspectRatios: string[] }[]
}

/**
 * 批次状态：子项实况聚合（PENDING / RUNNING / SUCCEED / PARTIAL_SUCCEED / FAILED / TIMEOUT）；
 * 子项状态为任务状态（PENDING / RUNNING / SUCCEED / FAILED / TIMEOUT / CANCELLED）。
 */
export interface IBatchRow {
  batchHostingId: number | string
  bizType: string | null
  title: string
  status: string
  createdAt: string | null
  updatedAt: string | null
}

/** 子项的任务读模型（与 /api/v1/tasks/* 同形） */
export interface IBatchTaskView {
  taskUid: string
  taskGroupId?: string | null
  status: string
  result?: { url?: string | null } | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface IBatchItem {
  batchHostingItemId: number | string
  imageType: string | null
  payload: {
    content?: string | null
    imageUrls?: string[] | null
    imageType?: string | null
    resolution?: string | null
    aspectRatio?: string | null
    agentSkillId?: string | null
    language?: string | null
    num?: number | null
  } | null
  status: string | null
  errorMessage: string | null
  errorCode: number | null
  taskUid: string | null
  task: IBatchTaskView | null
}

/** 详情：三层嵌套 tasks[].groups[].items[] */
export interface IBatchDetail extends IBatchRow {
  tasks: { index: number; groups: { taskGroupId: string; items: IBatchItem[] }[] }[]
}

/** 批次与子项的终态 */
const TERMINAL = new Set(['SUCCEED', 'PARTIAL_SUCCEED', 'FAILED', 'TIMEOUT', 'CANCELLED'])
export const isBatchTerminal = (s?: string | null) => !!s && TERMINAL.has(s)

/** 提交电商图批量托管：返回 {batchHostingId} */
export function batchSubmitEcomImage(data: IBatchSubmitReq, idempotencyKey: string) {
  return post<{ batchHostingId: number | string }>(`${PREFIX}/ecom-image`, data, {
    'Idempotency-Key': idempotencyKey,
  })
}

/** 我的批次（分页）；bizType 不传为不过滤 */
export function batchList(params: { page: number; size: number; bizType?: string }) {
  return get<IBatchPage<IBatchRow>>(`${PREFIX}/list`, params)
}

/** 某技能的批量托管配置（参数名只认驼峰 agentSkillId） */
export function batchEcomImageInfo(agentSkillId: string) {
  return get<IBatchInfo>(`${PREFIX}/ecom-image/info`, { agentSkillId })
}

export function batchDetail(id: number | string) {
  return get<IBatchDetail>(`${PREFIX}/${encodeURIComponent(String(id))}`)
}

export function batchDelete(id: number | string) {
  return del<null>(`${PREFIX}/${encodeURIComponent(String(id))}`)
}

/**
 * 删除批次里的部分子项（仍在执行的子项服务端拒删）。id 列表放请求体（{itemIds}），
 * 公共 del 只带 query，这里走带 token 的 fetch；业务失败不经 axios 拦截器 toast，由调用方提示。
 */
export async function batchDeleteItems(id: number | string, itemIds: (number | string)[]): Promise<void> {
  let resp: Response
  try {
    resp = await authorizedFetch(`${PREFIX}/${encodeURIComponent(String(id))}/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ itemIds: itemIds.map((v) => String(v)) }),
    })
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'network error', { code: -1, isNetwork: true })
  }
  const json = (await resp.json().catch(() => null)) as { code?: number; msg?: string; reason?: string } | null
  if (resp.ok && json?.code === 0) return
  const code = typeof json?.code === 'number' && json.code !== 0 ? json.code : -1
  throw new ApiError(json?.msg || `删除失败（HTTP ${resp.status}）`, {
    code,
    reason: typeof json?.reason === 'string' ? json.reason : undefined,
    httpStatus: resp.ok ? undefined : resp.status,
  })
}
