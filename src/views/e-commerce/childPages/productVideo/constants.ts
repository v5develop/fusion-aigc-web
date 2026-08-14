export const durationOps = [
  { label: '16秒', value: 16 },
  { label: '32秒', value: 32 },
  { label: '15秒', value: 15 },
]

export const localDurationOps = [
  { label: '16秒', value: 16 },
  { label: '32秒', value: 32 },
]

export const seedanceDurationOps = [{ label: '15秒', value: 15 }]

export const genderOps = [
  { label: '男', value: '男' },
  { label: '女', value: '女' },
  { label: '不限', value: '不限' },
]

export const ageOps = [
  { label: '青少年', value: '青少年' },
  { label: '青年', value: '青年' },
  { label: '中年', value: '中年' },
  { label: '成熟', value: '成熟' },
]

export const appearanceOps = [
  { label: '欧美白人', value: '欧美白人' },
  { label: '亚裔', value: '亚裔' },
  { label: '拉丁', value: '拉丁' },
  { label: '非裔', value: '非裔' },
  { label: '中东', value: '中东' },
]

export const bodyOps = [
  { label: '纤细', value: '纤细' },
  { label: '标准', value: '标准' },
  { label: '健美', value: '健美' },
  { label: '微胖', value: '微胖' },
]

/** 本地视频模型编码：时长档等分支逻辑按它判断，不是展示用的下拉项。 */
export const localModelValue = 'xiaoqi-video-1.0-lite'

// 模型下拉由服务端下发（后台停用即不出现），并按场景过滤 —— 没配档位的模型不显示，
// 否则选中后会静默回落到该场景的默认档：用别的模型出片、按别的模型计费。
export { videoModelOpsFor } from '@/utils/modelCatalog'
