/**
 * 视频复刻的十一维、片子目的与原片文字策略（键名与 Java VideoCloneDims / 原型 data/video-clone-demo.ts 同一套）。
 */
import type { VideoCloneDimKey, VideoCloneTextStrategy } from '@/api/videoClone'

export const VC_DIMS: VideoCloneDimKey[] = [
  'model',
  'garment',
  'accessory',
  'product',
  'motion',
  'expression',
  'line',
  'camera',
  'light',
  'scene',
  'style',
]

export const VC_DIM_CN: Record<VideoCloneDimKey, string> = {
  model: '人物',
  garment: '服装',
  accessory: '配饰',
  product: '商品',
  motion: '动作',
  expression: '表情',
  line: '台词',
  camera: '镜头',
  light: '光线',
  scene: '场景',
  style: '风格',
}

/** 与主体（人）相关、可以只改其中一个人的维度（Java VideoCloneDims.SUBJECT_DIMS） */
export const VC_SUBJECT_DIMS: VideoCloneDimKey[] = [
  'model',
  'garment',
  'accessory',
  'product',
  'motion',
  'expression',
  'line',
]

export interface VcPurpose {
  key: string
  label: string
  text: VideoCloneTextStrategy
  order: VideoCloneDimKey[]
  /** 用户改了目的（不是解析判断的那个）时显示的一句话 */
  why: string
}

export const VC_PURPOSES: VcPurpose[] = [
  {
    key: 'sell',
    label: '带货转化',
    text: 'watermark',
    order: [
      'garment',
      'product',
      'model',
      'accessory',
      'motion',
      'expression',
      'camera',
      'light',
      'scene',
      'style',
      'line',
    ],
    why: '按带货片处理：先看服装、商品与人物。',
  },
  {
    key: 'inspire',
    label: '种草审美',
    text: 'all',
    order: [
      'garment',
      'light',
      'scene',
      'style',
      'model',
      'accessory',
      'motion',
      'expression',
      'camera',
      'line',
      'product',
    ],
    why: '按种草片处理：先看服装、光线、场景与风格。',
  },
  {
    key: 'tutorial',
    label: '教程',
    text: 'watermark',
    order: [
      'motion',
      'line',
      'camera',
      'model',
      'garment',
      'accessory',
      'expression',
      'light',
      'scene',
      'style',
      'product',
    ],
    why: '按教程处理：先看动作、台词与机位。',
  },
  {
    key: 'story',
    label: '剧情',
    text: 'all',
    order: [
      'model',
      'expression',
      'line',
      'motion',
      'camera',
      'garment',
      'scene',
      'light',
      'style',
      'accessory',
      'product',
    ],
    why: '按剧情处理：先看人物、表情与台词。',
  },
  {
    key: 'portfolio',
    label: '形象 / 作品集',
    text: 'all',
    order: [
      'model',
      'garment',
      'camera',
      'scene',
      'light',
      'style',
      'motion',
      'expression',
      'accessory',
      'product',
      'line',
    ],
    why: '按形象 / 作品集处理：先看人物、服装、机位与场景。',
  },
  { key: 'mixed', label: '混合，说不准', text: 'all', order: VC_DIMS, why: '按混合片处理：沿用通用顺序。' },
]

export const purposeOf = (key: string | undefined) => VC_PURPOSES.find((p) => p.key === key)

export const VC_TEXT_OPTIONS: { key: VideoCloneTextStrategy; label: string; hint: string }[] = [
  { key: 'all', label: '文字全清', hint: '新片里不要任何字幕文字；原片已有的水印角标一并清掉' },
  { key: 'watermark', label: '只清水印', hint: '只清平台水印和角标；画面里的卖点文字、价格、讲解字幕保留' },
  { key: 'off', label: '保留原样', hint: '完全不提文字，原样保留' },
]

/** 音轨类型的中文（Java Audio.kind） */
export const VC_AUDIO_KIND: Record<string, string> = {
  speech: '人声',
  music: 'BGM',
  mixed: '人声 + BGM',
  silent: '静音',
  none: '无音轨',
}

/** 标注说明的字数上限（Java VideoCloneSubmissionPreparer.NOTE_MAX） */
export const VC_NOTE_MAX = 200

/** 参考图上限（@1–@9） */
export const VC_MAX_REFS = 9

/** 四步进度：上传 / 抽帧 + 音轨 / 看画面 / 标维度 */
export const VC_STEPS = ['上传', '抽帧 + 音轨', '看画面', '标维度'] as const

/** 后端 stage → 第几步（0 起） */
export function stepOfStage(stage: string | null | undefined): number {
  switch (stage) {
    case 'probe':
    case 'frames':
    case 'transcribe':
      return 1
    case 'vision':
      return 2
    case 'done':
      return 3
    default:
      return 0
  }
}

export const VC_STAGE_TEXT: Record<string, string> = {
  ingest: '正在读取原片…',
  probe: '正在读视频信息…',
  frames: '正在抽帧…',
  transcribe: '正在体检音轨、转写台词…',
  vision: '正在看画面（约 10–30 秒）…',
}

export function fmtSeconds(n: number | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(1)}s` : '—'
}

export function fmtSpan(t0: number, t1: number): string {
  return `${t0.toFixed(1)}–${t1.toFixed(1)}s`
}
