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

/**
 * 生成正方形缩略图 URL（用于选择网格等小方格展示）。
 * 原图往往远大于单元格，浏览器把大图缩到小方格时在高 DPR 屏上降采样质量差、出现噪点；
 * 改由 OSS 服务端按 单元格尺寸×devicePixelRatio 高质量裁剪缩放，输出 webp。
 * 注意：仅用于「展示」，选中值/提交后端仍应使用原图 URL。
 * 空 URL 或视频 URL 原样返回。
 * @param url 原图 OSS URL
 * @param w   CSS 像素下的目标宽（不含 DPR，DPR 由内部换算）
 * @param h   CSS 像素下的目标高，默认等于 w（正方形）
 */
export function ossThumbnail(url: string | undefined, w: number, h: number = w): string {
  if (!url || isVideoUrl(url)) return url ?? ''
  // 向上取整覆盖 1.5/2.25 等非整数缩放，封顶 3 防止请求过大
  const dpr = Math.min(Math.ceil(globalThis.devicePixelRatio || 1), 3)
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  // 去掉原有查询串取干净基址，保证只有一个 x-oss-process（公开模板资源无签名，安全）
  const base = url.split('?')[0]
  // m_fill：服务端按目标宽高居中裁剪填满，与展示层 object-fit:cover 居中裁剪一致
  return `${base}?x-oss-process=image/resize,m_fill,w_${pw},h_${ph}/format,webp/quality,q_90`
}
