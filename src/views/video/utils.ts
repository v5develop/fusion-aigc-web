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
 * 归一化历史记录的 inputParams 为视频 submit 入参，供「再次生成」复用。
 * 历史 inputParams 存在两种结构：
 *  1) 本站 submit 结构：{ type, entryCode, modelCode, params:{prompt,resolution,aspectRatio,duration}, images, video }
 *  2) 端上/agent 来源(source=aigc_chat)：{ scene, prompt, imageUrls, videoUrls, modelCode, params:{} }（无 entryCode）
 * 若不归一化，直接回传结构 2 会被后端拒绝：「创作场景(entryCode)不能为空」。
 */
export const buildResubmitParams = (item: any) => {
  const src = item?.inputParams ?? {}
  const p = src.params ?? {}
  const images: string[] = src.images ?? src.imageUrls ?? []
  const video: string = src.video ?? (src.videoUrls ?? [])[0] ?? ''
  const first = (item?.contents ?? [])[0] ?? {}
  // 结构 2 无 entryCode：按有无输入图兜底推断（多数记录已带 entryCode，走原值）
  const entryCode = src.entryCode ?? (images.length ? 'imageToVideo' : 'textToVideo')
  const isActionTransfer = entryCode === 'actionTransfer'
  return {
    type: 'VIDEO',
    entryCode,
    modelCode: src.modelCode ?? 'xiaoqi-video-1.0-lite',
    params: {
      prompt: p.prompt ?? src.prompt ?? '',
      // size 由请求入口按 aspectRatio 统一推导；动作迁移无画幅、入口不注入（与首次生成一致）
      // 动作迁移由参考视频决定画幅/时长，不传比例/分辨率/时长
      ...(isActionTransfer
        ? {}
        : {
            resolution: p.resolution,
            aspectRatio: p.aspectRatio ?? p.ratio ?? first.ratio,
            duration: p.duration,
          }),
    },
    images,
    // 动作迁移才带输入视频
    video: isActionTransfer ? video : '',
  }
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
