import { getMap } from '@/views/image/constants.ts'
import { videoModelOpsFor } from '@/utils/model-catalog'

// 生视频模型下拉（含各模型自己的分辨率档）：与生图同源，由服务端下发，后台停用即不出现。
export { videoModelOps as modelOps } from '@/utils/model-catalog'

/**
 * 各场景可选模型按 <b>服务端下发的 entry_codes</b> 过滤，前端不维护「哪个场景支持哪些模型」的名单。
 *
 * <p>支持与否的真相在计费档位里：能不能提交的判据就是这个模型在该场景有没有 BILLED 档位，
 * 用同一份数据回答「能不能选」才不会出现「能选、提交才报无法匹配计费档位」。
 * 举两个自动生效的例子：动作迁移只配了本地视频模型的档；xiaoqi-video-1.0-mini（task_type 51）
 * 契约里没有参考素材字段，只配了文生视频档，于是它只会出现在文生视频下拉里。
 *
 * <p>用 getter 而非模块加载时求值：模型表是异步填充的，直接取值会永远拿到空数组。
 */
export const entryCodeOps = [
  {
    label: '文生视频',
    value: 'textToVideo',
    get modelOps() {
      return videoModelOpsFor('textToVideo')
    },
  },
  {
    label: '图生视频',
    value: 'imageToVideo',
    get modelOps() {
      return videoModelOpsFor('imageToVideo')
    },
  },
  {
    label: '动作迁移',
    value: 'actionTransfer',
    get modelOps() {
      return videoModelOpsFor('actionTransfer')
    },
  },
  {
    label: '首尾帧视频',
    value: 'firstLastFrames',
    get modelOps() {
      return videoModelOpsFor('firstLastFrames')
    },
  },
]

export const ratioOps = [
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
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
    imageLimit: 1,
  },
  actionTransfer: {
    imageLimit: 1,
    videoLimit: 1,
    videoDuration: 20,
    videoSize: 20,
    promptDisabled: true,
    promptPlaceholder: '上传图片，上传参考的动作视频即可生成',
  },
  firstLastFrames: {
    imageLimit: 2,
  },
}

export const entryCodeVal2Label: Record<string, any> = getMap(entryCodeOps)

// 与生图同一份 code → name 映射（模型表异步加载，静态快照会永远为空）
export { modelCodeToLabel as modelVal2Label } from '@/utils/model-catalog'

export const ratioVal2Label: Record<string, any> = getMap(ratioOps)

export const durationVal2Label: Record<string, any> = getMap(durationOps)
