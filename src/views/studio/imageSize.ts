/**
 * 上传前的图片尺寸检查（商拍换装服装图 / 模特图、姿态复刻人物图 / 姿势图）。
 *
 * <p>Go studio 没有单独的最小尺寸校验（切图只会把短边 <256 的裁切结果放大），太小的原图放大后细节糊、识别人物容易失败，
 * 所以在前端拦：短边 < 240px 不上传。读不出尺寸（浏览器不认的格式 / 解码失败）不拦，交给服务端。
 */
export const MIN_SHORT_SIDE = 240

export const tooSmallText = (name: string) => `「${name}」图片太小（短边需 ≥${MIN_SHORT_SIDE}px）`

/** 读图片宽高；解码失败返回 null */
export function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof Image === 'undefined') return resolve(null)
    const src = URL.createObjectURL(file)
    const img = new Image()
    const done = (v: { width: number; height: number } | null) => {
      URL.revokeObjectURL(src)
      resolve(v)
    }
    img.onload = () =>
      done(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    img.onerror = () => done(null)
    img.src = src
  })
}

/** 短边不够返回提示句，否则 null */
export async function checkMinShortSide(file: File, min = MIN_SHORT_SIDE): Promise<string | null> {
  const size = await readImageSize(file)
  if (!size) return null
  return Math.min(size.width, size.height) < min ? tooSmallText(file.name) : null
}
