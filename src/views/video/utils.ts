import { entryCodeVal2Label, modelVal2Label, ratioVal2Label, durationVal2Label } from './constants.ts'

/**
 * 素材尺寸是否不一致：同一任务多产出的 (resolution,ratio) 有多种取值时为 true。
 * 用于角标去重——同尺寸由顶部元信息行统一展示、不再逐张打角标；仅尺寸不一致时才逐张标注。
 */
export const isMixedSize = (contents: any[] = []): boolean => {
  const withSize = (contents ?? []).filter((c) => c && (c.resolution || c.ratio))
  if (withSize.length <= 1) return false
  const key = (c: any) => `${c.resolution ?? ''}|${c.ratio ?? ''}`
  const first = key(withSize[0])
  return withSize.some((c) => key(c) !== first)
}

/**
 * 视频任务元信息：能力 | 模型 | 画幅 | 分辨率 | 时长。入参为整条历史 item（含 inputParams + contents）。
 * 画幅/分辨率权威来源是实际生成的素材(content.ratio/resolution，后端已返回)，缺失才回退请求入参；
 * 能力/模型/时长为请求侧属性，取自 inputParams。防御式取值：缺字段/未知映射的段留空，仅拼接非空段，
 * 避免渲染出 "undefined | undefined" 或多余分隔符。
 */
export const getMetaData = (item: any) => {
  const params = item?.inputParams ?? {}
  const p = params.params ?? {}
  const content = (item?.contents ?? [])[0] ?? {}
  const segs = [
    entryCodeVal2Label[params.entryCode],
    modelVal2Label[params.modelCode],
    // 画幅/分辨率优先取实际素材(content)，缺失回退请求入参
    content.ratio ?? ratioVal2Label[p.aspectRatio] ?? p.aspectRatio,
    content.resolution ?? p.resolution,
    durationVal2Label[p.duration] ?? (p.duration != null ? `${p.duration}s` : undefined),
  ]
  return segs.filter((s) => s != null && s !== '').join(' | ')
}
