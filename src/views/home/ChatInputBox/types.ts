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

/** 图片/视频上传 */
export interface SlotUpload {
  type: 'upload'
  label: string
  value: FileItem[]
  limit?: number
  accept?: 'image' | 'video'
}

/** 下拉选项 */
export interface SlotOption {
  label: string
  value: string
  icon?: string   // SVG 图标字符串
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
