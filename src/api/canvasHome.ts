/**
 * 画布（Go 网关 /api/v1/canvas）接口封装：管理页 + 节点编辑器。
 *
 * <p>类型与字段对齐 fusion_aigc_go gateway.api 的 canvas 段，snake_case 原样收发，
 * 契约见 fusion_aigc_go/docs/api/api-canvas.md。
 */
import axios from 'axios'
import { get, post, put, del } from './index.ts'

const PREFIX = '/api/v1/canvas'

/** 画布摘要（列表项） */
export interface ICanvasSummary {
  id: string
  title: string
  revision: string
  node_count: number
  /** 快照里第一张可用图；没有为空串 */
  cover_url: string
  created_at: number
  updated_at: number
}

export interface ICanvasList {
  items: ICanvasSummary[]
  total: number
}

/** 画布详情。snapshot 是前端私有 JSON（Vue Flow 快照 {nodes, edges}），服务端整段存 */
export interface ICanvasDetail {
  id: string
  title: string
  /** 下次保存原样带回 if_match_revision */
  revision: string
  node_count: number
  cover_url: string
  created_at: number
  updated_at: number
  snapshot: any
}

export interface ICanvasSaveResp {
  revision: string
  updated_at: number
  node_count: number
  cover_url: string
}

/** 候选结果（对象数组，URL 已转存我方公有桶） */
export interface ICanvasCandidate {
  url: string
  width: number
  height: number
}

/** 一次节点执行记录（状态机：submitting/queued/running → succeeded/failed/cancelled） */
export interface ICanvasRunResult {
  request_id: string
  run_id: string
  canvas_id: string
  node_id: string
  kind: string
  /** submitting / queued / running / succeeded / failed / cancelled */
  status: string
  progress: number
  model: string
  candidates: ICanvasCandidate[]
  /** 当前选中的候选下标（0 起） */
  selected_index: number
  /** 视频成品地址；图片 run 为空串。视频 run 的 candidates[0] 是封面图 */
  video_url: string
  /** i2p 反推提示词的文本结果，其它为空串 */
  text: string
  credits: number
  requested_count: number
  error: string
  error_code: string
  retryable: boolean
  created_at: number
  finished_at: number
}

export interface ICanvasRuns {
  items: ICanvasRunResult[]
}

/** 画布模板（scope: official / user） */
export interface ICanvasTemplate {
  id: number
  scope: string
  title: string
  description: string
  cover_url: string
  node_count: number
  edge_count: number
  created_at: number
}

export interface ICanvasTemplates {
  items: ICanvasTemplate[]
}

/** 画布列表（updated_at 倒序） */
export function canvasList(params: { page?: number; page_size?: number } = {}) {
  return get<ICanvasList>(`${PREFIX}/canvases`, { page: 1, page_size: 20, ...params })
}

/** 新建空白画布（title 空 = 未命名画布） */
export function canvasCreate(data: { title?: string } = {}) {
  return post<ICanvasDetail>(`${PREFIX}/canvases`, data)
}

/** 从模板建画布（节点 / 连线 id 重新生成；title 空 = 模板标题） */
export function canvasFromTemplate(data: { template_id: number; title?: string }) {
  return post<ICanvasDetail>(`${PREFIX}/canvases/from-template`, data)
}

/** 画布详情（含 snapshot） */
export function canvasGet(id: string) {
  return get<ICanvasDetail>(`${PREFIX}/canvases/${id}`)
}

/** 重命名：管理页约定只传 title，不动快照 */
export function canvasRename(id: string, title: string) {
  return put<ICanvasSaveResp>(`${PREFIX}/canvases/${id}`, { title })
}

/** 删除（逻辑删除） */
export function canvasRemove(id: string) {
  return del(`${PREFIX}/canvases/${id}`)
}

/** 另存为：复制已保存的快照（title 空 = 原标题 + 「 - 副本」） */
export function canvasSaveAs(id: string, title?: string) {
  return post<ICanvasDetail>(`${PREFIX}/canvases/${id}/save-as`, title ? { title } : {})
}

/** 画布的执行记录（新的在前） */
export function canvasRuns(id: string, limit = 50) {
  return get<ICanvasRuns>(`${PREFIX}/canvases/${id}/runs`, { limit })
}

/** 模板列表 */
export function canvasTemplates(scope: 'official' | 'user' | 'all' = 'official') {
  return get<ICanvasTemplates>(`${PREFIX}/templates`, { scope })
}

// ==================== 节点编辑器 ====================

/** 执行请求里的上游引用（连线在运行时的投影） */
export interface ICanvasRunRef {
  /** prompt / image / video / audio（含别名 image1/image2/first/last/garment/models/image-in） */
  handle: string
  /** 同 handle 内序号（连线 data.order），1 起 */
  index?: number
  node_id?: string
  text?: string
  image?: string
  video?: string
  audio?: string
  asset_id?: string
  media_id?: string
  /** 来源节点输出口：image-out / candidate-N … */
  source_handle?: string
  /** 引用上游第几个候选（0 起） */
  candidate_index?: number
  mime?: string
}

/** 执行单个节点的请求体（契约 3.1 / 3.2） */
export interface ICanvasRunReq {
  /** 前端生成的 UUID，同时放在 Idempotency-Key 头 */
  run_id: string
  kind: 'image' | 'video' | 'tool'
  model?: string
  model_id?: string
  prompt?: string
  references?: ICanvasRunRef[]
  ratio?: string
  size?: string
  /** low / medium / high（快照里存中文，提交时转换） */
  quality?: string
  /** 视频 4s / 6s / 8s */
  duration?: string
  sound?: boolean
  /** 候选数 1–4；视频固定 1 */
  count?: number
  cfg?: number
  /** crop / upscale / outpaint / i2p / mask / tryon */
  tool?: string
  params?: Record<string, unknown>
}

