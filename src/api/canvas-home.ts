/**
 * 画布（Go 网关 /api/v1/canvas）接口封装：管理页 + 节点编辑器。
 *
 * <p>类型与字段对齐 fusion_aigc_go gateway.api 的 canvas 段，snake_case 原样收发，
 * 契约见 fusion_aigc_go/docs/api/api-canvas.md。
 */
import { post, put, toApiError } from './index.ts'
import { goGet, goDel } from './go-http'

const PREFIX = '/api/v1/canvas'

/** 画布摘要（列表项） */
export interface ICanvasSummary {
  id: string
  title: string
  revision: string
  nodeCount: number
  /** 快照里第一张可用图；没有为空串 */
  coverUrl: string
  createdAt: number
  updatedAt: number
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
  nodeCount: number
  coverUrl: string
  createdAt: number
  updatedAt: number
  snapshot: any
}

export interface ICanvasSaveResp {
  revision: string
  updatedAt: number
  nodeCount: number
  coverUrl: string
}

/**
 * 候选结果（对象数组）。run 的 libraryStatus 为空时 URL 已在素材库公有桶、长期可用；
 * 为 pending / failed 时是服务端按私有资源现签的 10 分钟地址（每次查询重签），不能存进节点内容。
 */
export interface ICanvasCandidate {
  url: string
  width: number
  height: number
}

/** 一次节点执行记录（状态机：submitting/queued/running → succeeded/failed/cancelled） */
export interface ICanvasRunResult {
  requestId: string
  runId: string
  canvasId: string
  nodeId: string
  kind: string
  /** submitting / queued / running / succeeded / failed / cancelled */
  status: string
  progress: number
  model: string
  candidates: ICanvasCandidate[]
  /** 当前选中的候选下标（0 起） */
  selectedIndex: number
  /** 视频成品地址；图片 run 为空串。视频 run 的 candidates[0] 是封面图 */
  videoUrl: string
  /** i2p 反推提示词的文本结果，其它为空串 */
  text: string
  credits: number
  requestedCount: number
  error: string
  errorCode: string
  retryable: boolean
  createdAt: number
  finishedAt: number
  /**
   * 产物转存素材库的状态（只增 2026-11-11，仅 succeeded 可能有值；缺省 / 不认识按空处理）：
   * 空 = 已在素材库（或不适用）；pending = 已交付、后台转存中，candidates / videoUrl 是 10 分钟现签地址；
   * failed = 转存永久失败，仍可看可下载（同样是现签地址），素材库里没有这条。
   */
  libraryStatus?: CanvasLibraryStatusRaw
}

/** 接口原样的 library_status：'' / 缺省 = 已在素材库；其余值见 ICanvasRunResult.libraryStatus */
export type CanvasLibraryStatusRaw = '' | 'pending' | 'failed' | (string & {})

export interface ICanvasRuns {
  items: ICanvasRunResult[]
}

/** 画布模板（scope: official / user） */
export interface ICanvasTemplate {
  id: number
  scope: string
  title: string
  description: string
  coverUrl: string
  nodeCount: number
  edgeCount: number
  createdAt: number
}

export interface ICanvasTemplates {
  items: ICanvasTemplate[]
}

/** 模板详情：多带快照（{nodes, edges}，只有结构，模型 / 工具节点的生成结果与运行态已由服务端剥掉） */
export interface ICanvasTemplateDetail extends ICanvasTemplate {
  snapshot: { nodes?: unknown[]; edges?: unknown[]; [key: string]: unknown } | null
}

/** 画布列表（updated_at 倒序） */
export function canvasList(params: { page?: number; pageSize?: number } = {}) {
  return goGet<ICanvasList>(`${PREFIX}/canvases`, { page: 1, pageSize: 20, ...params })
}

/** 新建空白画布（title 空 = 未命名画布） */
export function canvasCreate(data: { title?: string } = {}) {
  return post<ICanvasDetail>(`${PREFIX}/canvases`, data)
}

/** 从模板建画布（节点 / 连线 id 重新生成；title 空 = 模板标题） */
export function canvasFromTemplate(data: { templateId: number; title?: string }) {
  return post<ICanvasDetail>(`${PREFIX}/canvases/from-template`, data)
}

