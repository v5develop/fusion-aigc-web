/**
 * 工具箱（/tools/:toolId）接口：Java v1 兼容路由 `/api/v1/tools/*`。
 *
 * <p>复用 api/index.ts 的实例：token 注入、401 刷新、业务错误 toast 全部沿用，这里不吞错。
 * 请求体是 Java `CoreToolSubmissionRequest` 的 camelCase 子集（抠图是 `CreaftV1CutoutRequest`），
 * 出网键名同为 lowerCamel（Java CompatV1HistoryView 注释）。
 *
 * <p>提交即计费；不带 Idempotency-Key 时重试会重复扣费，所以每次提交都带一个新的 UUID。
 */
import { get, post } from './index.ts'
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

/** 文字识别（同步，单独计费）：文字替换的「识别文字」 */
export function toolOcr(imageUrl: string) {
  return post<OcrResult>('/api/v1/tools/ocr', { imageUrl }, idempotency(), SUBMIT_TIMEOUT)
}

/** 音色库（视频翻译的配音音色） */
export function voiceList(page = 1, size = 100) {
  return get<{ current: number; pages: number; total: number; data: VoiceItem[] }>('/api/v1/voices/list', {
    page,
    size,
  })
}
