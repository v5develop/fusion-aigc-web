// 颜色场景弹框的 20 个预制纯色背景图（图片 URL，选中直接作为背景图使用）
// TODO: 当前全部为占位图，待设计终稿提供后整批替换为正式 URL
const PLACEHOLDER = 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/green.png'

// 19 个预制块 + 弹框内第 20 格为「+自选」拾色入口
export const PRESET_SCENE_IMAGES: string[] = Array.from({ length: 19 }, () => PLACEHOLDER)
