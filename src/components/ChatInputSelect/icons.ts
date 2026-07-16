// 下拉选项前的图标（按设计稿语义绘制的 16px 图标）。
// 说明：设计稿里各下拉图标按语义区分——比例=比例矩形、时长=时钟、
// 创作类型=图生图/文生图、模型=立方体、分辨率=嵌套框。原始设计为自动描摹的
// 大体积路径，这里按同一语义重绘为干净的 16px 图标，颜色取中性正文色 #3A3A3A。

const A = '#3A3A3A'

// 图生图：照片框 + 山 + 太阳
const IMG2IMG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6" stroke="${A}" stroke-width="1.2"/><circle cx="5.8" cy="6.4" r="1.1" fill="${A}"/><path d="M3 12.2l3.4-3.4 2.2 2.2 2.2-2.6 2.2 2.4" stroke="${A}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// 文生图：框 + 文本行
const TEXT2IMG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6" stroke="${A}" stroke-width="1.2"/><path d="M4.9 6.5h6.2M4.9 8.4h6.2M4.9 10.3h3.6" stroke="${A}" stroke-width="1.2" stroke-linecap="round"/></svg>`

// 时长：时钟
const DURATION = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="${A}" stroke-width="1.2"/><path d="M8 4.4V8l2.4 1.6" stroke="${A}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// 模型：立方体
const MODEL = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.2l5 2.8v6L8 13.8 3 11V5l5-2.8z" stroke="${A}" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 5l5 2.8L13 5M8 7.8v6" stroke="${A}" stroke-width="1.2" stroke-linejoin="round"/></svg>`

// 分辨率：嵌套框
const RESOLUTION = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.4" y="2.6" width="11.2" height="10.8" rx="1.4" stroke="${A}" stroke-width="1.2"/><rect x="2.4" y="7.6" width="7" height="5.8" rx="1.1" stroke="${A}" stroke-width="1.2"/></svg>`

// 比例：按 label "W:H" 生成对应比例的矩形轮廓（覆盖任意比例，含「智能比例」→ 正方形）
export function ratioIconSvg(label: string): string {
  const m = /(\d+)\s*[:：]\s*(\d+)/.exec(label || '')
  let w = 1
  let h = 1
  if (m) {
    w = Number(m[1]) || 1
    h = Number(m[2]) || 1
  }
  const max = 12
  let rw = max
  let rh = max
  if (w >= h) rh = Math.max(4, Math.round((h / w) * max))
  else rw = Math.max(4, Math.round((w / h) * max))
  const x = (16 - rw) / 2
  const y = (16 - rh) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="1.4" stroke="${A}" stroke-width="1.2"/></svg>`
}

// 下拉类别 → 每个选项对应图标
export type IconCategory = 'ratio' | 'duration' | 'model' | 'resolution' | 'entryCode'

export function getOptionIcon(category: IconCategory | undefined, option: { label: string; value: string | number }): string {
  switch (category) {
    case 'ratio':
      return ratioIconSvg(option.label)
    case 'duration':
      return DURATION
    case 'model':
      return MODEL
    case 'resolution':
      return RESOLUTION
    case 'entryCode':
      // 文生* → 文生图标；其余（图生/动作迁移/首尾帧）→ 图生图标
      return /^text/i.test(String(option.value)) ? TEXT2IMG : IMG2IMG
    default:
      return ''
  }
}
