import { getMap } from '@/views/picture/constants.ts'

export const modelOps = [
  {
    label: '本地模型',
    value: 'local-video',
    resolutionOps: [
      { label: '720p', value: '720p' },
      { label: '1080p', value: '1080p' },
    ],
  },
  {
    label: 'seedance2.0',
    value: 'doubao-seedance-2-0-260128',
    resolutionOps: [
      { label: '480p', value: '480p' },
      { label: '720p', value: '720p' },
      { label: '1080p', value: '1080p' },
    ],
  },
  {
    label: 'seedance2.0-fast',
    value: 'doubao-seedance-2-0-fast-260128',
    resolutionOps: [
      { label: '480p', value: '480p' },
      { label: '720p', value: '720p' },
    ],
  },
]

export const entryCodeOps = [
  { label: '文生视频', value: 'textToVideo', modelOps },
  { label: '图生视频', value: 'imageToVideo', modelOps },
  { label: '动作迁移', value: 'actionTransfer', modelOps: modelOps.slice(0, 1) },
  { label: '首尾帧视频', value: 'firstLastFrames', modelOps },
]

export const ratioOps = [
  { label: '9:16', value: '720,1280' },
  { label: '16:9', value: '1280,720' },
]

export const durationOps = [
  { label: '4s', value: 4 },
  { label: '5s', value: 5 },
  { label: '6s', value: 6 },
  { label: '7s', value: 7 },
  { label: '8s', value: 8 },
  { label: '9s', value: 9 },
  { label: '10s', value: 10 },
  { label: '11s', value: 11 },
  { label: '12s', value: 12 },
  { label: '13s', value: 13 },
  { label: '14s', value: 14 },
  { label: '15s', value: 15 },
]

export const config: Record<string, any> = {
  textToVideo: {
    imageLimit: 5,
  },
  imageToVideo: {
    imageLimit: 5,
  },
  actionTransfer: {
    imageLimit: 1,
    videoLimit: 1,
  },
  firstLastFrames: {
    imageLimit: 2,
  },
}



export const entryCodeVal2Label: Record<string, any> = getMap(entryCodeOps)

export const modelVal2Label: Record<string, any> = getMap(modelOps)

export const ratioVal2Label: Record<string, any> = getMap(ratioOps)

export const durationVal2Label: Record<string, any> = getMap(durationOps)
