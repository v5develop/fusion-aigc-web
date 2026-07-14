import { entryCodeVal2Label, ratioVal2Label } from './constants.ts'

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
