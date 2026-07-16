// 下拉选项前的图标——引用设计切图资源（src/assets/icons/select/*.svg，MasterGo 导出），不重绘。
// 比例图标是纯几何矩形，按选项 label(W:H) 生成对应比例的矩形轮廓（覆盖任意比例）。
import IMG2IMG from '@/assets/icons/select/img2img.svg?raw'
import TEXT2IMG from '@/assets/icons/select/text2img.svg?raw'
import MODEL from '@/assets/icons/select/model.svg?raw'
import RESOLUTION from '@/assets/icons/select/resolution.svg?raw'
import DURATION from '@/assets/icons/select/duration.svg?raw'

// 比例：按 label "W:H" 生成对应比例的矩形轮廓（几何图形，非插画重绘；覆盖任意比例，「智能比例」→ 正方形）
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="1.4" stroke="#3A3A3A" stroke-width="1.2"/></svg>`
}

export type IconCategory = 'ratio' | 'duration' | 'model' | 'resolution' | 'entryCode'

export function getOptionIcon(
  category: IconCategory | undefined,
  option: { label: string; value: string | number },
): string {
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
      // 文生* → 文生图；其余（图生/动作迁移/首尾帧）→ 图生图
      return /^text/i.test(String(option.value)) ? TEXT2IMG : IMG2IMG
    default:
      return ''
  }
}
