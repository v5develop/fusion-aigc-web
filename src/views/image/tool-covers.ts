/**
 * 工具卡封面（2026-11-04 用户提供的一组实拍图，2026-11-06 落地页对齐轮接入）。
 *
 * <p>按工具名查（与原型 data/toolCovers.ts 同名同图），查不到回落到图标方块。
 * 图片在本仓库 public/images/tool-covers/；本地生活导航首页没有对应实拍图的条目沿用渐变占位。
 */
export const TOOL_COVERS: Record<string, string> = {
  高清放大: '/images/tool-covers/upscale.jpg',
  智能消除: '/images/tool-covers/eraser.jpg',
  智能抠图: '/images/tool-covers/cutout.jpg',
  图片翻译: '/images/tool-covers/image-translate.jpg',
  文字替换: '/images/tool-covers/text-replace.jpg',
  比例转换: '/images/tool-covers/aspect-convert.jpg',
  // 没有专属实拍图（2026-11-12）：借「单图复刻」的海报版式封面
  图片复刻: '/images/tool-covers/single-copy.jpg',
  图片生成: '/images/tool-covers/image-generate.jpg',
  商品精修: '/images/tool-covers/product-retouch.jpg',
  产品替换: '/images/tool-covers/product-replace.jpg',
  首屏主图: '/images/tool-covers/first-screen.jpg',
  场景生成: '/images/tool-covers/scene-generate.jpg',
  单图复刻: '/images/tool-covers/single-copy.jpg',
  单图复制: '/images/tool-covers/single-copy.jpg',
  SKU替换: '/images/tool-covers/sku-replace.jpg',
  服装去皱: '/images/tool-covers/wrinkle.jpg',
  商拍换装: '/images/tool-covers/product-garment.jpg',
  姿态复刻: '/images/tool-covers/pose-fission.jpg',
  // 2026-11-09 并入的原 AI 商拍 / AI 电商条目：没有专属实拍图，借同类功能的那张
  商拍生图: '/images/tool-covers/image-generate.jpg',
  AI试衣: '/images/tool-covers/product-garment.jpg',
  爆款图复刻: '/images/tool-covers/single-copy.jpg',
  人像换背景: '/images/tool-covers/scene-generate.jpg',
  本地生活: '/images/tool-covers/local-life.jpg',
  门店全案: '/images/tool-covers/local-life.jpg',
  数字人口播: '/images/tool-covers/oral-sell.jpg',
  爆款视频复刻: '/images/tool-covers/video-clone.jpg',
  口播带货: '/images/tool-covers/oral-sell.jpg',
  商品替换: '/images/tool-covers/product-replace-video.jpg',
  模特带货: '/images/tool-covers/model-sell.jpg',
  视频复刻: '/images/tool-covers/video-clone.jpg',
  视频生成: '/images/tool-covers/video-generate.jpg',
  视频翻译: '/images/tool-covers/video-translate.jpg',
  视频高清: '/images/tool-covers/video-enhance.jpg',
}

/** 工具名 → 封面地址；没有封面返回空串，调用方回落到图标 */
export function toolCover(name: string): string {
  return TOOL_COVERS[name] ?? ''
}
