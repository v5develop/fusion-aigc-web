import { entryCodeVal2Label, ratioVal2Label } from './constants.ts'

/**
 * 归一化历史记录的 inputParams 为图片 submit 入参，供「再次生成」复用。
 * 历史 inputParams 存在两种结构：
 *  1) 本站 submit 结构：{ type, entryCode, modelCode, params:{prompt,width,height,num}, images }
 *  2) 端上/agent 来源(source=aigc_chat)：{ scene, prompt, imageUrls, modelCode, params:{} }（无 entryCode）
 * 若不归一化，直接回传结构 2 会被后端拒绝：「创作场景(entryCode)不能为空」。
 * 尺寸缺失时回退到已生成素材 contents[0] 的宽高，尽量还原原始画幅。
 * @param single 单张再次生成时强制只出 1 张；否则沿用原任务数量
 */
export const buildResubmitParams = (item: any, single = false) => {
  const src = item?.inputParams ?? {}
  const p = src.params ?? {}
  const images: string[] = src.images ?? src.imageUrls ?? []
  const first = (item?.contents ?? [])[0] ?? {}
  // 结构 2 无 entryCode：图片仅两种能力，按有无输入图推断
  const entryCode = src.entryCode ?? (images.length ? 'imageToImage' : 'textToImage')
  return {
    type: 'IMAGE',
    entryCode,
    modelCode: src.modelCode ?? 'local-image',
    params: {
      prompt: p.prompt ?? src.prompt ?? '',
      width: p.width ?? first.width ?? 1024,
      height: p.height ?? first.height ?? 1024,
      // 单张固定 1 张；整批沿用原数量，缺失则按已生成素材数兜底
      num: single ? 1 : (p.num ?? (item?.contents?.length || 1)),
    },
    images,
  }
}

/** 记录是否来自 aigc_chat（端上/agent 来源）：这类素材隐藏「重新生成/再次生成」入口 */
export const isFromAigcChat = (item: any): boolean => item?.inputParams?.source === 'aigc_chat'

export const download = (item: any) => {
  const urls = item.contents.map((item: any) => item.resultUrl).filter((resultUrl: any) => !!resultUrl)

  urls.forEach((url: string, index: number) => {
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = url
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }, index * 150) // 每张间隔150ms，足够浏览器响应
  })
}

export const downloadSingle = (url: string) => {
  const a = document.createElement('a')
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export const showDownloadBtn = (item: any) => {
  const urls = item.contents.map((item: any) => item.resultUrl).filter((resultUrl: any) => !!resultUrl)

  return urls.length
}

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

/** 宽高 → 画幅比例标签：优先精确映射(ratioOps)，否则按 gcd 约分；无尺寸返回 ''。 */
function ratioLabel(w?: number, h?: number): string {
  if (!w || !h) return ''
  const exact = ratioVal2Label[`${w},${h}`]
  if (exact) return exact
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

function gcd(a: number, b: number): number {
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

/**
 * 任务元信息展示：能力名 | 画幅比例。入参为整条历史 item（含 inputParams + contents）。
 * 画幅比例权威来源是实际生成的素材(content.ratio，后端已返回)，缺失才回退请求入参尺寸映射/约分。
 * 防御式取值：缺字段/未知映射不再渲染 "undefined | undefined"，仅拼接非空段。
 */
export const getMetaData = (item: any) => {
  const params = item?.inputParams ?? {}
  const content = (item?.contents ?? [])[0] ?? {}
  const entryLabel = entryCodeVal2Label[params.entryCode] ?? ''
  // 画幅优先取素材 content.ratio；无则按请求尺寸精确映射(ratioOps)或 gcd 约分兜底
  const rLabel = content.ratio ?? ratioLabel(params.params?.width, params.params?.height)
  return [entryLabel, rLabel].filter(Boolean).join(' | ')
}