export interface ICanvasRunSubmitResp {
  /** 服务端 run 号，轮询 / 取消用它 */
  request_id: string
  run_id: string
  status: string
  replayed: boolean
  /** 本次 run 预留（冻结）的点数 */
  credits: number
  warnings: string[]
}

export interface ICanvasCancelResp {
  request_id: string
  status: string
}

/** 模型能力（对应原型 data.capabilities，决定参数面板显示哪些控件） */
export interface ICanvasCapabilities {
  quality: boolean
  count: boolean
  duration: boolean
  sound: boolean
}

export interface ICanvasCatalogModel {
  model: string
  model_id: string
  badge: string
  max_image_refs: number
  max_reference_videos: number
  ratios: string[]
  /** 图 1K/2K；视频 720p/1080p/4K */
  sizes: string[]
  qualities: string[]
  durations: string[]
  sound: boolean
  count_max: number
  capabilities: ICanvasCapabilities
  prices: { size?: string; duration?: string; points: number }[]
  /** false = gateway 没有该组或已停用 */
  ready: boolean
}

export interface ICanvasCatalogTool {
  tool: string
  label: string
  /** free / java / gateway / studio */
  billing: string
  scales?: number[]
  ratios?: string[]
  ready: boolean
}

export interface ICanvasCatalog {
  image_models: ICanvasCatalogModel[]
  video_models: ICanvasCatalogModel[]
  tools: ICanvasCatalogTool[]
}

/** 模型 / 参数目录（替代前端写死；面板字段按 capabilities 动态显示） */
export function canvasCatalog() {
  return get<ICanvasCatalog>(`${PREFIX}/catalog`)
}

/** 执行单个节点；幂等键 = run_id，必须与 body.run_id 一致 */
export function canvasNodeRun(canvasId: string, nodeId: string, data: ICanvasRunReq, idempotencyKey: string) {
  return post<ICanvasRunSubmitResp>(`${PREFIX}/canvases/${canvasId}/nodes/${nodeId}/run`, data, {
    'Idempotency-Key': idempotencyKey,
  })
}

/** 查询一次执行（轮询用，1.2s 间隔） */
export function canvasRunGet(requestId: string) {
  return get<ICanvasRunResult>(`${PREFIX}/runs/${requestId}`)
}

/** 取消执行（gateway 退点 / studio 取消批次 / Java 工具调 Java 取消；无请求体） */
export function canvasRunCancel(requestId: string) {
  return post<ICanvasCancelResp>(`${PREFIX}/runs/${requestId}/cancel`, {})
}

/** 选中候选：写回 run.selected_index，刷新后保持 */
export function canvasSelectCandidate(canvasId: string, nodeId: string, data: { run_id: string; index: number }) {
  return post<ICanvasRunResult>(`${PREFIX}/canvases/${canvasId}/nodes/${nodeId}/select-candidate`, data)
}

/**
 * 保存（乐观锁）。不走共享拦截器：冲突要按 code=4002 + data.conflict==='revision' 分支处理，
 * 而共享拦截器对业务失败只回 Error(msg)，拿不到 code；本请求也不需要它代弹 toast
 * （冲突弹确认框、其余错误由编辑器按信封 msg 提示）。鉴权与 401 语义与共享层一致。
 */
export interface ICanvasApiEnvelope<T = unknown> {
  code: number
  msg: string
  data: T
}

export interface ICanvasSaveConflict {
  conflict: 'revision'
  revision: string
  updated_at: number
}

export function canvasSaveWithLock(
  id: string,
  data: { title?: string; snapshot: unknown; if_match_revision?: string; force?: boolean },
): Promise<ICanvasApiEnvelope<ICanvasSaveResp | ICanvasSaveConflict>> {
  const token = localStorage.getItem('fusion_accessToken')
  const baseURL = import.meta.env.VITE_FUSION_API_BASE as string | undefined
  return axios
    .put<ICanvasApiEnvelope<ICanvasSaveResp | ICanvasSaveConflict>>(`${baseURL ?? ''}${PREFIX}/canvases/${id}`, data, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 15000,
    })
    .then((res) => res.data)
}

// ---------------- 上传（快照里禁止 dataURL，先传 OSS 换 URL） ----------------

interface IGoPresign {
  put_url: string
  url: string
  content_type: string
  expires_at: number
}

/** 上传图片 / 视频到 OSS（网关预签名直传），返回可放进快照的 http(s) 地址 */
export async function canvasUploadMedia(file: File): Promise<string> {
  const isVideo = file.type.startsWith('video/')
  const contentType = file.type || (isVideo ? 'video/mp4' : 'image/jpeg')
  const res = await post<IGoPresign>('/api/v1/local-life/upload/presign', { kind: isVideo ? 'video' : 'image', contentType })
  const { put_url: putUrl, url, content_type: signedType } = res.data ?? ({} as IGoPresign)
  if (!putUrl || !url) {
    throw new Error('获取上传凭证失败')
  }
  const put = await fetch(putUrl, { method: 'PUT', body: file, headers: { 'Content-Type': signedType || contentType } })
  if (!put.ok) {
    throw new Error(isVideo ? '视频上传失败' : '图片上传失败')
  }
  return url
}
