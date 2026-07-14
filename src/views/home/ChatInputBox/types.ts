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
}

/** 下拉选项 */
export interface SlotOption {
  label: string
  value: string
  icon?: string   // 图标图片 URL（出于 XSS 考虑不支持内联 SVG 字符串）
}

/** 下拉选择 */
export interface SlotSelect {
  type: 'select'
  label: string
  value: string
  options: SlotOption[]
  title?: string
}

export type PromptSlot = SlotText | SlotUpload | SlotSelect
