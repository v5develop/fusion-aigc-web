// 颜色场景弹框的 19 个预制纯色背景图（图片 URL，选中直接作为背景图使用）
// 顺序取自腾讯文档「颜色场景色值」表序号 1~19（第 20「银灰调」不取，弹框第 20 格为「+自选」拾色入口）
const COLOR_BASE = 'https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/color/'

// 名称即 OSS 对象名（xxx.png），顺序与设计表一致
const SCENE_COLOR_NAMES = [
  '柔雾米白', // #F5F5F3
  '浅燕麦色', // #EAE3D8
  '高级暖灰', // #D9D9D9
  '雾霾浅蓝', // #A9B4C2
  '莫兰迪裸粉', // #E6D5D5
  '薄荷奶绿', // #DDE6E1
  '浅杏肤色', // #F2E4D8
  '烟灰淡紫', // #D4C8D9
  '中性浅灰', // #CCCCCC
  '清水浅蓝', // #D6E0E8
  '豆沙柔粉', // #D9C5C5
  '浅豆青绿', // #C8D8C8
  '奶咖浅棕', // #D8C8B8
  '雾霾淡紫', // #C8B8D8
  '米灰调', // #E0E0D8
  '天青浅蓝', // #B8C8D8
  '裸肤柔粉', // #E8D8D8
  '浅橄榄绿', // #B8C0B8
  '暖米白', // #F0EDE5
]

export const PRESET_SCENE_IMAGES: string[] = SCENE_COLOR_NAMES.map((name) => `${COLOR_BASE}${name}.png`)
