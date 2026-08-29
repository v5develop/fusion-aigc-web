export interface ApiResponse<T = any> {
  code: number
  msg: string
  data: T
}

export interface IGetSts {
  // 子目录路径（可选值：uploads=通用上传(默认), images=图片, videos=视频, audios=音频）
  subDir?: 'uploads' | 'images' | 'videos' | 'audios'
  fileName: string // 文件名称
  contentType: string // 文件MIME
  fileSize: number // 文件大小
  visibility?: 'public' | 'visible' // 可见性（可选值：public=公开桶（默认） private=私有桶）
}

export interface IAssetAll {
  type?: string // 二级细类型（电商 entryCode），或 customizedModel/realPersonModel
  category?: 'image' | 'video' | 'ecommerce' // 一级大类
  /** 聚合分类编码，取自 /asset/categories。选到哪一级就传哪一级的 categoryCode */
  assetCategory?: string
  /** 画面比例，取自 /asset/aspect-ratios。别硬编码这个列表 */
  aspectRatio?: string
  /** 快捷时间。按自然周期切：week = 本周一零点起，不是过去 7 天 */
  timeRange?: 'today' | 'week' | 'month' | 'all'
  startTime?: string
  endTime?: string
  sortBy?: 'latest' | 'earliest'
  keyword?: string
  page?: number
  pageSize?: number
}

/** 素材库聚合分类（两级）。二级节点的 children 恒为空数组 */
export interface IAssetCategory {
  /** 「其他」是后端合成的虚拟分类，id 恒为 null —— 渲染 key 请用 categoryCode */
  id: number | null
  categoryCode: string
  categoryName: string
  sortOrder?: number
  /** 仅供调试/埋点。筛选传 categoryCode，别拿它自己拼 */
  entryCodes?: string[]
  children?: IAssetCategory[]
}

/** 灵感广场分类树（两级），节点 id 即推荐流的 categoryL1Id / categoryL2Id */
export interface IDisplayCategory {
  id: number
  categoryCode: string
  categoryName: string
  level: number
  sortOrder?: number
  /** APP / PC / BOTH */
  platform?: string
  children?: IDisplayCategory[]
}

/** 推荐流入参。platform 必传，不传后端直接 400 */
export interface IPublicDisplay {
  platform: 'APP' | 'PC'
  categoryL1Id?: number
  categoryL2Id?: number
  page?: number
  pageSize?: number
}

/** 推荐流条目 */
export interface IFeedItem {
  id: number
  /** CREATION_TASK 用户创作 | DISPLAY_ASSET 运营灵感素材 */
  sourceType: string
  /** 做同款时原样回传这个 */
  dataId: number
  title: string | null
  mediaType: 'image' | 'video'
  /** 列表缩略图；视频给的是封面帧，可直接当 img src */
  coverUrl: string
  /** 已是水印图，多张按顺序做幻灯片。不要再叠一次水印 */
  urls: string[]
  /** 0 = 未知，前端必须兜底 */
  width: number
  height: number
  categoryL1Id: number | null
  categoryL2Id: number | null
  /** false 时不要展示「做同款」入口，点了会报错 */
  sameStyle: boolean
  /**
   * 出自哪个创作入口。可能为 null（运营手灌的素材没配同款配方、也没关联来源任务）。
   * route 为空时用它跳通用创作页：/picture?entryCode=xxx
   */
  entryCode: string | null
  /**
   * 提交口与创作页路由。**entryCode 为 null 时整个对象为 null**。
   * 结构与 /public/same-style 的 submit.route 一致，可共用一套解析。
   */
  route: IFeedRoute | null
}

export interface IFeedRoute {
  /**
   * 恒为统一提交入口 /api/v1/creation/submit。
   * 推荐流只知道 entryCode、不解析配方；要按原请求形态匹配的提交路径
   * （模板/电商/本地生活各有各的口）得调 same-style。
   */
  submitPath: string
  /**
   * 该端创作页路由。**可能为 null** —— 该入口没配路由。
   * 为空时回退通用创作页并带上 entryCode，**不要把入口藏掉**：
   * 藏掉的话运营配漏一条路由，表现是入口凭空消失，很难被发现。
   */
  targetRoute: string | null
}

