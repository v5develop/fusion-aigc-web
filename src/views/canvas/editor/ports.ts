// @unocss-include
/**
 * 节点端口（Vue Flow Handle）与端口标签的原子类，对齐原型：10px 圆点、1.5px 白描边，
 * 圆心压在卡片边框上（位置由 @vue-flow/core/dist/style.css 的 .vue-flow__handle-left/right 负责）。
 * 标签在卡片左外侧 10px，与端口同一 top 百分比、同为 -50% 纵向居中，保证圆心对齐。
 * 本文件是 .ts，默认不在 UnoCSS 扫描范围内，靠首行 @unocss-include 纳入。
 */

export type PortTone = 'prompt' | 'text' | 'image' | 'out' | 'video' | 'garment' | 'models'

/**
 * 10px 圆点视觉 + 透明 ::after 23px 圆形命中区（居中，原型 canvas-v31 .wf-model-port::after）：
 * 伪元素算作 Handle 本身，拖线落点与悬停都更好命中；伸进卡片只有 6.5px，压在卡片内边距上，不挡正文控件。
 * 连线拖动中 Vue Flow 给指针下的口加 .connecting，合法再加 .valid：不合法的目标口变红（浅红底 + 3px 红环），
 * 合法的加一圈浅绿环。
 */
const PORT_HIT =
  'after:content-empty after:absolute after:left-50% after:top-50% after:w-23px after:h-23px after:rounded-full after:-translate-x-50% after:-translate-y-50%'
// 注意：UnoCSS 的 [&.x:not(.y)] 变体会丢掉自身类名、生成全局选择器（画布容器也带 .connecting），所以不用 :not：
// 先给所有 .connecting 上红，再用更高优先级的 .connecting.valid 按端口色还原（见 PORT_TONE 里的 VALID_*）
const PORT_CONNECTING =
  '[&.connecting]:!bg-danger-line [&.connecting]:!shadow-[0_0_0_3px_var(--xq-danger)] [&.connecting]:!opacity-100 [&.connecting.valid]:!shadow-[0_0_0_3px_rgb(var(--xq-success-rgb)/0.35)]'
const PORT_BASE = `z-4 w-10px h-10px min-w-10px min-h-10px rounded-full border-[1.5px] border-solid border-surface ${PORT_HIT} ${PORT_CONNECTING}`

/**
 * 端口配色走设计系统（原型 --canvas-edge-* 主题变量同值）：提示词绿、图片藤紫、视频红；
 * 外圈 1px 浅色环同原型 canvas-v31 `.wf-model-port` 的 box-shadow。
 */
const PORT_TONE: Record<PortTone, string> = {
  prompt: 'bg-success shadow-[0_0_0_1px_var(--xq-success-line)] [&.connecting.valid]:!bg-success',
  text: 'bg-success shadow-[0_0_0_1px_var(--xq-success-line)] [&.connecting.valid]:!bg-success',
  image: 'bg-violet shadow-[0_0_0_1px_var(--xq-violet-line)] [&.connecting.valid]:!bg-violet',
  out: 'bg-violet shadow-[0_0_0_1px_var(--xq-violet-line)] [&.connecting.valid]:!bg-violet',
  video: 'bg-danger shadow-[0_0_0_1px_var(--xq-danger-line)] [&.connecting.valid]:!bg-danger',
  garment: 'bg-violet-deep shadow-[0_0_0_1px_var(--xq-violet-line)] [&.connecting.valid]:!bg-violet-deep',
  models: 'bg-[#2f80ed] shadow-[0_0_0_1px_var(--xq-violet-line)] [&.connecting.valid]:!bg-[#2f80ed]',
}

export function portClass(tone: PortTone): string {
  return `${PORT_BASE} ${PORT_TONE[tone]}`
}

/** 端口标签：原型 v3.1 `.wf-port-label.is-*` 浅底 + 同色字 + 细描边（r4 / 11px / 600）；常驻显示（2026-11-07 审计 18） */
const LABEL_TONE: Record<PortTone, string> = {
  prompt: 'bg-success-soft text-success border-success-line',
  text: 'bg-success-soft text-success border-success-line',
  image: 'bg-violet-soft text-violet-ink border-violet-line',
  out: 'bg-violet-soft text-violet-ink border-violet-line',
  video: 'bg-danger-soft text-danger border-danger-line',
  garment: 'bg-violet-soft text-violet-deep border-violet-line',
  models: 'bg-violet-soft text-[#2f80ed] [[data-theme=dark]_&]:text-[#7fb0f5] border-violet-line',
}

const LABEL_BASE =
  'absolute -left-10px px-7px py-2px border border-solid rounded-4px text-11px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none'

export function portLabelClass(tone: PortTone): string {
  return `${LABEL_BASE} ${LABEL_TONE[tone]}`
}

/**
 * 生成节点的输入口：未接线时常驻 55% 透明，悬停 / 选中节点或已接线时不透明
 * （原型 CanvasModelNode `.wf-model-port:not(.is-wired)`）。
 */
export const PORT_UNWIRED = 'opacity-55 group-hover:opacity-100 [.is-selected_&]:opacity-100'

/**
 * 连线显示色：快照里 data.color 仍存原始色值（与原型、服务端一致），渲染时映射到主题色。
 * 返回 CSS 变量（浅色 = 原 #875f9a / #34795a / #b4433e，深色自动换成提亮的同色），
 * 所以调用方必须走 style（SVG 的 stroke 属性不认 var()）；自定义色原样返回。
 */
const EDGE_DEFAULT = 'var(--xq-violet)'
const EDGE_THEME: Record<string, string> = {
  '#38bdf8': EDGE_DEFAULT,
  '#22c55e': 'var(--xq-success)',
  '#f97373': 'var(--xq-danger)',
  '#f472b6': 'var(--xq-danger)',
}

export function edgeDisplayColor(raw?: string | null): string {
  if (!raw) return EDGE_DEFAULT
  return EDGE_THEME[raw.toLowerCase()] ?? raw
}
