export const entryCodeOps = [
  { label: '图生图', value: 'imageToImage' },
  { label: '文生图', value: 'textToImage' },
]

export const ratioOps = [
  { label: '1:1', value: '1024,1024' },
  { label: '2:3', value: '832,1216' },
  { label: '3:2', value: '1216,832' },
  { label: '3:4', value: '864,1152' },
  { label: '4:3', value: '1152,864' },
  { label: '9:16', value: '720,1280' },
  { label: '16:9', value: '1280,720' },
]

export const entryCodeVal2Label: Record<string, any> = getMap(entryCodeOps)

export const ratioVal2Label: Record<string, any> = getMap(ratioOps)

export function getMap(options: any) {
  return Object.fromEntries(options.map((item: any) => [item.value, item.label]))
}
