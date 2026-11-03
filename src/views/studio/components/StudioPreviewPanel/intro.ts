/**
 * 右列「功能介绍 / 适用场景」文案（原型 ToolIntroPanel；文案取自原型各工具页的 intro / scenes 常量）。
 *
 * <p>键 = feature：默认取 StudioWorkspaceColumns 的 kind，未传 kind 时取路由名去掉 `studio-` 前缀。
 * 页面也可以直接传 intro / scenes 覆盖这里的默认值。
 */
export interface StudioIntroCopy {
  intro: string
  scenes: string[]
}

export const STUDIO_INTRO: Record<string, StudioIntroCopy> = {
  /** 原型 views/tools/pages/AiDigitalModel.vue（商拍换装） */
  tryon: {
    intro: '上传服装与模特，选出要替换的单品，AI 把衣服穿到模特身上；细节裁切与提示词由系统自动完成。',
    scenes: ['同一套搭配换给多位模特', '一件衣服出多张上身图', '网店主图 / 详情页的试穿素材'],
  },
  /** 原型 views/tools/pages/AiPostureFission.vue（姿态复刻） */
  pose: {
    intro: '上传一张人物图，再放最多 9 张姿势参考图；身份、服装、场景、光线都锁在人物图上，只换动作与神态表情。',
    scenes: ['同一模特的一组姿态延展', '服装 / 配饰的多角度展示', '缺素材时的快速补拍替代'],
  },
  /** 原型 views/tools/pages/ImageGenerate.vue（图片生成） */
  imagegen: {
    intro: '输入提示词并按需上传参考图，自定义模型、清晰度、比例与出图数量，快速生成目标画面。',
    scenes: ['无素材时的概念图快速产出', '同一描述的多版本比稿', '参考图风格延展'],
  },
}
