/**
 * 商拍工作室（Go 网关 /api/v1/studio）类型定义。
 *
 * <p>契约：docs/api/api-studio.md（fusion_aigc_go）。
 * 请求体 / 响应字段一律 snake_case 原样收发，不做 camelCase 改写。
 * 时间字段均为 unix 毫秒；task_id 是字符串，batch_id / id 是数字。
 */

/** 三个功能共用 kind：商拍换装 / 姿态复刻 / 图片生成 */
export type StudioKind = 'tryon' | 'pose' | 'imagegen'

// ---------------- 提交 ----------------

/** 服装图单项：role 为单品中文名（上衣 / 下装 / 连衣裙 / 外套 / 鞋子 / 配饰 / 文胸 / 内裤）或「整套」 */
export interface StudioGarmentImage {
  url: string
  role?: string
  /** front / back / side / detail / flat / unknown；空按 unknown */
  angle?: string
}

/** 商拍换装整批提交：模特数 × count_per_model 拆任务（最多 81） */
export interface StudioTryonSubmitReq {
  workspace_id?: number
  /** 模特图 1–9 张，每张一位模特 */
  model_image_urls: string[]
  /** 服装图 1–9 张，同一 role ≤6 张 */
  garment_images: StudioGarmentImage[]
  /** 单品 1–3 件：top/bottom/dress/outer/shoes/accessory/bra/panties */
  items: string[]
  /** one / two；空按 one */
  set_mode?: string
  /** { 单品: 长度 }，键必须在 items 里 */
  lengths?: Record<string, string>
  /** { 单品: 袖长 }，同上 */
  sleeves?: Record<string, string>
  /** 面料，按件写：「上衣：真丝；鞋子：皮革」 */
  fabric?: string
  /** 补充说明 ≤3000 字 */
  prompt?: string
  /** 通用 / GPT / Banana / Seedream；空 = 通用 */
  model?: string
  /** 1k / 2k / 4k；空 = 1k */
  resolution?: string
  /** 宽:高；空 = 按模特图比例自动取最近档 */
  aspect_ratio?: string
  /** 每位模特生成几张，1–9 */
  count_per_model: number
  /** 默认校色：出图后按校色默认参数自动校一遍；不传 = 不校 */
  color_fix?: boolean
  /** 精细读图：反推读图走精细模式（更慢、设计细节更多），不另收费；不传 = 标准读图 */
  fine_read?: boolean
  /** 「AI 找细节」确认后的细节框（detail_crops_manual=true 时生效；空数组 = 不用细节图） */
  detail_crops?: StudioDetailCrop[]
  /** true = 用户确认过细节框，服务端只用 detail_crops、不再自动找细节 */
  detail_crops_manual?: boolean
}

/** 细节框：garment_index = garment_images 下标；box = 归一化 [x, y, w, h]（0–1） */
export interface StudioDetailCrop {
  garment_index: number
  /** 部位名，如「上衣·领口」 */
  label: string
  box: number[]
  confidence?: number
}

/** 「AI 找细节」请求：与商拍提交同口径 */
export interface StudioDetailsReq {
  items: string[]
  set_mode?: string
  garment_images: StudioGarmentImage[]
  fabric?: string
  prompt?: string
}

export interface StudioDetailPlan {
  garment_index: number
  angle: string
  crops: StudioDetailCrop[]
}

export interface StudioDetailsResp {
  /** 每张服装图一项（顺序同 garment_images） */
  plans: StudioDetailPlan[]
  total: number
  /** 给用户看的提示；没有为 [] */
  warnings: string[]
}

/** 姿态复刻整批提交：人物图 1 张 + 姿势图 1–9 张，每张姿势一个任务 */
export interface StudioPoseSubmitReq {
  workspace_id?: number
  /** 人物图（生图时的图 1） */
  source_image_url: string
  /** 姿势图 1–9 张，顺序即姿势序号（从 0 起） */
  pose_image_urls: string[]
  /** 全局补充说明 ≤3000 字 */
  global_prompt?: string
  /** 单张补充说明，键为姿势下标字符串（从 0 起） */
  pose_prompts?: Record<string, string>
  model?: string
  resolution?: string
  /** 宽:高；空 = 按人物图比例自动取最近档 */
  aspect_ratio?: string
  /** 原图人数（2–4，取自 /pose/preview 的 source.person_count）；传 mappings 时必填。单人原图不传 */
  source_person_count?: number
  /** 多人配对（用户在预览里确认 / 反转后的结果）；不传的姿势图按默认配对（左→左、右→右） */
  mappings?: StudioPoseMapping[]
  /** 默认校色：出图后按校色默认参数自动校一遍；不传 = 不校 */
  color_fix?: boolean
}

