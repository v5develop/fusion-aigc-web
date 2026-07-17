
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
  type: string // customizedmodel:本地local上传, realpersonmodel:豆包验证库
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
