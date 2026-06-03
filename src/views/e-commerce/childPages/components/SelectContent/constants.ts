export interface IProps {
  platformOptions?: string[] // 平台
  countryOptions?: string[] // 国家
  languageOptions?: string[] // 语言
  ratioOptions?: string[] // 比例
}

export const _platformOptions = [
  { label: '淘宝/天猫', value: 0 },
  { label: '京东', value: 1 },
]

export const _countryOptions = [
  { label: '中国', value: 0 },
  { label: '美国', value: 1 },
]

export const _languageOptions = [
  { label: '中文', value: 0 },
  { label: '英文', value: 1 },
]

export const _ratioOptions = [
  { label: '中文', value: 0 },
  { label: '英文', value: 1 },
]