/** 一张姿势图的多人配对 */
export interface StudioPoseMapping {
  /** 姿势序号（从 0 起） */
  pose_index: number
  /** mapping[i] = 原图第 i 位人物（左→右）取姿势图第几位人物（左→右，从 0 起）；-1 = 保持原姿势 */
  mapping: number[]
  /** 预览返回的该姿势图人数（1–4） */
  pose_person_count: number
}

/** 图片生成：count 张拆 count 个任务 */
export interface StudioImageGenSubmitReq {
  workspace_id?: number
  /** 提示词，必填 ≤3000 字 */
  prompt: string
  /** 参考图 0–9 张 */
  image_urls?: string[]
  model?: string
  resolution?: string
  /** 宽:高；空 = 1:1 */
  aspect_ratio?: string
  /** 生成张数 1–9 */
  count: number
  /** true = 先润色一次提示词再生成 */
  rewrite_prompt?: boolean
}

/** 三个提交接口通用响应 */
export interface StudioSubmitResp {
  batch_id: number
  task_total: number
  /** 预估消耗点数（冻结额，非最终扣费） */
  estimated_points: number
  task_ids: string[]
  /** true = 同一 Idempotency-Key 重复提交，返回的是原批次 */
  replayed: boolean
  /** 参数修正提示（如 Seedream 4K → 2K），可直接展示 */
  warnings: string[]
}

// ---------------- 姿态复刻 · 多人配对预览（POST /pose/preview，免费只读，慢） ----------------

export interface StudioPosePreviewReq {
  source_image_url: string
  pose_image_urls: string[]
}

export interface StudioPosePerson {
  /** P1…P4，按画面左→右 */
  label: string
  /** 画面左侧 / 画面右侧 … */
  position: string
  primary: boolean
  /** 只有原图人物有 */
  gender_age: string
  /** 原图为服装摘要，姿势图为动作剪影 */
  summary: string
}

export interface StudioPosePeople {
  person_count: number
  people: StudioPosePerson[]
  group: string
  interaction: string
  /** true = 超过 4 人，只分析了前 4 位 */
  people_truncated: boolean
}

export interface StudioPosePreviewItem {
  pose_index: number
  /** 读图失败时为 null，原因见 error */
  pose: StudioPosePeople | null
  /** 默认配对，长度 = 原图人数 */
  default_mapping: number[]
  error: string
}

export interface StudioPosePreviewResp {
  source: StudioPosePeople
  /** 原图单人时为 [] */
  poses: StudioPosePreviewItem[]
  /** 原图 ≥2 人 */
  mapping_enabled: boolean
}

// ---------------- 提交前报价 ----------------

/** 报价请求：与对应提交体同构的子集（可直接传提交体），全部选填 */
export type StudioTryonQuoteReq = Partial<
  Pick<StudioTryonSubmitReq, 'model_image_urls' | 'count_per_model' | 'model' | 'resolution' | 'aspect_ratio'>
>
export type StudioPoseQuoteReq = Partial<
  Pick<StudioPoseSubmitReq, 'pose_image_urls' | 'model' | 'resolution' | 'aspect_ratio'>
>
export type StudioImageGenQuoteReq = Partial<
  Pick<StudioImageGenSubmitReq, 'count' | 'model' | 'resolution' | 'aspect_ratio'>
>

/** 报价响应（POST /{tryon,pose,image-generate}/quote） */
export interface StudioQuoteResp {
  /** 能否报出价；false 时点数为 0，原因见 reason */
  available: boolean
  /** 本次提交预计冻结点数 = unit_points × task_total（与提交回的 estimated_points 同口径） */
  points: number
  /** 每张点数 */
  unit_points: number
  /** PER_IMAGE */
  price_unit: string
  /** 计价张数；0 = 素材还没传够 */
  task_total: number
  /** 计价分辨率（已按模型档归一，如 Seedream 4k → 2k） */
  resolution: string
  /** on 真扣 / shadow 只算价不扣 / off 不计费 */
  billing_mode: string
  /** 提交是否真的冻结扣点（仅 billing_mode=on） */
  charged: boolean
  /** available=false 的原因 */
  reason: string
  warnings: string[]
}

