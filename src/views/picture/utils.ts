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

export const showDownloadBtn = (item: any) => {
  const urls = item.contents.map((item: any) => item.resultUrl).filter((resultUrl: any) => !!resultUrl)

  return urls.length
}

export const getMetaData = (params: any) => {
  const ratioVal = params.params.width + ',' + params.params.height

  return `${entryCodeVal2Label[params.entryCode]} | ${ratioVal2Label[ratioVal]}`
}
