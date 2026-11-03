/** 固定模特（选择器交回页面的对象）：公共模板与我的模特统一成一种形状 */
export interface FixedModel {
  /** t-{modelTemplateId} / u-{userModelId} */
  id: string
  name: string
  /** 卡片副标题：模板取所在标签组，我的模特取描述 */
  tag: string
  image: string
  source: 'preset' | 'custom'
  userModelId?: number
  description?: string
}