/** 画布详情（含 snapshot） */
export function canvasGet(id: string) {
  return goGet<ICanvasDetail>(`${PREFIX}/canvases/${id}`)
}

/**
 * 重命名。保存接口 snapshot 必填，且不带 if_match_revision 又不 force 会回 1002（契约 2.4），
 * 所以先取当前快照与 revision 原样带回；期间被别处改过则回 4002，由拦截器提示后重试即可。
 */
export async function canvasRename(id: string, title: string) {
  const detail = await canvasGet(id)
  const cur = detail.data
  return put<ICanvasSaveResp>(`${PREFIX}/canvases/${id}`, {
    title,
    snapshot: cur?.snapshot ?? { nodes: [], edges: [] },
    ifMatchRevision: cur?.revision ?? '',
  })
}

/** 删除（逻辑删除） */
export function canvasRemove(id: string) {
  return goDel(`${PREFIX}/canvases/${id}`)
}

/** 另存为：复制已保存的快照（title 空 = 原标题 + 「 - 副本」） */
export function canvasSaveAs(id: string, title?: string) {
  return post<ICanvasDetail>(`${PREFIX}/canvases/${id}/save-as`, title ? { title } : {})
}

/** 画布的执行记录（新的在前）；nodeId 只看该节点 */
export function canvasRuns(id: string, limit = 50, nodeId?: string) {
  return goGet<ICanvasRuns>(`${PREFIX}/canvases/${id}/runs`, { limit, ...(nodeId ? { nodeId: nodeId } : {}) })
}

/** 模板列表（不带快照） */
export function canvasTemplates(scope: 'official' | 'user' | 'all' = 'official') {
  return goGet<ICanvasTemplates>(`${PREFIX}/templates`, { scope })
}

/** 模板详情（含快照）：编辑器「从模板插入」取结构用；官方模板 + 本人模板可见，其余 4001 */
export function canvasTemplateDetail(id: number) {
  return goGet<ICanvasTemplateDetail>(`${PREFIX}/templates/${id}`)
}

// ==================== 节点编辑器 ====================

/** 执行请求里的上游引用（连线在运行时的投影） */
export interface ICanvasRunRef {
  /** prompt / image / video / audio（含别名 image1/image2/first/last/garment/models/image-in） */
  handle: string
  /** 同 handle 内序号（连线 data.order），1 起 */
  index?: number
  nodeId?: string
  text?: string
  image?: string
  video?: string
  audio?: string
  assetId?: string
  mediaId?: string
  /** 来源节点输出口：image-out / candidate-N … */
  sourceHandle?: string
  /** 引用上游第几个候选（0 起） */
  candidateIndex?: number
  mime?: string
}

/** 执行单个节点的请求体（契约 3.1 / 3.2） */
export interface ICanvasRunReq {
  /** 前端生成的 UUID，同时放在 Idempotency-Key 头 */
  runId: string
  kind: 'image' | 'video' | 'tool'
  model?: string
  modelId?: string
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
  requestId: string
  runId: string
  status: string
  replayed: boolean
  /** 本次 run 预留（冻结）的点数 */
  credits: number
  warnings: string[]
}

export interface ICanvasCancelResp {
  requestId: string
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
  /** wire 值（节点 data.model：Image / Banana / SD5P / SD55 …），不直接给用户看 */
  model: string
  /** 用户可见的完整模型名（GPT Image 2.5 / Nano Banana 2.1 / Seedream 5.5 …）；旧后端没有时按 modelLabelOf 映射 */
  label?: string
  modelId: string
  badge: string
  maxImageRefs: number
  maxReferenceVideos: number
  ratios: string[]
  /** 图 1K/2K；视频 720p/1080p/4K */
  sizes: string[]
  qualities: string[]
  durations: string[]
  sound: boolean
  countMax: number
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
  imageModels: ICanvasCatalogModel[]
  video_models: ICanvasCatalogModel[]
  tools: ICanvasCatalogTool[]
}

/** 模型 / 参数目录（替代前端写死；面板字段按 capabilities 动态显示） */
export function canvasCatalog() {
  return goGet<ICanvasCatalog>(`${PREFIX}/catalog`)
}