// ---------------- 模型档能力 ----------------

/** 单档分辨率的单张点数（GET /models?with_price=true） */
export interface StudioModelResolutionPrice {
  /** 1k / 2k / 4k */
  resolution: string
  available: boolean
  /** billing_mode=off 时为 0 */
  unit_points: number
}

/** 一个模型档的可选项（后端：组规则 ∩ gateway 目录，与提交时的参数归一同源） */
export interface StudioModelCapability {
  /** 传值：通用 / GPT / GPT25 / Banana / Seedream */
  code: string
  /** 展示名（如 GPT Image 2.6） */
  label: string
  /** 2026-11-10 起服务端不再下发（内部模型组码不对用户暴露）；保留可选声明兼容老服务 */
  model_group?: string
  /** gateway 目录里该组已启用；目录拉不到时为 true */
  available: boolean
  /** 可选分辨率（小写） */
  resolutions: string[]
  /** 可选比例（W:H），如 Seedream 5.5 没有 4:5 / 5:4 */
  aspect_ratios: string[]
  /** 支持「自动」比例（tryon / pose） */
  auto_aspect: boolean
  /** 本 kind 的参考图上限 */
  max_ref_images: number
  /** 限制说明短句 */
  notes: string[]
  /** with_price=true 时有 */
  prices: StudioModelResolutionPrice[]
}

export interface StudioModelsResp {
  kind: StudioKind
  items: StudioModelCapability[]
  /** with_price 时有：on / shadow / off */
  billing_mode: string
}

// ---------------- 批次 / 任务 ----------------

/** 批次。status：0 排队 / 1 切图中 / 2 反推中 / 3 生图中 / 4 全部成功 / 5 全部失败 / 6 部分成功 / 7 已取消 / 8 提交中（终态 = 4–7，不要用 >=4 判断） */
export interface StudioBatch {
  id: number
  kind: StudioKind
  status: number
  /** 提交时的全量字段快照，JSON 文本（需 JSON.parse），用于「重新编辑」回填 */
  payload: string
  task_total: number
  /** 已成功数 */
  task_done: number
  /** 已失败数（含取消） */
  task_failed: number
  estimated_points: number
  /** 批次级失败原因；没有则空 */
  error_reason: string
  /** 批次封面；还没有成品时为空 */
  cover_url: string
  created_at: number
  updated_at: number
  /** 各任务 warnings 去重合并（读图降级 / 品类不符 / 参考图截断…）；老网关不下发 */
  warnings?: string[]
}

/** 任务（一张图）。status：0 排队 / 1 生成中 / 5 交付中（按生成中展示）/ 2 成功 / 3 失败 / 4 已取消 */
export interface StudioTask {
  id: number
  task_id: string
  batch_id: number
  kind: StudioKind
  /** 商拍：模特序号（从 0 起）；其它类型为 0 */
  model_index: number
  /** 商拍：同一模特的第几张；图片生成：第几张（从 0 起） */
  shot_index: number
  /** 姿态：姿势序号（从 0 起）；其它类型为 0 */
  pose_index: number
  status: number
  /** 0–100 估算值，只用来画进度条；失败 / 取消任务不要使用 */
  progress: number
  result_url: string
  result_width: number
  result_height: number
  error_reason: string
  prompt_summary: string
  created_at: number
  /** 0 = 未开始 */
  started_at: number
  /** 0 = 未结束 */
  finished_at: number
  /** 成品在素材库的资产 id（可直接 POST /asset-library/assets/{id}/versions）；没入库 / 已删除为 0。老网关不下发 */
  asset_id?: number
  /** 已保存的校色参数；没保存过为 null。老网关不下发 */
  color_fix_params?: StudioColorFixParams | null
  /**
   * 服装蒙版（白色 + 软 alpha 的 PNG，公开地址，校色只作用于蒙版内）：商拍换装 / 姿态复刻成品成功后服务端异步补，
   * 通常晚于 status=2 几秒；空 = 还没有 / 没识别到服装。老网关不下发
   */
  mask_url?: string
  /**
   * 商拍换装按所选单品分割时的逐件蒙版（mask_url 是它们的合并）；没有为空数组。
   * 新网关总下发这个字段（老网关没有）——前端据此判断服务端支持「服装细分部位」
   */
  mask_parts?: StudioMaskPart[]
  /** 给用户看的提示（中文、不含供应商原文）：「已改用文字信息生成」「参考图看起来是…，与所选「文胸」不一致」等；老网关不下发 */
  warnings?: string[]
  /** 实际送生图的完整提示词（含首行图序；姿态 / 商拍有，编排完成前为空）；老网关不下发 */
  prompt_text?: string
  /** 提示词经用户编辑后重新生成过 */
  prompt_edited?: boolean
}

