// @unocss-include
/**
 * 节点端口（Vue Flow Handle）与端口标签的原子类，对齐原型：10px 圆点、1.5px 白描边，
 * 圆心压在卡片边框上（位置由 @vue-flow/core/dist/style.css 的 .vue-flow__handle-left/right 负责）。
 * 标签在卡片左外侧 10px，与端口同一 top 百分比、同为 -50% 纵向居中，保证圆心对齐。
 * 本文件是 .ts，默认不在 UnoCSS 扫描范围内，靠首行 @unocss-include 纳入。
 */

export type PortTone = 'prompt' | 'text' | 'image' | 'out' | 'video' | 'garment' | 'models'

const PORT_BASE = 'w-10px h-10px min-w-10px min-h-10px rounded-full border-[1.5px] border-solid border-white'

/**
 * 端口配色走设计系统（原型 --canvas-edge-* 主题变量同值）：提示词绿、图片藤紫、视频红；
 * 外圈 1px 浅色环同原型 canvas-v31 `.wf-model-port` 的 box-shadow。
 */
const PORT_TONE: Record<PortTone, string> = {
  prompt: 'bg-success shadow-[0_0_0_1px_#c7e3d5]',
  text: 'bg-success shadow-[0_0_0_1px_#c7e3d5]',
  image: 'bg-violet shadow-[0_0_0_1px_#d9c7e3]',
  out: 'bg-violet shadow-[0_0_0_1px_#d9c7e3]',
  video: 'bg-danger shadow-[0_0_0_1px_#ecc9c6]',
  garment: 'bg-violet-deep shadow-[0_0_0_1px_#d9c7e3]',
  models: 'bg-[#2f80ed] shadow-[0_0_0_1px_#d9c7e3]',
}

export function portClass(tone: PortTone): string {
  return `${PORT_BASE} ${PORT_TONE[tone]}`
}

/** 端口标签：原型 v3.1 `.wf-port-label.is-*` 浅底 + 同色字 + 细描边（r4 / 11px / 600） */
const LABEL_TONE: Record<PortTone, string> = {
  prompt: 'bg-success-soft text-success border-success-line',
  text: 'bg-success-soft text-success border-success-line',
  image: 'bg-violet-soft text-violet-ink border-violet-line',
  out: 'bg-violet-soft text-violet-ink border-violet-line',
  video: 'bg-danger-soft text-danger border-danger-line',
  garment: 'bg-violet-soft text-violet-deep border-violet-line',
  models: 'bg-violet-soft text-[#2f80ed] border-violet-line',
}

const LABEL_BASE =
  'absolute -left-10px px-7px py-2px border border-solid rounded-4px text-11px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100'

export function portLabelClass(tone: PortTone): string {
  return `${LABEL_BASE} ${LABEL_TONE[tone]}`
}

/** 连线显示色：快照里 data.color 仍存原始色值（与原型、服务端一致），渲染时映射到主题色 */
const EDGE_DEFAULT = '#875f9a'
const EDGE_THEME: Record<string, string> = {
  '#38bdf8': EDGE_DEFAULT,
  '#22c55e': '#34795a',
  '#f97373': '#b4433e',
  '#f472b6': '#b4433e',
}

export function edgeDisplayColor(raw?: string | null): string {
  if (!raw) return EDGE_DEFAULT
  return EDGE_THEME[raw.toLowerCase()] ?? raw
}