/** 执行单个节点；幂等键 = run_id，必须与 body.runId 一致 */
export function canvasNodeRun(canvasId: string, nodeId: string, data: ICanvasRunReq, idempotencyKey: string) {
  return post<ICanvasRunSubmitResp>(`${PREFIX}/canvases/${canvasId}/nodes/${nodeId}/run`, data, {
    'Idempotency-Key': idempotencyKey,
  })
}

/** 查询一次执行（轮询用，1.2s 间隔） */
export function canvasRunGet(requestId: string) {
  return goGet<ICanvasRunResult>(`${PREFIX}/runs/${requestId}`)
}

/** 取消执行（gateway 退点 / studio 取消批次 / Java 工具调 Java 取消；无请求体） */
export function canvasRunCancel(requestId: string) {
  return post<ICanvasCancelResp>(`${PREFIX}/runs/${requestId}/cancel`, {})
}

/** 选中候选：写回 run.selectedIndex，刷新后保持 */
export function canvasSelectCandidate(canvasId: string, nodeId: string, data: { runId: string; index: number }) {
  return post<ICanvasRunResult>(`${PREFIX}/canvases/${canvasId}/nodes/${nodeId}/select-candidate`, data)
}

/**
 * 保存（乐观锁）。走共享拦截器：令牌过期时由它单航班刷新并重放（自动保存常在长时间编辑后发生，
 * 裸 axios 遇 401 只会一直保存失败）。保存接口的 4002 只有版本冲突一种（契约 2.4），
 * 这里把它还原成冲突信封交给编辑器弹「载入最新 / 覆盖保存」；其余失败照常 reject（拦截器已 toast）。
 */
export interface ICanvasApiEnvelope<T = unknown> {
  code: number
  msg: string
  data: T
}

export interface ICanvasSaveConflict {
  conflict: 'revision'
  revision: string
  updatedAt: number
}

export function canvasSaveWithLock(
  id: string,
  data: { title?: string; snapshot: unknown; ifMatchRevision?: string; force?: boolean },
): Promise<ICanvasApiEnvelope<ICanvasSaveResp | ICanvasSaveConflict>> {
  return put<ICanvasSaveResp>(`${PREFIX}/canvases/${id}`, data, undefined, 15000).then(
    (res) => ({ code: 0, msg: res.msg ?? 'ok', data: res.data }) as ICanvasApiEnvelope<ICanvasSaveResp>,
    (err: unknown) => {
      const apiErr = toApiError(err)
      if (apiErr?.code === 4002) {
        return {
          code: 4002,
          msg: apiErr.message,
          data: { conflict: 'revision', revision: '', updatedAt: 0 },
        } as ICanvasApiEnvelope<ICanvasSaveConflict>
      }
      throw err
    },
  )
}

// ---------------- 上传（快照里禁止 dataURL，先传 OSS 换 URL） ----------------

interface IGoPresign {
  putUrl: string
  url: string
  contentType: string
  expiresAt: number
}

/** 上传图片 / 视频到 OSS（网关预签名直传），返回可放进快照的 http(s) 地址 */
/** @param opts.signal 取消上传（节点「取消」）：中止直传 PUT，调用方收到 AbortError */
export async function canvasUploadMedia(file: File, opts?: { signal?: AbortSignal }): Promise<string> {
  const isVideo = file.type.startsWith('video/')
  const contentType = file.type || (isVideo ? 'video/mp4' : 'image/jpeg')
  const res = await post<IGoPresign>('/api/v1/local-life/upload/presign', {
    kind: isVideo ? 'video' : 'image',
    contentType,
  })
  const { putUrl: putUrl, url, contentType: signedType } = res.data ?? ({} as IGoPresign)
  if (!putUrl || !url) {
    throw new Error('获取上传凭证失败')
  }
  opts?.signal?.throwIfAborted()
  const put = await fetch(putUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': signedType || contentType },
    signal: opts?.signal,
  })
  if (!put.ok) {
    throw new Error(isVideo ? '视频上传失败' : '图片上传失败')
  }
  return url
}
