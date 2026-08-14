// 下拉选项前的图标——引用设计切图资源（src/assets/icons/select/*.svg，MasterGo 导出），不重绘。
// 比例图标是纯几何矩形，按选项 label(W:H) 生成对应比例的矩形轮廓（覆盖任意比例）。
import IMG2IMG from '@/assets/icons/select/img2img.svg?raw'
import TEXT2IMG from '@/assets/icons/select/text2img.svg?raw'
import MODEL_LOCAL from '@/assets/icons/select/model.svg?raw'
import MODEL_SEEDANCE from '@/assets/icons/select/model-seedance.svg?raw'
import RESOLUTION from '@/assets/icons/select/resolution.svg?raw'
import DURATION from '@/assets/icons/select/duration.svg?raw'
import TEXT2VIDEO from '@/assets/icons/select/video-text2video.svg?raw'
import IMG2VIDEO from '@/assets/icons/select/video-img2video.svg?raw'
import ACTION_TRANSFER from '@/assets/icons/select/video-action.svg?raw'
import FIRST_LAST_FRAMES from '@/assets/icons/select/video-frames.svg?raw'
import NUM_1 from '@/assets/icons/select/num-1.svg?raw'
import NUM_2 from '@/assets/icons/select/num-2.svg?raw'
import NUM_3 from '@/assets/icons/select/num-3.svg?raw'
import NUM_4 from '@/assets/icons/select/num-4.svg?raw'

// 生成数量图标（设计切图，MasterGo 导出）：按张数映射，1~4 张各有对应图形
const NUM_ICONS: Record<number, string> = { 1: NUM_1, 2: NUM_2, 3: NUM_3, 4: NUM_4 }

// entryCode 各选项对应设计切图（按精确 value 映射，每个创作类型有各自图标）
const ENTRY_CODE_ICONS: Record<string, string> = {
  imageToImage: IMG2IMG,
  textToImage: TEXT2IMG,
  textToVideo: TEXT2VIDEO,
  imageToVideo: IMG2VIDEO,
  actionTransfer: ACTION_TRANSFER,
  firstLastFrames: FIRST_LAST_FRAMES,
}

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

export type IconCategory = 'ratio' | 'duration' | 'model' | 'resolution' | 'entryCode' | 'num'

export function getOptionIcon(
  category: IconCategory | undefined,
  option: { label: string; value: string | number },
): string {
  switch (category) {
    case 'ratio':
      return ratioIconSvg(option.label)
    case 'num':
      // 按张数取设计切图，未知值兜底 1 张
      return NUM_ICONS[Number(option.value)] ?? NUM_1
    case 'duration':
      return DURATION
    case 'model': {
      // 自家 XiaoQi 全系(image flash/mini/plus/max、video lite)与 local* → 立方体；
      // 其余（Seedance、豆包加工厂等第三方）→ 彩色条。
      // 用前缀而非逐个枚举：XiaoQi 每加一档就漏改一次枚举，图标会静默变成第三方样式。
      const modelValue = String(option.value)
      if (/^local/i.test(modelValue) || /^xiaoqi-/i.test(modelValue)) return MODEL_LOCAL
      return MODEL_SEEDANCE
    }
    case 'resolution':
      return RESOLUTION
    case 'entryCode':
      // 按精确 value 映射到对应创作类型图标；未知值兜底用图生图
      return ENTRY_CODE_ICONS[String(option.value)] ?? IMG2IMG
    default:
      return ''
  }
}