/**
 * 校色五参数（服务端键名，整数）：hue [-30,30]、saturation [-60,70]、value 明度 [-40,40]、
 * brightness 亮度 [-80,80]、contrast [-50,50]。前端 utils/colorfix.ts 对应 hue / sat / light / bright / contrast。
 */
export interface StudioColorFixParams {
  hue: number
  saturation: number
  value: number
  brightness: number
  contrast: number
}

/** PATCH /tasks/{task_id}/color-fix 请求体；回该子任务 */
export interface StudioTaskColorFixReq {
  params: StudioColorFixParams
}

/** 批次详情 = 批次 + 它的全部任务（轮询 / 历史共用的结构） */
export interface StudioBatchDetail {
  batch: StudioBatch
  tasks: StudioTask[]
}

// ---------------- 历史 / 取消 ----------------

export interface StudioHistoryParams {
  /** 不传 = 全部 */
  kind?: StudioKind | ''
  /** 上一页返回的 next_cursor；空 = 第一页。游标不透明，原样传回 */
  cursor?: string
  /** 默认 20，上限 50 */
  limit?: number
}

export interface StudioHistoryResp {
  list: StudioBatchDetail[]
  /** 空 = 没有下一页 */
  next_cursor: string
}

export interface StudioCancelResp {
  batch: StudioBatch
  /** 这次取消的（还在排队的）任务数 */
  canceled_tasks: number
}

// ---------------- 「重新编辑」回填 ----------------

/** batch.payload JSON.parse 后的快照：字段可能缺省，一律按 Partial 处理 */
export type StudioTryonPayload = Partial<StudioTryonSubmitReq>
export type StudioPosePayload = Partial<StudioPoseSubmitReq>
export type StudioImageGenPayload = Partial<StudioImageGenSubmitReq>

/** 区域蒙版目标：服装 / 商品主体 / 人物 / 背景（主体之外） */
export type StudioMaskTarget = 'garment' | 'product' | 'person' | 'background'

/** 服装细分部位：上衣 / 外套 / 下装 / 裙装 / 鞋 / 包 / 帽 */
export type StudioMaskGarmentPart = 'tops' | 'coat' | 'pants' | 'skirt' | 'shoes' | 'bag' | 'hat'

/** 一个部位的蒙版 */
export interface StudioMaskPart {
  part: StudioMaskGarmentPart
  /** 该部位的白色 + 软 alpha PNG，与原图同尺寸 */
  mask_url: string
}

/** POST /api/v1/studio/masks 的请求体 */
export interface StudioMaskReq {
  /** 本服务存储签发 / 素材库域名的 http(s) 地址（如任务 result_url）；第三方地址 1003 */
  image_url: string
  target: StudioMaskTarget
  /** 仅 garment：只要这些部位（多选）；不传 / 空 = 全部服装。老网关不认（会忽略） */
  parts?: StudioMaskGarmentPart[]
}

/** POST /api/v1/studio/masks 的响应 */
export interface StudioMaskResp {
  /** 白色 + 软 alpha 的 PNG（区域内不透明），与原图同尺寸；canvas 读像素需 crossOrigin；带 parts 时 = 这些部位的合并蒙版 */
  mask_url: string
  target: StudioMaskTarget
  /** 命中服务端缓存（同一张图同一区域只识别一次） */
  cached: boolean
  /** 带 parts 时的逐件蒙版（固定顺序，图里没有的部位缺省）；老网关没有 */
  parts?: StudioMaskPart[]
  /** 该区域支持的细分部位（garment 才有）；老网关没有这个字段 = 不支持细分 */
  available_parts?: StudioMaskGarmentPart[]
}