export interface IAssetBatchDelete {
  ids: number[] // 资产 id 列表
}

export interface IFaceRecognition {
  modelCode: string
  imageUrls: string[]
}

export interface IPublicTemplate {
  bizType?: 'ecommerce' // 业务域
  moduleCode: string // 跟生成接口的type传一样的值
  // 页面区块，model：默特库， tryOnTemplate：试衣模板库， background：背景库， shoeTemplate：鞋库， gestures：手持姿势库
  slotCode?: 'model' | 'tryOnTemplate' | 'background' | 'shoeTemplate' | 'gestures'
  type?: 'image' | 'video' // 素材类型：image/video
  filters?: any // 下拉项code
  page?: number
  pageSize?: number // 每页数量，上限 100
}

export interface ICreationSubmit {
  type: 'IMAGE' | 'VIDEO' // IMAGE：图片  VIDEO：视频
  entryCode: 'imageToImage' | 'textToImage'
  modelCode: string
  params?: {
    prompt?: string
    width?: number
    height?: number
    num?: number
    ratio?: string
    /** 宽高比，如 "1:1" / "9:16"。视频场景与 aspectRatio 并存 */
    size?: string
    resolution?: string
    duration?: number
    [key: string]: any
  }
  images?: string[]
  video?: string
}

export interface IOptimizePrompt {
  // ai_writing:商品套图、a+商品详情、爆款视频、复刻视频  ai_writing_background:人像换背景  aiMergeClothes:搭配融图
  prompt: 'ai_writing' | 'ai_writing_background' | 'aiMergeClothes'
  userInput: string
  imageUrls?: string[]
}

export interface ICreationHistory {
  page: number
  pageSize: number
  type: 'image' | 'video'
}

export interface IQuotePreview {
  entryCode: string
  modelCode?: string
  params?: {
    [key: string]: any
  }
  imageUrls?: string[]
  video?: string
}

export interface IPromptList {
  category?: string
  page?: number
  pageSize?: number
}

/** 提示词模板卡片（首屏轻量列表 GET /api/v1/creation/prompts 返回项） */
export interface IPromptCard {
  id: string
  name: string
  category?: string
  /** 对应的电商子路由路径，如 /e-commerce/clothing-try */
  code?: string
  description?: string
  icon?: string
  coverImage?: string
  tags?: any[]
}

/** 提示词模板列表 data */
export interface IPromptListData {
  list: IPromptCard[]
  total: number
}

/** 提示词详情 slot 的下拉选项（与编辑器层 SlotOption 结构一致，API 层独立定义避免依赖 views） */
export interface IPromptSlotOption {
  label: string
  value: string
  icon?: string
}

/** 提示词详情 slots 定义项（GET /api/v1/creation/prompts/{id}） */
export interface IPromptSlotDef {
  key: string
  label: string
  slotType: 'image' | 'select'
  maxCount?: number
  options?: IPromptSlotOption[]
  required?: boolean
  recommendedSize?: string
}

/** 提示词模板详情 */
export interface IPromptDetail extends IPromptCard {
  /** 带 {{key}} 占位符的模板串 */
  content?: string | null
  slots?: IPromptSlotDef[] | null
}

/** 模型选项里的一个可选值（比例/分辨率/时长），selected 为服务端给的默认项 */
export interface IAigcOptionChoice {
  value: string | number
  selected: boolean
}

/** 单个可用模型（GET /api/v1/aigc/model-options） */
export interface IAigcModelOption {
  code: string
  name: string
  selected: boolean
  /** 该模型配了计费档位的创作场景，前端据此过滤各场景的模型下拉 */
  entry_codes?: string[]
  /** 图片一次生成张数；视频为 undefined */
  num?: number
  aspect_ratios?: IAigcOptionChoice[]
  /** 仅视频 */
  resolutions?: IAigcOptionChoice[]
  /** 仅视频 */
  durations?: IAigcOptionChoice[]
}

/** 可用模型选项响应 */
export interface IAigcModelOptions {
  media_type: string
  models: IAigcModelOption[]
}
