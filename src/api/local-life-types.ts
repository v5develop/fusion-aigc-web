/**
 * 本地生活（Go 网关 /api/v1/local-life）接口类型。
 *
 * <p>字段一律下划线 —— 后端约定「请求与响应字段不会改成小驼峰」，前端不要做转换层，
 * 原样收发，避免两边字段名分叉。时间均为 unix 毫秒。
 */

/** 统一下拉选项（code/label/value 三元组；value 为展示值本身） */
export interface ILLOption {
  code: string
  label: string
  value: string
}

/** 二元选项（code/label， creations / video-creations 系列在用） */
export interface ILLChoice {
  code: string
  label: string
}

// ---------------- 使用约定 ----------------

export interface ILAgreement {
  code: string
  version: number
  accepted: boolean
}

// ---------------- 店铺档案 ----------------

export interface ILShopProfile {
  id: number
  name: string
  openDate: string
  address: string
  products: string
  sellingPoints: string
  selfTitle: string
  targetAudience: string
  createTime: number
  updateTime: number
}

export interface ILShopProfileForm {
  name: string
  openDate?: string
  address?: string
  products?: string
  sellingPoints?: string
  selfTitle?: string
  targetAudience?: string
}

export interface ILShopProfileList {
  list: ILShopProfile[]
  total: number
}

// ---------------- AI文案 ----------------

export interface ILCopywritingOptions {
  contentTypes: ILLOption[]
  styles: ILLOption[]
  industries: ILLOption[]
  wordCounts: ILLOption[]
  model: { name: string; code: string }
  maxTopicLen: number
  maxReferenceLen: number
}

export interface ILAiWriteReq {
  /** topic 主题 / selling_point 卖点优化 / note_topic 笔记主题 / poster_info 海报信息 / long_image 长图 / voiceover 口播 / explore_shop 探店 / short_drama 短剧 */
  scene: string
  contentType?: string
  industry?: string
  /** 用户已输入内容（AI帮写以此为底稿润色），最多 500 字 */
  context?: string
  maxLen?: number
  /** note_topic 场景：探店/种草/情感/知识 */
  noteType?: string
}

export interface ILCopywriting {
  id: number
  source: string
  contentType: string
  contentTypeLabel: string
  style: string
  industry: string
  title: string
  body: string
  wordCount: number
  topic: string
  targetWords: number
  /** 0 生成中 / 1 已完成 / 2 失败 */
  status: number
  failReason: string
  createTime: number
}

export interface ILCopywritingGenerateReq {
  /** AI_WRITE 帮写 / IMITATE 爆款仿写 */
  source: 'AI_WRITE' | 'IMITATE'
  contentType?: string
  style?: string
  industry?: string
  topic?: string
  referenceText?: string
  targetWords?: number
  shopProfileId?: number
}

export interface ILCopywritingListReq {
  keyword?: string
  contentType?: string
  /** 0 生成中 / 1 已完成 / 2 失败；-1 全部 */
  status?: number
  page?: number
  pageSize?: number
}

export interface ILCopywritingList {
  list: ILCopywriting[]
  total: number
}

/** 文案的成品衍生记录（只返回已完成的） */
export interface ILDerivative {
  /** 业务记录 id：笔记 / 生成记录 / 视频 / 数字人 id */
  id: number
  kind: string
  size: string
  coverUrl: string
  resultUrl: string
  isVideo: boolean
  createTime: number
}

export interface ILDerivativesList {
  list: ILDerivative[]
  total: number
}

// ---------------- AI数字人 ----------------

export interface ILPublicDigitalHuman {
  id: number
  name: string
  roleLabel: string
  imageUrl: string
  avatarUrl: string
}

export interface ILDhOptions {
  genders: ILLOption[]
  ages: ILLOption[]
  skinTones: ILLOption[]
  roles: ILLOption[]
  /** 出片模型（seedance2.5 / lite），第一项为默认 */
  models: ILLOption[]
  maxDescriptionLen: number
  maxScriptLen: number
}

export interface ILCreatePortraitReq {
  gender: 'female' | 'male'
  age: string
  skinTone: string
  role?: string
  description?: string
}

export interface ILPortrait {
  id: number
  gender: string
  age: string
  skinTone: string
  role: string
  description: string
  /** 0 生成中 / 1 已完成 / 2 失败（与文案同义） */
  status: number
  imageUrls: string[]
  failReason: string
  createTime: number
}

export interface ILVoice {
  id: number
  name: string
  gender: string
  style: string
  categories: string[]
  previewUrl: string
}

/** 形象来源：上传照片 / 公共数字人 / AI定制形象 */
export type ILPortraitSource = 'UPLOAD' | 'PUBLIC' | 'AI'

export interface ILCreateDigitalHumanReq {
  name?: string
  copywritingId?: number
  portrait_source: ILPortraitSource
  imageUrl?: string
  publicId?: number
  portraitId?: number
  imageIndex?: number
  voiceId: number
  script: string
  model?: string
}

export interface ILDigitalHuman {
  id: number
  name: string
  portrait_source: string
  imageUrl: string
  voiceId: number
  voiceName: string
  script: string
  videoUrl: string
  coverUrl: string
  duration: number
  model: string
  /** 0 配音中 / 1 视频生成中 / 2 已完成 / 3 失败 */
  status: number
  failReason: string
  createTime: number
}

export interface ILDigitalHumanList {
  list: ILDigitalHuman[]
  total: number
}

// ---------------- AI图文笔记 ----------------

export interface ILNoteType {
  code: string
  label: string
  materialLabel: string
  materialHint: string
}

