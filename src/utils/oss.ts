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
 *
 * ⚠️ 只用于【展示】，绝不能用在下载路径上。
 * 产品口径是「展示有水印、下载给原件」：拼上本参数后 OSS 返回的是带水印的变体，
 * 用户下到本地的文件就洗不掉了。download.ts 里所有抓取一律用原始 url。
 *
 * 另需知道：这层水印本就拦不住人——原图 URL 公有桶可直连，删掉 ?x-oss-process= 即是原图。
 * 它的作用是默认展示态带标识，不是版权保护。真要防护得让原图进私有桶、下载走签名接口鉴权。
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

/** 额外允许做 OSS 图片处理的主机（自定义 CDN 域名，逗号分隔）；*.aliyuncs.com 默认认 */
const EXTRA_OSS_HOSTS = String(import.meta.env.VITE_OSS_IMAGE_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

/** 带签名的地址（OSS v1/v4、S3、TOS 等）：参数在签名里，多拼一个 x-oss-process 就 403，一律不动 */
const SIGNED_QUERY =
  /[?&](signature|x-oss-signature|x-oss-credential|x-amz-signature|x-tos-signature|expires|ossaccesskeyid|security-token|auth_key)=/i

function isOssImageHost(host: string) {
  const h = host.toLowerCase()
  return h.endsWith('.aliyuncs.com') || EXTRA_OSS_HOSTS.some((x) => h === x || h.endsWith(`.${x}`))
}

/**
 * 列表 / 网格 / 历史卡用的缩略图地址：按宽等比缩小（m_lfit，不裁切、不放大）+ webp。
 *
 * <p>只对「公有、未签名的阿里云 OSS 图片」生效，其余一律原样返回，保证不会把能看的图变成裂图：
 * 视频、data: / blob:、非 OSS 主机（可用 VITE_OSS_IMAGE_HOSTS 补自定义域名）、带签名参数的地址都不动。
 * 地址已带 `x-oss-process=image/...`（如展示水印）时把缩放接在同一条处理链后面，不另起第二个参数。
 *
 * ⚠️ 只用于【展示】；预览大图、下载、提交给后端一律用原地址。
 * @param url 原图地址
 * @param w   展示宽（CSS 像素），内部按 devicePixelRatio（封顶 2）换算
 * @param h   给了就按「短边铺满」缩（m_mfit，配合 object-fit:cover 的方格缩略，横图竖图都不糊）；不给只限宽
 */
export function ossResize(url: string | undefined | null, w: number, h?: number): string {
  if (!url) return ''
  if (isVideoUrl(url) || !/^https?:\/\//i.test(url) || SIGNED_QUERY.test(url)) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!isOssImageHost(parsed.hostname)) return url
  const dpr = Math.min(Math.ceil(globalThis.devicePixelRatio || 1), 2)
  const pw = Math.max(16, Math.round(w * dpr))
  const box = h ? `m_mfit,w_${pw},h_${Math.max(16, Math.round(h * dpr))}` : `m_lfit,w_${pw}`
  const resize = `resize,${box},limit_1/format,webp/quality,q_85`
  const existing = parsed.searchParams.get('x-oss-process')
  if (existing == null) return `${url}${url.includes('?') ? '&' : '?'}x-oss-process=image/${resize}`
  // 已有处理链：只接图片处理；样式（style/…）等别的写法不敢动
  // 已有缩放 / 格式转换的链不再叠第二遍（重复的 format 操作 OSS 处理结果不可控）
  if (!existing.startsWith('image/') || /(^|\/)(resize|format),/.test(existing)) return url
  return url.replace(/([?&]x-oss-process=)([^&#]*)/, (_m, k: string, v: string) => `${k}${v}/${resize}`)
}

/**
 * 缩略图加载失败时退回原图（个别格式 / 主机不支持处理参数）：已退过一次或本来就是原图时返回 false，交给调用方走失败态。
 * 用法：`@error="(e) => thumbFallback(e, url) || markBroken()"`
 */
export function thumbFallback(e: Event, original?: string | null): boolean {
  const img = e.target as HTMLImageElement | null
  // 记的是「为哪张原图退过」而不是一个布尔：虚拟列表复用 <img> 换了别的图时，新图仍能退一次
  if (!img || !original || img.dataset.thumbRetried === original || img.src === original) return false
  img.dataset.thumbRetried = original
  img.src = original
  return true
}
