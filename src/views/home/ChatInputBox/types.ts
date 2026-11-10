/** 上传文件项 */
export interface FileItem {
  url: string
  thumbnail?: string
  name?: string
}

/** 可编辑文本 */
export interface SlotText {
  type: 'text'
  value: string
}

/** 上传插槽默认数量上限 */
export const DEFAULT_UPLOAD_LIMIT = 5

/** 图片/视频上传 */
export interface SlotUpload {
  type: 'upload'
  /** 模板插槽唯一 key（来自详情接口），文件路由优先按 key 匹配；label 可能重复 */
  key?: string
  label: string
  value: FileItem[]
  limit?: number
  accept?: 'image' | 'video'
  /** 是否必填（来自模板详情 slot 定义），驱动提交校验 */
  required?: boolean
  /** 关联的电商场景 moduleCode，用于弹窗查模特库；无则走普通文件选择器 */
  moduleCode?: string
  /** 是否来自模特库（false = 本地上传），用于 buildTargetParams 区分参数 */
  fromLibrary?: boolean
}

/** 路由路径 → publicTemplate moduleCode 映射 */
export const ROUTE_TO_MODULE_CODE: Record<string, string> = {
  '/e-commerce/change-background': 'backgroundSwitching',
  '/e-commerce/clothing-try': 'aiClothExchange',
  '/e-commerce/product-kit': 'productSetImages',
  '/e-commerce/clothing-kit': 'wearingProductSetImages',
}

/** 下拉选项 */
export interface SlotOption {
  label: string
  value: string
  icon?: string // 图标图片 URL（出于 XSS 考虑不支持内联 SVG 字符串）
}

/** 下拉选择 */
export interface SlotSelect {
  type: 'select'
  /** 模板插槽唯一 key（来自详情接口） */
  key?: string
  label: string
  value: string
  options: SlotOption[]
  title?: string
  /** 是否必填（来自模板详情 slot 定义），驱动提交校验 */
  required?: boolean
}

export type PromptSlot = SlotText | SlotUpload | SlotSelect
