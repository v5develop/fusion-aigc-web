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
  open_date: string
  address: string
  products: string
  selling_points: string
  self_title: string
  target_audience: string
  create_time: number
  update_time: number
}

export interface ILShopProfileForm {
  name: string
  open_date?: string
  address?: string
  products?: string
  selling_points?: string
  self_title?: string
  target_audience?: string
}

export interface ILShopProfileList {
  list: ILShopProfile[]
  total: number
}

// ---------------- AI文案 ----------------

export interface ILCopywritingOptions {
  content_types: ILLOption[]
  styles: ILLOption[]
  industries: ILLOption[]
  word_counts: ILLOption[]
  model: { name: string; code: string }
  max_topic_len: number
  max_reference_len: number
}

export interface ILAiWriteReq {
  /** topic 主题 / selling_point 卖点优化 / note_topic 笔记主题 / poster_info 海报信息 / long_image 长图 / voiceover 口播 / explore_shop 探店 / short_drama 短剧 */
  scene: string
  content_type?: string
  industry?: string
  /** 用户已输入内容（AI帮写以此为底稿润色），最多 500 字 */
  context?: string
  max_len?: number
  /** note_topic 场景：探店/种草/情感/知识 */
  note_type?: string
}

export interface ILCopywriting {
  id: number
  source: string
  content_type: string
  content_type_label: string
  style: string
  industry: string
  title: string
  body: string
  word_count: number
  topic: string
  target_words: number
  /** 0 生成中 / 1 已完成 / 2 失败 */
  status: number
  fail_reason: string
  create_time: number
}

export interface ILCopywritingGenerateReq {
  /** AI_WRITE 帮写 / IMITATE 爆款仿写 */
  source: 'AI_WRITE' | 'IMITATE'
  content_type?: string
  style?: string
  industry?: string
  topic?: string
  reference_text?: string
  target_words?: number
  shop_profile_id?: number
}

export interface ILCopywritingListReq {
  keyword?: string
  content_type?: string
  /** 0 生成中 / 1 已完成 / 2 失败；-1 全部 */
  status?: number
  page?: number
  page_size?: number
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
  cover_url: string
  result_url: string
  is_video: boolean
  create_time: number
}

export interface ILDerivativesList {
  list: ILDerivative[]
  total: number
}

// ---------------- AI数字人 ----------------

export interface ILPublicDigitalHuman {
  id: number
  name: string
  role_label: string
  image_url: string
  avatar_url: string
}

export interface ILDhOptions {
  genders: ILLOption[]
  ages: ILLOption[]
  skin_tones: ILLOption[]
  roles: ILLOption[]
  /** 出片模型（seedance2.5 / lite），第一项为默认 */
  models: ILLOption[]
  max_description_len: number
  max_script_len: number
}

export interface ILCreatePortraitReq {
  gender: 'female' | 'male'
  age: string
  skin_tone: string
  role?: string
  description?: string
}

export interface ILPortrait {
  id: number
  gender: string
  age: string
  skin_tone: string
  role: string
  description: string
  /** 0 生成中 / 1 已完成 / 2 失败（与文案同义） */
  status: number
  image_urls: string[]
  fail_reason: string
  create_time: number
}

export interface ILVoice {
  id: number
  name: string
  gender: string
  style: string
  categories: string[]
  preview_url: string
}

/** 形象来源：上传照片 / 公共数字人 / AI定制形象 */
export type ILPortraitSource = 'UPLOAD' | 'PUBLIC' | 'AI'

export interface ILCreateDigitalHumanReq {
  name?: string
  copywriting_id?: number
  portrait_source: ILPortraitSource
  image_url?: string
  public_id?: number
  portrait_id?: number
  image_index?: number
  voice_id: number
  script: string
  model?: string
}

export interface ILDigitalHuman {
  id: number
  name: string
  portrait_source: string
  image_url: string
  voice_id: number
  voice_name: string
  script: string
  video_url: string
  cover_url: string
  duration: number
  model: string
  /** 0 配音中 / 1 视频生成中 / 2 已完成 / 3 失败 */
  status: number
  fail_reason: string
  create_time: number
}

export interface ILDigitalHumanList {
  list: ILDigitalHuman[]
  total: number
}

// ---------------- AI图文笔记 ----------------

export interface ILNoteType {
  code: string
  label: string
  material_label: string
  material_hint: string
}

export interface ILNoteOptions {
  types: ILNoteType[]
  max_materials: number
  default_images: number
  max_edit_images: number
  max_topic_len: number
}

