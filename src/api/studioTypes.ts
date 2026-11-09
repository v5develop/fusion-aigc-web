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
  /** 服装蒙版（软 alpha PNG，校色只作用于蒙版内）；网关暂未下发，预留 */
  mask_url?: string
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
