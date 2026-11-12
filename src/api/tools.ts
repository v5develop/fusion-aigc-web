/**
 * 工具箱（/tools/:toolId）接口：Java v1 兼容路由 `/api/v1/tools/*`。
 *
 * <p>复用 api/index.ts 的实例：token 注入、401 刷新、业务错误 toast 全部沿用，这里不吞错。
 * 请求体是 Java `CoreToolSubmissionRequest` 的 camelCase 子集（抠图是 `CreaftV1CutoutRequest`），
 * 出网键名同为 lowerCamel（Java CompatV1HistoryView 注释）。
 *
 * <p>提交即计费；不带 Idempotency-Key 时重试会重复扣费，所以每次提交都带一个新的 UUID。
 */
import { ApiError, authorizedFetch, get, post } from './index.ts'
import type { ApiResponse } from './types'
import { createSafeUuid } from '@/utils/utils'

/** 异步工具的提交凭据（CoreToolWorkflowSubmissionAdapter.Submission，NON_NULL：tools 路由只有 taskId 或 taskIds） */
export interface ToolSubmission {
  taskId?: string
  taskIds?: string[]
}

/** 同步抠图成功时的 data */
export interface CutoutResult {
  url: string
}

/**
 * 「重新编辑」用的原始提交体（CompatV1HistoryView.ToolHistory.requestParams，工作流同 WorkflowData.requestParams）：
 * 任务 request_params.request，即 Java CoreToolSubmissionRequest 绑定、校验之后的形状——camelCase、空字段不落、
 * 鉴权 / 令牌类键已由服务端剔除。2026-09-24 之前的老任务、抠图等不写快照的路径、快照损坏时整段为 null。
 *
 * <p>只列端侧回填会读的键（键名逐字抄 CoreToolSubmissionRequest），其余键原样保留但不读；
 * 值来自服务端存档，回填时仍按运行时类型逐项判定，不信任这里的静态类型。
 */
export interface SubmittedToolRequest {
  title?: string
  content?: string
  imageUrls?: string[]
  imageUrl?: string
  originalImageUrl?: string
  maskUrl?: string
  productImageUrl?: string
  videoUrl?: string
  /** 仅 /tools/ai-posture-fission：姿势参考图（mode=reference） */
  referenceImageUrl?: string
  /** 仅 /tools/ai-model-tryon */
  clothImageUrl?: string
  modelImageUrl?: string
  /** 仅 /tools/ai-posture-fission：fission / reference / imitation */
  mode?: string
  /** 仅 /tools/ai-video-generator：模型别名、视频比例（不是 aspectRatio）、时长秒数、是否生成音频 */
  model?: string
  ratio?: string
  duration?: number
  generateAudio?: boolean
  resolution?: string
  aspectRatio?: string
  num?: number
  rewritePrompt?: boolean
  language?: string
  targetLanguage?: string
  voiceModel?: string
  voiceKey?: string
  addSubtitle?: boolean
  eraseOriginalSubtitle?: boolean
  width?: number
  height?: number
  /** 仅 /workflows/visual：产品图 + 逐件文案 */
  prdImageUrls?: { url?: string; content?: string }[]
  /** 仅 /tools/ai-text-replace：pos 是像素四点 */
  textInformation?: {
    targetText?: string
    text?: string
    textRectangles?: {
      angle?: number
      height?: number
      left?: number
      top?: number
      width?: number
      pos?: { x?: number; y?: number }[]
    }
  }[]
  /** 工作流模板选项（只用于回填，不参与生成） */
  promptOptions?: Record<string, unknown>
  [key: string]: unknown
}

/** GET /api/v1/tools/{toolTitle}/histories 的单条（CompatV1HistoryView.ToolHistory） */
export interface ToolHistoryItem {
  aiToolHistoryId: number
  taskUid: string
  taskGroupId?: string | null
  /** PENDING / RUNNING / WAITING_MANUAL_PROCESS / SUCCEED / FAILED / TIMEOUT / CANCELLED */
  status: string
  payload?: { prompt?: string | null; imageUrls?: string[] | null; videoUrls?: string[] | null } | null
  result?: { url?: string | null } | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  inputImageUrls?: string[] | null
  resultImageUrls?: string[] | null
  inputVideoUrls?: string[] | null
  resultVideoUrls?: string[] | null
  /** 原始提交体，「重新编辑」回填用；老记录为 null（见 SubmittedToolRequest） */
  requestParams?: SubmittedToolRequest | null
  /** 进行中任务的估算进度 0–100（后端与任务中心同一口径）；终态行不下发 */
  progress?: number | null
}

/** v1 分页信封 {current, pages, total, data} */
export interface ToolHistoryPage {
  current: number
  pages: number
  total: number
  data: ToolHistoryItem[]
}

/** OCR 同步识别结果（阿里云原样，键名大写） */
export interface OcrResult {
  Results?: {
    Probability?: number
    Text?: string
    TextRectangles?: {
      Angle?: number
      Height?: number
      Left?: number
      Top?: number
      Width?: number
      Pos?: { x: number; y: number }[]
    }
  }[]
}

/** GET /api/v1/voices/list 的单条（CreaftV1CatalogService.VoiceView） */
export interface VoiceItem {
  voiceId: number
  voiceName: string
  voiceKey: string
  model: string
  meta?: unknown
  tags?: string[]
}

