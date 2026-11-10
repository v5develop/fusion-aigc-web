export const entryCodeOps = [
  { label: '图生图', value: 'imageToImage' },
  { label: '文生图', value: 'textToImage' },
]

// 生图模型下拉：由服务端下发，不在前端写死（见 @/utils/modelCatalog）。
// 通用生图与全部电商生图页都 import 自本文件，故这里换成动态源等于全站生效。
// 写死的坏处不是「加模型要改两处」，而是后台停用的模型前端照样能选、选了才被拒。
export { imageModelOps as modelOps } from '@/utils/model-catalog'

// 生成数量：默认一张，最多四张（输入框下方「选择数量」筛选项）
export const numOps = [
  { label: '1张', value: 1 },
  { label: '2张', value: 2 },
  { label: '3张', value: 3 },
  { label: '4张', value: 4 },
]

// 尺寸↔比例的单一数据源在 @/utils/ratio，这里复用（供比例下拉与 ratioVal2Label）
export { imageRatioOps as ratioOps } from '@/utils/ratio'
import { imageRatioOps } from '@/utils/ratio'

export const entryCodeVal2Label: Record<string, any> = getMap(entryCodeOps)

// 模型名回显：模型表是异步加载的，不能在模块加载时 getMap 出一份静态快照（那永远是空的）。
// 直接复用目录里的 code → name 映射，加载完成后已渲染的历史记录也会跟着更新。
export { modelCodeToLabel as modelVal2Label } from '@/utils/model-catalog'

export const ratioVal2Label: Record<string, any> = getMap(imageRatioOps)

export function getMap(options: any) {
  return Object.fromEntries(options.map((item: any) => [item.value, item.label]))
}