export interface ILPlanNoteReq {
  copywriting_id?: number
  /** explore 探店 / seeding 种草 / emotion 情感 / knowledge 知识 */
  note_type: string
  shop_profile_id?: number
  topic: string
  material_urls?: string[]
  digital_human_id?: number
  image_count?: number
}

export interface ILNote {
  id: number
  note_type: string
  note_type_label: string
  topic: string
  material_urls: string[]
  digital_human_id: number
  shop_profile_id: number
  title: string
  content: string
  tags: string[]
  image_count: number
  image_urls: string[]
  /** 0 构思中 / 1 待确认 / 2 构思失败 / 3 生成中 / 4 已完成 / 5 生成失败 */
  status: number
  fail_reason: string
  create_time: number
}

export interface ILNoteList {
  list: ILNote[]
  total: number
}

// ---------------- 海报 / 长图 / 动作迁移 / 数字人口播 ----------------

export type ILCreationKind = 'poster' | 'longImage' | 'actionTransfer' | 'voiceover'

export interface ILCreationOptions {
  poster_types: ILLChoice[]
  poster_styles: ILLChoice[]
  sizes: ILLChoice[]
  default_size: string
  max_images: number
  max_materials: number
  /** 0 = 不限（数字人口播） */
  max_content_len: number
  template_required: boolean
  models: ILLChoice[]
  default_model: string
  /** 数字人口播的视频时长（秒） */
  durations: number[]
  default_duration: number
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
  cover_url: string
  mine: boolean
}

export interface ILCreateCreationReq {
  copywriting_id?: number
  kind: ILCreationKind
  content?: string
  material_urls?: string[]
  template_id?: number
  poster_type?: string
  poster_style?: string
  size?: string
  image_count?: number
  portrait_source?: ILPortraitSource
  image_url?: string
  public_id?: number
  portrait_id?: number
  image_index?: number
  action_video_id?: number
  my_action_video_id?: number
  model?: string
  background_source?: 'AI' | 'PRESET' | 'UPLOAD'
  background_id?: number
  background_url?: string
  duration?: number
}

export interface ILCreation {
  id: number
  kind: ILCreationKind
  /** image / video，由 kind 决定 */
  media: string
  content: string
  material_urls: string[]
  template_id: number
  template_url: string
  poster_type: string
  poster_style: string
  size: string
  image_count: number
  /** 图片成品；视频成品为空 */
  image_urls: string[]
  /** 视频成品（口播、动作迁移）；图片成品为空 */
  video_url: string
  input_image_url: string
  input_video_url: string
  model: string
  input_bg_url: string
  duration: number
  /** 0 生成中 / 1 已完成（含部分成功，image_urls 只有成功的） / 2 全部失败 */
  status: number
  fail_reason: string
  create_time: number
}

export interface ILCreationList {
  list: ILCreation[]
  total: number
}

// ---------------- 探店视频 / 带货短剧 / 爆款视频复刻 ----------------

export type ILVideoKind = 'exploreShop' | 'shortDrama' | 'videoRemake'

export interface ILVideoOptions {
  models: ILLChoice[]
  default_model: string
  durations: number[]
  default_duration: number
  sizes: ILLChoice[]
  default_size: string
  max_user_text_len: number
  max_selling_points_len: number
  /** 短剧的商品图必填 */
  prop_required: boolean
  max_video_bytes: number
  max_video_seconds: number
  video_formats: string[]
  link_enabled: boolean
}

export interface ILCreateVideoReq {
  copywriting_id?: number
  kind: ILVideoKind
  /** 探店：视频文案；短剧：短剧主题 */
  user_text?: string
  selling_points?: string
  shop_profile_id?: number
  portrait_source?: ILPortraitSource
  image_url?: string
  public_id?: number
  portrait_id?: number
  image_index?: number
  env1_url?: string
  env2_url?: string
  prop_url?: string
  duration?: number
  size?: string
  model?: string
  /** 复刻：upload 上传本地视频 / link 粘贴链接 */
  source?: 'upload' | 'link'
  video_url?: string
  link?: string
}

export interface ILVideoCreation {
  id: number
  kind: ILVideoKind
  user_text: string
  selling_points: string
  shop_profile_id: number
  char_url: string
  env1_url: string
  env2_url: string
  prop_url: string
  duration: number
  size: string
  model: string
  /** 剧本 JSON 原文（状态 1 起有值）；复刻为剧情分析 Markdown 纯文本 */
  script: string
  video_url: string
  /** 0 构思中 / 1 待确认 / 2 生成中 / 3 已完成 / 4 失败 */
  status: number
  source: string
  source_url: string
  source_video_url: string
  title: string
  cover_url: string
  fail_reason: string
  create_time: number
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
