/** 创作页共用控件（src/components/creation）的类型 */

export type CreationOptionValue = string | number

export interface CreationOption<V extends CreationOptionValue = CreationOptionValue> {
  label: string
  value: V
  disabled?: boolean
  /** 列表行右侧的能力标签（模型浮层「名称 + 标签」，11/16）；胶囊样式不显示 */
  description?: string
}

/** 图片设置行可出现的字段；没写进配置的字段不渲染 */
export type CreationSettingKey = 'resolution' | 'aspectRatio' | 'count'

export interface CreationSettingField {
  options: CreationOption[]
  /** 不写用默认标签：目标分辨率 / 画幅比例 / 生成张数 */
  label?: string
  /** 标签后加红色星号（只是展示，校验仍由页面负责） */
  required?: boolean
  /** 字段下方一行 11px 说明（目前只有张数行用，如「按模特算：每位模特各出这么多张」）；不传不显示 */
  hint?: string
}

export type CreationSettingsConfig = Partial<Record<CreationSettingKey, CreationSettingField>>

export type CreationSettingsValue = Partial<Record<CreationSettingKey, CreationOptionValue | undefined>>

/** 默认标签：取三处页面里的多数写法（工具页 / 视觉复刻工作流 / 文生图） */
export const CREATION_SETTING_LABELS: Record<CreationSettingKey, string> = {
  resolution: '目标分辨率',
  aspectRatio: '画幅比例',
  count: '生成张数',
}

/** 底部设置行按钮的图标：sparkle = 模型，gear = 图片 / 视频设置 */
export type CreationSettingsIcon = 'sparkle' | 'gear'

/** 底部设置行的一项：一个带图标、标签、取值摘要的按钮，点开弹层；弹层内容由同名插槽（#key）提供 */
export interface CreationSettingsRowItem {
  /** 插槽名，也是弹层 id 的一部分 */
  key: string
  icon: CreationSettingsIcon
  /** 按钮里的灰色标签，也是弹层标题，如「模型」「图片设置」 */
  label: string
  /** 按钮右侧的取值摘要，如「通用」「3:4 · 1K · 1 张」 */
  value: string
  /** 无障碍名称里的标签（如「生成模型」）；不传用 label */
  ariaLabel?: string
  /** 弹层固定宽（px）：设置后弹层右缘与按钮右缘对齐、向左展开，不再随按钮 / 整行宽 */
  popoverFixedWidth?: number
}

/** 设置摘要：按原型「比例 · 分辨率 · N 张」拼接，只拼配置里有、且有值的字段 */
export function creationSettingsSummary(fields: CreationSettingsConfig, value: CreationSettingsValue): string {
  const order: CreationSettingKey[] = ['aspectRatio', 'resolution', 'count']
  return order
    .flatMap((key) => {
      const field = fields[key]
      const v = value[key]
      if (!field || v === undefined) return []
      const opt = field.options.find((o) => o.value === v)
      if (!opt && v === '') return []
      const text = opt?.label ?? String(v)
      return [key === 'count' ? `${text} 张` : text]
    })
    .join(' · ')
}

/** 字符串选项转成 { label, value }（工具 / 工作流 schema 的 options 是字符串数组） */
export const toCreationOptions = (values: readonly CreationOptionValue[]): CreationOption[] =>
  values.map((v) => ({ label: String(v), value: v }))