export interface ILNoteOptions {
  types: ILNoteType[]
  maxMaterials: number
  defaultImages: number
  maxEditImages: number
  maxTopicLen: number
}

export interface ILPlanNoteReq {
  copywritingId?: number
  /** explore 探店 / seeding 种草 / emotion 情感 / knowledge 知识 */
  noteType: string
  shopProfileId?: number
  topic: string
  materialUrls?: string[]
  digitalHumanId?: number
  imageCount?: number
}

export interface ILNote {
  id: number
  noteType: string
  noteTypeLabel: string
  topic: string
  materialUrls: string[]
  digitalHumanId: number
  shopProfileId: number
  title: string
  content: string
  tags: string[]
  imageCount: number
  imageUrls: string[]
  /** 0 构思中 / 1 待确认 / 2 构思失败 / 3 生成中 / 4 已完成 / 5 生成失败 */
  status: number
  failReason: string
  createTime: number
}

export interface ILNoteList {
  list: ILNote[]
  total: number
}

// ---------------- 海报 / 长图 / 动作迁移 / 数字人口播 ----------------

export type ILCreationKind = 'poster' | 'longImage' | 'actionTransfer' | 'voiceover'

export interface ILCreationOptions {
  posterTypes: ILLChoice[]
  posterStyles: ILLChoice[]
  sizes: ILLChoice[]
  defaultSize: string
  maxImages: number
  maxMaterials: number
  /** 0 = 不限（数字人口播） */
  maxContentLen: number
  templateRequired: boolean
  models: ILLChoice[]
  defaultModel: string
  /** 数字人口播的视频时长（秒） */
  durations: number[]
  defaultDuration: number
}

export interface ILCreationTemplate {
  id: number
  title: string
  url: string
}

export interface ILActionVideo {
  id: number
  name: string
  url: string
  coverUrl: string
  mine: boolean
}

export interface ILCreateCreationReq {
  copywritingId?: number
  kind: ILCreationKind
  content?: string
  materialUrls?: string[]
  templateId?: number
  posterType?: string
  posterStyle?: string
  size?: string
  imageCount?: number
  portrait_source?: ILPortraitSource
  imageUrl?: string
  publicId?: number
  portraitId?: number
  imageIndex?: number
  actionVideoId?: number
  myActionVideoId?: number
  model?: string
  backgroundSource?: 'AI' | 'PRESET' | 'UPLOAD'
  backgroundId?: number
  backgroundUrl?: string
  duration?: number
}

export interface ILCreation {
  id: number
  kind: ILCreationKind
  /** image / video，由 kind 决定 */
  media: string
  content: string
  materialUrls: string[]
  templateId: number
  templateUrl: string
  posterType: string
  posterStyle: string
  size: string
  imageCount: number
  /** 图片成品；视频成品为空 */
  imageUrls: string[]
  /** 视频成品（口播、动作迁移）；图片成品为空 */
  videoUrl: string
  inputImageUrl: string
  inputVideoUrl: string
  model: string
  inputBgUrl: string
  duration: number
  /** 0 生成中 / 1 已完成（含部分成功，image_urls 只有成功的） / 2 全部失败 */
  status: number
  failReason: string
  createTime: number
}

export interface ILCreationList {
  list: ILCreation[]
  total: number
}

// ---------------- 探店视频 / 带货短剧 / 爆款视频复刻 ----------------

export type ILVideoKind = 'exploreShop' | 'shortDrama' | 'videoRemake'

export interface ILVideoOptions {
  models: ILLChoice[]
  defaultModel: string
  durations: number[]
  defaultDuration: number
  sizes: ILLChoice[]
  defaultSize: string
  maxUserTextLen: number
  maxSellingPointsLen: number
  /** 短剧的商品图必填 */
  propRequired: boolean
  maxVideoBytes: number
  maxVideoSeconds: number
  videoFormats: string[]
  linkEnabled: boolean
}

export interface ILCreateVideoReq {
  copywritingId?: number
  kind: ILVideoKind
  /** 探店：视频文案；短剧：短剧主题 */
  userText?: string
  sellingPoints?: string
  shopProfileId?: number
  portrait_source?: ILPortraitSource
  imageUrl?: string
  publicId?: number
  portraitId?: number
  imageIndex?: number
  env1Url?: string
  env2Url?: string
  propUrl?: string
  duration?: number
  size?: string
  model?: string
  /** 复刻：upload 上传本地视频 / link 粘贴链接 */
  source?: 'upload' | 'link'
  videoUrl?: string
  link?: string
}

export interface ILVideoCreation {
  id: number
  kind: ILVideoKind
  userText: string
  sellingPoints: string
  shopProfileId: number
  charUrl: string
  env1Url: string
  env2Url: string
  propUrl: string
  duration: number
  size: string
  model: string
  /** 剧本 JSON 原文（状态 1 起有值）；复刻为剧情分析 Markdown 纯文本 */
  script: string
  videoUrl: string
  /** 0 构思中 / 1 待确认 / 2 生成中 / 3 已完成 / 4 失败 */
  status: number
  source: string
  sourceUrl: string
  sourceVideoUrl: string
  title: string
  coverUrl: string
  failReason: string
  createTime: number
}

export interface ILVideoCreationList {
  list: ILVideoCreation[]
  total: number
}

export interface ILGenerateVideoReq {
  /** 只对复刻生效：改过的剧情文本 */
  prompt?: string
  model?: string
  size?: string
}

/** 探店/短剧的剧本 JSON（script 字段 parse 后） */
export interface ILScriptScene {
  scene_name?: string
  start_sec?: number
  end_sec?: number
  camera?: string
  dialogue?: string
  image_ref?: string
}
