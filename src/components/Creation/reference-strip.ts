/**
 * 提示词一体框里的参考图条（计数行 + 书本钮 + 叠片 + 云钮 + 摊开 / 替换 / 删除 / 「+ 点击添加」）的共用契约。
 *
 * 两个长相各一个组件，props / 事件完全相同，调用处换组件名即可互换（设计期在代码里选，不做运行时开关）：
 * - `ReferenceStrip.vue`：5185 原型 MlReferenceSlots / MlReferenceHead 的样子（视频生成先用）；
 * - `ReferenceStripClassic.vue`：原来的样子（StudioImageUpload 叠片 + 旁边「从资产库添加」文字钮），其余工具页沿用。
 *
 * 组件只管长相与交互；选文件、校验、上传、资产库弹窗都由调用方（如工具页 ToolUploadSlot）按事件处理。
 */
export interface ReferenceStripProps {
  /** 已有图片地址（按顺序，新的在最后） */
  urls: string[]
  /** 当前上限（随模型变化时由调用方传当前值） */
  max: number
  /** 图片名（读屏 / 提示里用），如「参考图」 */
  label?: string
  disabled?: boolean
  /** 正在上传（调用方的上传态） */
  uploading?: boolean
  /** 画计数行（左计数、右书本钮）；不画时由外层自己写计数 */
  head?: boolean
  /** 计数行文案；不传 = `已选/上限`（不带空格，如 0/30） */
  headText?: string
  /** 计数的悬停提示（如「当前模型最多 30 张参考图、1 段参考视频」） */
  headTitle?: string
  /** 计数行右侧画「我的提示词」书本钮（点了发 open-library） */
  library?: boolean
  /** 提示词库浮层是否开着（书本钮的 aria-expanded） */
  libraryOpen?: boolean
  /** 显示云钮 / 资产添加（点了发 asset） */
  asset?: boolean
  /** 拖入 / 粘贴进叠片的文件交给调用方（不传则发 pick） */
  onDropFiles?: (files: File[]) => void
}

export interface ReferenceStripEmits {
  /** 点空片 / 叠片 / 「点击添加」：调用方打开文件选择 */
  pick: []
  /** 替换第 index 张 */
  replace: [index: number]
  /** 删除第 index 张 */
  remove: [index: number]
  /** 清空整组 */
  clear: []
  /** 从资产库添加 */
  asset: []
  /** 书本钮：anchor 是按钮本身（浮层吸附它） */
  'open-library': [anchor: HTMLElement]
}
