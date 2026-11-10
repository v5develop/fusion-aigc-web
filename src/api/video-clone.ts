/**
 * 视频复刻「解析、标注」（Java `VideoCloneAnalysisController`，/api/v1/video-clone/analyses）。
 *
 * <p>流程：原片地址 → POST 开始解析（幂等：同一用户同一原片已有成功结果或在途解析时直接返回它，
 * 失败 / 可重试的原地重启）→ 每 2–3 秒 GET 轮询，直到 SUCCEEDED / FAILED。解析结果的字段名（camelCase）就是契约。
 * 出片仍走 `POST /api/v1/workflows/video`（title=video-clone），请求体多带 `videoClone` 标注（见 {@link VideoCloneAnnotations}）。
 *
 * <p>错误：1004 = 解析太频繁（限流），4001 = 解析号不属于本人；这两类走请求层的业务失败（会弹 toast 并 reject ApiError）。
 * 解析本身失败不是业务失败：HTTP 200 + status=FAILED，`errorMessage` 是可以直接给用户看的中文，`retryable=true` 时
 * 用同一个原片地址再 POST 一次即可重启。
 */
import { get, post } from './index.ts'

export type VideoCloneStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
export type VideoCloneStage = 'ingest' | 'probe' | 'frames' | 'transcribe' | 'vision' | 'done'

export type VideoCloneDimKey =
  | 'model'
  | 'garment'
  | 'accessory'
  | 'product'
  | 'motion'
  | 'expression'
  | 'line'
  | 'camera'
  | 'light'
  | 'scene'
  | 'style'

export type VideoClonePurpose = 'sell' | 'inspire' | 'tutorial' | 'story' | 'portfolio' | 'mixed'
export type VideoCloneTextStrategy = 'all' | 'watermark' | 'off'
export type VideoCloneResolution = 'follow' | '720p' | '1080p'
export type VideoCloneAudio = 'keep' | 'regenerate'
export type VideoCloneDimMode = 'keep' | 'replace' | 'describe'

export interface VideoCloneMeta {
  duration: number
  width: number
  height: number
  fps?: number
  /** 约分后的宽高比，如 11:20 */
  aspectRatio?: string
  hasAudio: boolean
  sizeBytes?: number
  type?: string
  purpose?: string
  purposeLabel?: string
  purposeReason?: string
}

export interface VideoCloneOccurrence {
  t0: number
  t1: number
  desc?: string
  /** 归属主体 id（subjects[].id） */
  subject?: string
}

export interface VideoCloneDim {
  /** false = 画面里没有这一项：置灰，提交时不能改它 */
  present: boolean
  desc?: string
  risk?: string
  occurrences?: VideoCloneOccurrence[]
}

export interface VideoCloneSubject {
  id: string
  name: string
  nameEn?: string
  desc?: string
  segments?: { t0: number; t1: number }[]
}

export interface VideoCloneSection {
  index: number
  t0: number
  t1: number
  desc?: string
  action?: string
  camera?: string
  appliesTo?: string[]
  /** 指向 frames[] 里最接近该段中点的一帧 */
  frameIndex?: number
}

export interface VideoCloneResult {
  meta: VideoCloneMeta
  /** kind：speech / music / mixed / silent / none（无音轨） */
  audio?: { hasTrack: boolean; kind?: string; note?: string }
  frames?: { index: number; t: number; url?: string }[]
  contactSheet?: { url?: string; times?: number[] }
  dims?: Partial<Record<VideoCloneDimKey, VideoCloneDim>>
  dimOrder?: string[]
  subjects?: VideoCloneSubject[]
  entities?: unknown[]
  sections?: VideoCloneSection[]
  onScreenText?: { t0: number; t1: number; text: string; kind?: string }[]
  transcript?: { source?: string; text?: string; lines?: { t0: number; t1: number; text: string; speaker?: string }[] }
  defaults?: { textStrategy?: string; resolution?: string; audio?: string }
}

/** POST 与 GET 同一形状（Java VideoCloneAnalysisService.View） */
export interface VideoCloneAnalysisView {
  analysisId: string
  status: VideoCloneStatus
  stage?: VideoCloneStage | string | null
  progress?: number | null
  errorCode?: string | null
  /** 可以直接给用户看的中文 */
  errorMessage?: string | null
  retryable?: boolean | null
  /** true = 命中了这条原片之前的解析（不重新跑） */
  reused?: boolean
  createdAt?: string | null
  finishedAt?: string | null
  result?: VideoCloneResult | null
}

/** 一个维度的标注（Java VideoCloneAnnotations.Dim）；没给的维度按「保持」 */
export interface VideoCloneDimMark {
  mode: VideoCloneDimMode
  /** ≤200 字；describe 必填 */
  note?: string
  /** 参考图序号，1 起，对应请求顶层 imageUrls 的顺序（@1 = imageUrls[0]） */
  refs?: number[]
  /** 只改哪些主体（subjects[].id）；空 = 所有人 */
  subjects?: string[]
  perSegment?: boolean
  segments?: { t0: number; refs?: number[]; note?: string }[]
  /** 仅 model + replace：造型用参考图（true）还是沿用原片（false） */
  withOutfit?: boolean
}

/** 提交体里的 `videoClone`（Java VideoCloneAnnotations） */
export interface VideoCloneAnnotations {
  analysisId: string
  purpose?: string
  textStrategy?: VideoCloneTextStrategy
  resolution?: VideoCloneResolution
  audio?: VideoCloneAudio
  dims?: Partial<Record<VideoCloneDimKey, VideoCloneDimMark>>
}

/** 开始解析（幂等）；返回当前状态，未完成时接着轮询 {@link getVideoCloneAnalysis} */
export function startVideoCloneAnalysis(videoUrl: string) {
  return post<VideoCloneAnalysisView>('/api/v1/video-clone/analyses', { videoUrl })
}

/** 查解析进度与结果 */
export function getVideoCloneAnalysis(analysisId: string) {
  return get<VideoCloneAnalysisView>(`/api/v1/video-clone/analyses/${encodeURIComponent(analysisId)}`)
}
