/**
 * 画布编辑器 —— 快照结构类型。
 *
 * <p>快照是前端私有文档（Vue Flow 的 {nodes, edges}），服务端只校验不翻译：
 * 节点 data 内部保持 camelCase，接口外层字段才是 snake_case（契约 1.4 / 第 5 章）。
 * 运行态字段（status/progress/candidates/image/video/runId/requestId/…）不随快照存储：
 * 保存时服务端剥离，GET 时按最近一次 run 回填，前端不必清理。
 *
 * <p>节点 data 用单一扁平接口（同原型 useCanvasStore 的 CanvasNodeData）：
 * 字段是否生效由 data.kind 决定（text / image / video / model / video / tool / module），
 * 不做可辨识联合——各分支共享字段（image、candidates 等）跨 kind 访问无需收窄。
 */

/** 模型能力（与 catalog 的 capabilities 对应，决定参数面板显示哪些控件） */
export interface ICanvasModelCapabilities {
  quality?: boolean
  count?: boolean
  duration?: boolean
  sound?: boolean
}

export interface ICanvasCropRect {
  shape?: 'rect' | 'circle'
  /** 相对原图 0–1 */
  x: number
  y: number
  w: number
  h: number
}

export type CanvasToolKind = 'crop' | 'upscale' | 'outpaint' | 'i2p' | 'mask' | 'tryon'

/** 节点 data（扁平结构；kind 决定哪些字段生效） */
export interface CanvasNodeData {
  title: string
  subtitle?: string
  width?: number
  height?: number
  /** text=提示词 / input=输入图 / result=结果图 / video-input=视频输入 / model=图片生成 / video=视频生成 / tool=工具 / module=分组框 */
  kind?: 'text' | 'input' | 'result' | 'video-input' | 'model' | 'video' | 'tool' | 'module'
  // ---- 文本节点 ----
  text?: string
  mentions?: unknown[]
  // ---- 图片 / 视频（输入节点是用户内容；模型 / 工具节点上是成品运行态） ----
  image?: string
  video?: string
  assetId?: string
  mediaId?: string
  // ---- 生成节点参数 ----
  model?: string
  modelId?: string
  badge?: string
  maxImageRefs?: number
  capabilities?: ICanvasModelCapabilities
  ratio?: string
  size?: string
  /** 低 / 中 / 高（提交时转英文） */
  quality?: string
  duration?: string
  sound?: boolean
  count?: number
  cfg?: number
  prompt?: string
  /** true = 参考视频素材节点，不执行 */
  inputOnly?: boolean
  // ---- 工具节点 ----
  tool?: CanvasToolKind
  /** 不连线时的上游图片来源节点 */
  sourceNodeId?: string
  crop?: ICanvasCropRect
  scale?: number
  /** 扩图分辨率（缺省 2k）；与 outWidth / outHeight 二选一 */
  resolution?: string
  /** 扩图显式宽高（须成对） */
  outWidth?: number
  outHeight?: number
  // ---- 模特试穿参数 ----
  tryonItems?: string[]
  garmentName?: string
  fabric?: string
  tryonModel?: string
  tryonResolution?: string
  tryonAspectRatio?: string
  language?: string
  maskPrompt?: string
  /** 局部重绘框选区域（0–1 比例，左上角 + 宽高） */
  maskBox?: { x: number; y: number; w: number; h: number }
  resultText?: string
  resultImage?: string
  // ---- 图片动作产物（编辑 / 多视图 / 图层写回的结果图节点；有值即可删除，不同于模板承接的结果图） ----
  actionOrigin?: 'edit' | 'multiview' | 'layer'
  // ---- 模板分组框 ----
  color?: string
  // ---- 运行态（服务端回填 / 本地轮询写回，保存时被剥离） ----
  status?: 'idle' | 'queued' | 'running' | 'done' | 'error'
  progress?: number
  /** 最近一次 run 的前端幂等键 */
  runId?: string
  /** 最近一次 run 的服务端 run 号（轮询 / 取消用它） */
  requestId?: string
  errorMessage?: string
  /** 失败码（契约 3.4.2），随 errorMessage 一起写回 */
  errorCode?: string
  /** 服务端判定可重试时为 true */
  retryable?: boolean
  requestedCount?: number
  /** 候选成品 URL（图片 / 视频封面 / 工具产出；反推 i2p 为空） */
  candidates?: string[]
  /** 当前选中的候选下标（服务端以 select-candidate 记录为准） */
  selectedCandidate?: number
}

export interface CanvasEditorNode {
  id: string
  type: 'text' | 'image' | 'video' | 'model' | 'tool' | 'module'
  position: { x: number; y: number }
  data: CanvasNodeData
  draggable?: boolean
  selectable?: boolean
  zIndex?: number
}

export interface CanvasEditorEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: 'canvas-bezier'
  data?: { color?: string; order?: number }
}

export interface CanvasEditorSnapshot {
  nodes: CanvasEditorNode[]
  edges: CanvasEditorEdge[]
}

/** 节点 data 的历史别名（扁平接口，无联合） */
export type CanvasEditorNodeData = CanvasNodeData

/** 候选引用的上游输出口：候选单独连线是 sourceHandle=candidate-N（0 起编号 +1） */
export function candidateIndexOf(sourceHandle?: string | null): number {
  const match = /^candidate-(\d+)$/.exec(sourceHandle ?? '')
  return match && match[1] ? Number(match[1]) - 1 : -1
}
