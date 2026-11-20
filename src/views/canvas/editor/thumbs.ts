/**
 * 画布卡片 / 生成历史的缩略图：原图地址 → 后端下发的缩略图地址。
 *
 * <p>后端只给私有引用的图片候选出缩略图（RunResult `candidates[].thumbUrl`、画布回填 `data.candidateThumbs`，
 * 缩放 + webp，处理参数在签名内——私有桶签名地址前端拼 `x-oss-process` 会 403）。按原图地址登记，
 * 不进节点 data：不参与保存 / 脏检测 / 撤销，也不会因为候选换了而错位。
 * 没登记的地址交给 {@link cardThumb}（公有未签名 OSS 前端拼缩放，其余原样）。
 *
 * ⚠️ 只用于展示；灯箱预览、下载、设为输出、传给下游一律用原地址。加载失败用 thumbFallback 退回原图。
 */
import { cardThumb } from '@/utils/oss'

/** 现签地址每次读都会变，登记表封顶，超出丢最早的 */
const MAX_ENTRIES = 2000
const registry = new Map<string, string>()

function remember(url: unknown, thumb: unknown): void {
  if (typeof url !== 'string' || !url || typeof thumb !== 'string' || !thumb || thumb === url) return
  registry.delete(url)
  registry.set(url, thumb)
  if (registry.size > MAX_ENTRIES) {
    const oldest = registry.keys().next().value
    if (oldest !== undefined) registry.delete(oldest)
  }
}

/** 登记一次 run 的候选缩略图（轮询结果 / 历史列表 / 选中候选回包） */
export function rememberRunThumbs(candidates: ReadonlyArray<{ url: string; thumbUrl?: string }> | undefined): void {
  for (const item of candidates ?? []) remember(item?.url, item?.thumbUrl)
}

/**
 * 画布快照回填的 `candidateThumbs`（与 `candidates` 同序）：登记后从 data 上摘掉。
 * 长度对不上视为不可信，不登记。
 */
export function takeCandidateThumbs(data: Record<string, unknown>): void {
  const thumbs = data.candidateThumbs
  delete data.candidateThumbs
  const urls = data.candidates
  if (!Array.isArray(thumbs) || !Array.isArray(urls) || thumbs.length !== urls.length) return
  urls.forEach((url, i) => remember(url, thumbs[i]))
}

/** 原图地址的展示用缩略图（w/h 为 CSS 像素，供前端拼缩放时用）；没有可用缩略图返回原地址 */
export function canvasThumb(url: string | undefined | null, w: number, h?: number): string {
  if (!url) return ''
  return cardThumb(url, registry.get(url), w, h)
}
