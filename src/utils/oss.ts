/**
 * OSS 图片处理工具。
 * 目前仅提供水印能力：给生成图片的展示 URL / 下载 URL 拼接 OSS 水印参数。
 * 注意：x-oss-process=image/watermark 是「图片专用」操作，拼到视频(mp4 等)上 OSS 会报错，
 * 因此 withWatermark 对视频 URL 原样返回，视频水印由后端在生成时烧录。
 */

// 右下角(g_se) logo 水印，透明度 75，偏移 12px；image_ 后为 base64("watermark-logo/image-watermark-logo.png")
const WATERMARK = 'image/watermark,image_d2F0ZXJtYXJrLWxvZ28vaW1hZ2Utd2F0ZXJtYXJrLWxvZ28ucG5n,t_75,g_se,x_12,y_12'

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i

/** 按扩展名判断是否视频 URL（用于跳过图片水印） */
export function isVideoUrl(url?: string): boolean {
  return !!url && VIDEO_EXT.test(url)
}

/**
 * 给 OSS 图片 URL 追加水印处理参数。空 URL 或视频 URL 原样返回。
 * 用字符串拼接而非 URLSearchParams，避免参数里的逗号/斜杠被编码成 %2C/%2F。
 */
export function withWatermark(url?: string): string {
  if (!url || isVideoUrl(url)) return url ?? ''
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}x-oss-process=${WATERMARK}`
}
