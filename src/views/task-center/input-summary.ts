/**
 * 任务详情「提交内容」：从 /tasks/{taskId}/params 的 requestParams（提交时的请求体，已脱敏）里挑出
 * 提示词、参考素材、模型和常见参数。各入口的请求体形状不同，这里只认常见键，认不出的放进「更多参数」原样列出；
 * 不做推导、不补默认值——接口没给的就不显示。
 */
import { isVideoUrl } from '@/utils/oss'
import { modelLabelOf } from '@/utils/model-label'

export interface InputRef {
  url: string
  video: boolean
}

export interface InputParam {
  label: string
  value: string
}

export interface InputSummary {
  prompt: string
  negativePrompt: string
  model: string
  refs: InputRef[]
  params: InputParam[]
  /** 认不出的标量参数（原键名），折叠展示 */
  extra: InputParam[]
}

/** 模板 / 工作流提交把真正的参数包在这些键下面：摊平一层再认 */
const NESTED = new Set(['inputs', 'params', 'parameters', 'options', 'settings', 'config'])
const PROMPT_KEYS = /^(prompt|positivePrompt|userPrompt|textPrompt|imagePrompt|videoPrompt|description|instruction)$/i
const NEGATIVE_KEYS = /^(negativePrompt|negative_prompt|negative)$/i
const MODEL_KEYS = /^(model|modelCode|model_code|modelName|model_name)$/i
/** 不展示：鉴权 / 幂等 / 内部编号 / 回调类 */
const HIDDEN_KEYS = /token|secret|sign|password|callback|idempot|nonce|^(entryCode|taskId|userId|uid|appKey|requestId|mode)$/i
const REF_LIMIT = 12

const LABELS: Record<string, string> = {
  ratio: '画面比例',
  aspectratio: '画面比例',
  aspect_ratio: '画面比例',
  size: '尺寸',
  imagesize: '尺寸',
  resolution: '分辨率',
  width: '宽度',
  height: '高度',
  duration: '时长',
  count: '生成数量',
  n: '生成数量',
  num: '生成数量',
  number: '生成数量',
  imagecount: '生成数量',
  batchsize: '生成数量',
  quality: '质量',
  style: '风格',
  seed: '随机种子',
  fps: '帧率',
  language: '语言',
  targetlanguage: '目标语言',
  voice: '音色',
  strength: '强度',
  scene: '场景',
}

const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v.trim())
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function scalarText(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (typeof v === 'number') return key.toLowerCase() === 'duration' ? `${v} 秒` : String(v)
  if (typeof v === 'string') return v.trim()
  return ''
}

/** 收集一个值里的所有 http(s) 地址（字符串 / 字符串数组 / 带 url、image 字段的对象数组） */
function collectUrls(v: unknown, out: string[], depth = 0) {
  if (depth > 3 || out.length >= REF_LIMIT * 2) return
  if (isHttp(v)) out.push(v.trim())
  else if (Array.isArray(v)) v.forEach((x) => collectUrls(x, out, depth + 1))
  else if (isPlainObject(v)) Object.values(v).forEach((x) => collectUrls(x, out, depth + 1))
}

export function summarizeInput(raw: Record<string, unknown> | null | undefined): InputSummary | null {
  if (!raw || !isPlainObject(raw)) return null
  // 摊平一层嵌套参数（外层同名键优先）
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (NESTED.has(k) && isPlainObject(v)) {
      for (const [ik, iv] of Object.entries(v)) if (!(ik in raw)) flat[ik] = iv
    } else flat[k] = v
  }

  const out: InputSummary = { prompt: '', negativePrompt: '', model: '', refs: [], params: [], extra: [] }
  const urls: string[] = []
  const seenLabels = new Set<string>()

  for (const [k, v] of Object.entries(flat)) {
    if (HIDDEN_KEYS.test(k)) continue
    if (typeof v === 'string' && !v.trim()) continue
    if (NEGATIVE_KEYS.test(k) && typeof v === 'string') {
      out.negativePrompt ||= v.trim()
      continue
    }
    if ((PROMPT_KEYS.test(k) || /Prompt$/.test(k)) && typeof v === 'string' && !/^https?:\/\//i.test(v.trim())) {
      out.prompt ||= v.trim()
      continue
    }
    if (MODEL_KEYS.test(k) && typeof v === 'string') {
      out.model ||= modelLabelOf(v)
      continue
    }
    if (isHttp(v) || Array.isArray(v) || isPlainObject(v)) {
      collectUrls(v, urls)
      continue
    }
    const text = scalarText(k, v)
    if (!text) continue
    const label = LABELS[k.toLowerCase()]
    if (label) {
      if (seenLabels.has(label)) continue
      seenLabels.add(label)
      out.params.push({ label, value: text })
    } else out.extra.push({ label: k, value: text.length > 120 ? `${text.slice(0, 120)}…` : text })
  }

  out.refs = [...new Set(urls)].slice(0, REF_LIMIT).map((url) => ({ url, video: isVideoUrl(url) }))
  const empty = !out.prompt && !out.negativePrompt && !out.model && !out.refs.length && !out.params.length && !out.extra.length
  return empty ? null : out
}
