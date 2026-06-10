export const platformOps = [
  { label: '淘宝/天猫', value: '淘宝/天猫' },
  { label: '京东', value: '京东' },
  { label: '拼多多', value: '拼多多' },
]

export const regionOps = [
  { label: '中国', value: '中国' },
  { label: '美国', value: '美国' },
  { label: '日本', value: '日本' },
]

export const languageOps = [
  { label: '中文', value: '中文' },
  { label: '英语', value: '英语' },
  { label: '日语', value: '日语' },
]

export const aspectRatioOps = [
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '16:9', value: '16:9' },
]


export interface ICheckboxCustomImageItem {
  field: 'white' | 'scence' | 'key_points' | 'detai'
  label: string
  desc: string
}
export const checkboxCustomImageList: ICheckboxCustomImageItem[] = [
  { field: 'white', label: '白底图', desc: '' },
  { field: 'scence', label: '场景图', desc: '' },
  { field: 'key_points', label: '卖点图', desc: '' },
  { field: 'detai', label: '细节图', desc: '' },
]