/** 提交是重操作（取图探测、冻结点数）；抠图服务端最多等 50 秒 */
const SUBMIT_TIMEOUT = 60000

const idempotency = () => ({ 'Idempotency-Key': createSafeUuid() })

/** 异步工具提交：POST 到 schema.javaRoute */
export function submitTool(route: string, body: Record<string, unknown>) {
  return post<ToolSubmission>(route, body, idempotency(), SUBMIT_TIMEOUT)
}

/** 同步抠图：成功 data={url}；等不及时 code=3010（由拦截器提示，结果进抠图历史） */
export function submitCutout(imageUrl: string) {
  return post<CutoutResult>('/api/v1/tools/cutout', { imageUrl }, idempotency(), SUBMIT_TIMEOUT)
}

/** 某个工具的历史（只返回本人的记录；toolTitle 是工具路径最后一段） */
export function toolHistories(toolTitle: string, page = 1, size = 20) {
  return get<ToolHistoryPage>(`/api/v1/tools/${toolTitle}/histories`, { page, size })
}

/**
 * 带 JSON 请求体的 DELETE（Java 历史批量删除是 `@RequestBody`）。
 *
 * <p>api/index.ts 的 del() 只带 query，这里借 authorizedFetch（同一 baseURL、Bearer、401 刷新）发请求体；
 * 它不走 axios 拦截器，所以<b>业务失败不会自动 toast</b>：一律抛 ApiError，由调用方提示。
 */
export async function deleteWithBody(url: string, body: Record<string, unknown>): Promise<void> {
  let resp: Response
  try {
    resp = await authorizedFetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : '网络异常', { code: -1, isNetwork: true })
  }
  const json = (await resp.json().catch(() => null)) as ApiResponse | null
  const code = typeof json?.code === 'number' ? json.code : -1
  if (resp.ok && code === 0) return
  throw new ApiError(json?.msg || '删除失败，请重试', {
    code: code === 0 ? -1 : code,
    httpStatus: resp.ok ? undefined : resp.status,
  })
}

/**
 * 删除工具历史：DELETE /api/v1/tools/{toolTitle}/histories，请求体 {aiToolHistoryIds:[id]}。
 * 整批校验，任务仍在进行中会整批拒绝。
 */
export function deleteToolHistories(toolTitle: string, ids: number[]) {
  return deleteWithBody(`/api/v1/tools/${toolTitle}/histories`, { aiToolHistoryIds: ids })
}

/**
 * GET /api/v1/features/biz-points：按当前用户返回「业务 → 所需点数」（只用于展示，不构成预留）。
 * 值有两种：纯数字（cutout / ocr / aiWrite），或按档位的对象（videoEnhance[tier] = {points, unit}）；
 * 报不出价的项不下发。
 */
export function bizPoints() {
  return get<Record<string, unknown>>('/api/v1/features/biz-points')
}

/** 文字识别（同步，单独计费）：文字替换的「识别文字」 */
export function toolOcr(imageUrl: string) {
  return post<OcrResult>('/api/v1/tools/ocr', { imageUrl }, idempotency(), SUBMIT_TIMEOUT)
}

/** model-configs 的一档：points 是该档单价（图片按张；视频按秒） */
export interface ModelConfigSize {
  resolution: string
  /** 图片 / 视频这一档可选的比例 */
  aspectRatio?: string[]
  points?: number
}

/**
 * GET /api/v1/features/{image,video}-model-configs 的单条（CompatFeaturePricingService.modelConfigs）。
 * 视频多 weight / supportedModes（i2v / t2v / v2v，空 = 未建模）/ duration:[min,max]（空 = 未建模）。
 */
export interface ModelConfig {
  model: string
  /** 品牌显示名（如「Seedance 2.5」）；没有时界面写 model */
  displayName?: string
  description?: string
  size?: ModelConfigSize[]
  weight?: number
  supportedModes?: string[]
  duration?: number[]
  /**
   * 该模型参考素材上限（视频与图片生成都下发）：maxImages 缺省按 9；maxVideos 仅视频，0 表示不支持参考视频
   */
  refs?: { maxImages?: number; maxVideos?: number }
  /** 仅图片生成：运营设的默认模型（进页初始选中它；都没标时取第一项） */
  default?: boolean
}

/**
 * 图片生成（/tools/ai-image-generator）的模型与价目：default=true 的是默认模型（没标时第一项），运营启用后才有多项；
 * 每项 size[] 是该模型的分辨率 / 比例与单价。提交可带 model（不带或带第一项 = 默认行为）。
 */
export function imageModelConfigs(route?: string) {
  // route（加法参数）：清单与单价按该路由自己的能力绑定出（如图片复刻 /tools/ai-poster-replicate）；不传 = 图片生成，行为不变
  return get<ModelConfig[]>('/api/v1/features/image-model-configs', route ? { route } : undefined)
}

/** 视频生成（/tools/ai-video-generator）可选的模型与各档每秒单价，按 weight 降序 */
export function videoModelConfigs() {
  return get<ModelConfig[]>('/api/v1/features/video-model-configs')
}

/** 音色库（视频翻译的配音音色） */
export function voiceList(page = 1, size = 100) {
  return get<{ current: number; pages: number; total: number; data: VoiceItem[] }>('/api/v1/voices/list', {
    page,
    size,
  })
}
