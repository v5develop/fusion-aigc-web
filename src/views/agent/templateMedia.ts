/** 模板卡 / 预览 / 头条共用的展示小函数（行业版模板字段，见 api/plaza.ts） */
import type { IPlazaTemplate } from '@/api/plaza.ts'

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export function isVideoTemplate(t: Pick<IPlazaTemplate, 'mediaType' | 'videoUrl' | 'payload'>): boolean {
  if (t.mediaType) return t.mediaType === 'video'
  if (t.videoUrl) return true
  return VIDEO_RE.test(t.payload?.result?.[0] ?? '')
}

/** 封面：视频用 posterUrl，缺则效果图首张；图片用效果图首张 */
export function coverOf(t: IPlazaTemplate): string {
  const first = t.payload?.result?.[0] ?? t.payload?.image_urls?.[0] ?? ''
  const c = t.posterUrl || first
  // 老数据把视频地址放在 result 里：它不能当 <img>
  return VIDEO_RE.test(c) ? '' : c
}

/** 老数据（没有 mediaType / videoUrl）的视频地址就在效果图首张里 */
export function videoSrcOf(t: IPlazaTemplate): string {
  if (t.videoUrl) return t.videoUrl
  const first = t.payload?.result?.[0] ?? ''
  return VIDEO_RE.test(first) ? first : ''
}

/** 次数：<10000 写完整数字（千分位），≥10000 写「1.2万」，不用 k / w */
export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return n.toLocaleString('en-US')
}

/** C-02：近 7 天 {n} 人做过（次数不够 20 或服务端说不展示时返回空串） */
export function usageText(t: Pick<IPlazaTemplate, 'usageCount' | 'usageVisible'>): string {
  if (t.usageVisible === false) return ''
  const n = t.usageCount ?? 0
  return n >= 20 ? `近 7 天 ${formatCount(n)} 人做过` : ''
}

export function descOf(t: IPlazaTemplate): string {
  const d = t.payload?.description
  return typeof d === 'string' ? d.trim() : ''
}

/** 行业 · 二级：行业版取 industries[0]，老数据取前两个标签 */
export function industryLine(t: IPlazaTemplate): string {
  const ind = t.industries?.[0]
  if (ind) return t.industries!.map((x) => x.name).slice(0, 2).join(' · ')
  return (t.tags ?? []).slice(0, 2).join(' · ')
}
