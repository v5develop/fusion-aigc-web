/** 功能目录（AI 图片 / AI 视频二级目录、工具页目录共用）的数据形状 */
export interface DirectoryEntry {
  key: string
  name: string
  /** 24×24 描边 SVG 片段（innerHTML）；没有则展开态只留文字、收起态落首字 */
  icon?: string
  /** 有值才可点；没有且没有 hasChildren = 「即将开放」 */
  route?: string
  /** 带下一级目录：展开态行尾画箭头，条目可点 */
  hasChildren?: boolean
  /** 读屏标签覆盖（默认：即将开放的写「名称（即将开放）」，收起态写名称，展开态靠可见文字） */
  ariaLabel?: string
  /** 展开态悬停提示 */
  title?: string
}

export interface DirectoryGroup {
  key?: string
  label?: string
  entries: DirectoryEntry[]
}
