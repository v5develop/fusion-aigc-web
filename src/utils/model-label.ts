import { reactive } from 'vue'

/**
 * 用户端模型名的单一映射口：任何「从数据里拿到的模型值」要给用户看，都过 {@link modelLabelOf}。
 * 用户永远不该看见厂商档位标记（Dev / Developer / Sunburst / Preview）、内部模型码（creaft-*）
 * 或模型组码（img.* / vlm.* / llm.* / vid.*）。传给后端的值（wire value）不在此改，但旧档位值要先过
 * {@link normalizeModelTier} 再进表单。
 */

/**
 * 旧档位值 → 现行档位值（兼容别名，只进不出）。
 * 2026-11 起应用侧不再区分 Dev/Developer：商拍模型档 GPT Image 2.5 的传值由旧值改为 `GPT25`
 * （Go 端永久接受旧值作入参别名）。旧草稿 / 任务参数 / 画布节点数据 / 做同款回填里仍可能带旧值，
 * 回填进表单前统一经此映射，下次提交即发新值。
 */
const LEGACY_TIER_ALIASES: Record<string, string> = {
  gpt25dev: 'GPT25', // 兼容别名：历史档位值（任意大小写）
}

/** 模型档位值归一：旧档位值 → `GPT25`，其余原样返回（非字符串 → 空串） */
export function normalizeModelTier(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return LEGACY_TIER_ALIASES[raw.toLowerCase()] ?? raw
}

/** 服务端目录下发的 code → 展示名（由 modelCatalog 加载后写入；这里放一份以便本文件无依赖） */
export const catalogModelLabels = reactive<Record<string, string>>({})

/** 商拍工作室模型档与已知内部码 → 友好名（与 views/studio/constants.ts 的 MODEL_OPTIONS 同口径） */
const KNOWN_LABELS: Record<string, string> = {
  通用: '通用',
  GPT: 'GPT Image 2.6',
  GPT25: 'GPT Image 2.5',
  Banana: 'Nano Banana 2.1',
  Seedream: 'Seedream 5.5',
  // 画布模型档 wire 值（节点 data.model / data.modelId；已保存的画布、运行记录里都是这些值，显示时一律换成完整名，不改存量数据）
  Image: 'GPT Image 2.5',
  'image-v1': 'GPT Image 2.5',
  'GPT Image 2.6': 'GPT Image 2.6',
  'gpt-image-2-6-v1': 'GPT Image 2.6',
  'banana-v1': 'Nano Banana 2.1',
  SD55: 'Seedream 5.5',
  'seedream-5-5-v1': 'Seedream 5.5',
  SD5P: 'Seedream 5.0 Pro',
  'sd5p-v1': 'Seedream 5.0 Pro',
  'Seedream 5 Pro': 'Seedream 5.0 Pro',
  'Seedance Fast': 'Seedance 2.0 Fast',
  'seedance-2-0-fast': 'Seedance 2.0 Fast',
  'Seedance Mini': 'Seedance 2.0 Mini',
  'seedance-2-0-mini': 'Seedance 2.0 Mini',
  'seedance-2-5': 'Seedance 2.5',
  'seedance-2-0': 'Seedance 2.0',
  // 现行模型组 / 模型码（后端已去掉 Dev / Developer 档位标记）
  'img.gpt-image-2.6-sunburst': 'GPT Image 2.6',
  'img.seedream-5.5': 'Seedream 5.5',
  'img.seedream-5-pro': 'Seedream 5.0 Pro',
  'img.nano-banana-2.1': 'Nano Banana 2.1',
  'img.gpt-image-2.5-sunburst': 'GPT Image 2.5',
  'creaft-nano-banana-2.1': 'Nano Banana 2.1',
  'creaft-gpt-image-2.5-sunburst': 'GPT Image 2.5',
  'studio-nano-banana-2.1-2ref': 'Nano Banana 2.1',
  // 兼容别名：改名前的旧组码 / 旧模型码（历史任务、草稿、提示词标签里仍可能出现），只用于显示
  'img.nano-banana-2.1-dev': 'Nano Banana 2.1',
  'img.gpt-image-2.5-sunburst-developer': 'GPT Image 2.5',
  'creaft-nano-banana-2.1-dev': 'Nano Banana 2.1',
  'creaft-gpt-image-2.5-sunburst-developer': 'GPT Image 2.5',
  'studio-nano-banana-2.1-dev-2ref': 'Nano Banana 2.1',
}

const titleCase = (t: string) => t.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bGpt\b/g, 'GPT')

const FALLBACK_LABEL = '其他模型'

/** 模型组码：img.xxx / vlm.xxx / llm.xxx / vid.xxx（含 aig:// 之类内部引用） */
const GROUP_CODE_RE = /^(?:img|vlm|llm|vid|asr|tts|ocr)\.[\w.\-]+$/i

/** 去掉厂商档位标记：末尾 Dev / Developer / Preview、中间的 Sunburst、`-dev` 码后缀 */
export function sanitizeModelText(text: string): string {
  return text
    .replace(/\bSunburst\b/gi, ' ')
    .replace(/[\s_-]+(Developer|Dev|Preview)\b/gi, '')
    .replace(/([a-z0-9])(?:Developer|Dev)$/g, '$1') // 不用后行断言：iOS < 16.4 解析即报错，整个模块加载失败
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 兜底：已有展示名只需去档位标记（后端过渡期仍可能下发旧名） */
export function displayModelLabel(label: string): string {
  return sanitizeModelText(label ?? '')
}

/**
 * 任意模型值 → 用户可见名。
 * 顺序：空 → 目录名 → 已知档 → 组码（取尾段并清洗，取不到则「其他模型」）→ 清洗后的原文。
 */
export function modelLabelOf(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  const fromCatalog = catalogModelLabels[raw]
  if (fromCatalog) return displayModelLabel(fromCatalog) || FALLBACK_LABEL
  const known = KNOWN_LABELS[raw] ?? KNOWN_LABELS[raw.toLowerCase()] ?? KNOWN_LABELS[normalizeModelTier(raw)]
  if (known) return known
  if (GROUP_CODE_RE.test(raw)) {
    const tail = sanitizeModelText(raw.slice(raw.indexOf('.') + 1).replace(/[-_]/g, ' '))
    return tail && !/^\d/.test(tail) ? titleCase(tail) : FALLBACK_LABEL
  }
  if (/^creaft[-.]/i.test(raw)) {
    const tail = sanitizeModelText(raw.replace(/^creaft[-.]/i, '').replace(/[-_]/g, ' '))
    return tail ? titleCase(tail) : FALLBACK_LABEL
  }
  return sanitizeModelText(raw) || FALLBACK_LABEL
}

/** 多个模型值（如提示词的 models 标签）→ 去重后的展示名列表 */
export function modelLabelsOf(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(modelLabelOf).filter(Boolean))]
}
