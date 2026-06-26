export interface ICheckboxCustomImageItem {
  field: 'white' | 'scence' | 'key_points' | 'detail'
  label: string
  desc: string
}
export const checkboxCustomImageList: ICheckboxCustomImageItem[] = [
  { field: 'white', label: '白底图', desc: '' },
  { field: 'scence', label: '场景图', desc: '' },
  { field: 'key_points', label: '卖点图', desc: '' },
  { field: 'detail', label: '细节图', desc: '' },
]
