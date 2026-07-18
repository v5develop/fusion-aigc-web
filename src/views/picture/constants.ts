export const entryCodeOps = [
  { label: '图生图', value: 'imageToImage' },
  { label: '文生图', value: 'textToImage' },
]

export const modelOps = [
  { label: '本地模型', value: 'local-image' },
  { label: 'GPT-Image-2', value: 'xiaoqi-gpt-image-2' },
]

// 尺寸↔比例的单一数据源在 @/utils/ratio，这里复用（供比例下拉与 ratioVal2Label）
export { imageRatioOps as ratioOps } from '@/utils/ratio'
import { imageRatioOps } from '@/utils/ratio'

export const entryCodeVal2Label: Record<string, any> = getMap(entryCodeOps)

export const modelVal2Label: Record<string, any> = getMap(modelOps)

export const ratioVal2Label: Record<string, any> = getMap(imageRatioOps)

export function getMap(options: any) {
  return Object.fromEntries(options.map((item: any) => [item.value, item.label]))
}
