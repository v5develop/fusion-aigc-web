/** 校色套件的文件名与下载小工具 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i

/** Blob → 浏览器下载（延迟回收 objectURL，Safari / 旧 Firefox 立即回收会落空） */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** 原图下载文件名补扩展名：已带图片扩展名原样返回，否则按地址后缀补（认不出按 jpg） */
export function withImageExt(name: string, url: string): string {
  if (IMAGE_EXT.test(name)) return name
  let ext = 'jpg'
  try {
    ext = new URL(url, location.href).pathname.match(IMAGE_EXT)?.[1]?.toLowerCase() ?? 'jpg'
  } catch {
    /* 解析不了按 jpg */
  }
  return `${name}.${ext}`
}

/** 烘出来的图一律 PNG：文件名补 / 换成 .png */
export function withPngExt(name: string): string {
  if (/\.png$/i.test(name)) return name
  return `${name.replace(IMAGE_EXT, '')}.png`
}

/** 烘图上传（存资产 / 画布节点 / 新画布）：先按长边 3072 烘，超过 9.5MB 再按 2048 烘一次（goUpload 上限 10MB） */
export const UPLOAD_BAKE_MAX_SIDE = 3072
export const UPLOAD_BAKE_FALLBACK_SIDE = 2048
export const UPLOAD_BAKE_MAX_BYTES = 9.5 * 1024 * 1024

/** 按上传口径烘图：bake(maxSide) 返回 null（没校色 / 已提示失败）原样返回 null；烘图失败照常抛错 */
export async function bakeForUpload<T extends Blob>(bake: (maxSide: number) => Promise<T | null>): Promise<T | null> {
  const first = await bake(UPLOAD_BAKE_MAX_SIDE)
  if (!first || first.size <= UPLOAD_BAKE_MAX_BYTES) return first
  return bake(UPLOAD_BAKE_FALLBACK_SIDE)
}
