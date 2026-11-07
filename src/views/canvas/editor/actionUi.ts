// @unocss-include
/**
 * 图片动作面板共用的原子类组合（本文件是 .ts，靠首行 @unocss-include 纳入 UnoCSS 扫描）。
 * 设置类控件统一 44 高；焦点 = 藤紫描边 + 3px 浅藤紫外环（shadow-focus）；卡片 r8。
 */

/** 键盘焦点：3px 外环 + 藤紫描边（元素需自带 1px 描边，透明亦可） */
export const ACTION_RING = 'outline-none focus-visible:!border-violet focus-visible:shadow-focus'

/** 字段标签 */
export const ACTION_LABEL = 'block mb-6px text-ink-2 text-12px font-600'

/** 44 高输入 / 选择框 */
export const ACTION_FIELD = `h-44px px-11px border border-solid border-control rounded-6px bg-white text-ink text-13px shadow-inset-input hover:border-control-hover focus:border-violet focus:shadow-focus outline-none disabled:bg-surface3 disabled:text-placeholder`

/** 44 高主按钮（提交） */
export const ACTION_SUBMIT = 'sx-btn-primary w-full !h-44px'

/** 次按钮（重试 / 停止等待 / 复位） */
export const ACTION_BTN = 'sx-btn !h-32px'

/** 区域序号徽标（原型 .identify-box__badge / .identify-chip__badge：藤紫底白字 11px） */
export const REGION_BADGE =
  'inline-flex shrink-0 items-center justify-center min-w-16px h-16px px-4px rounded-8px bg-violet text-white text-11px leading-16px font-600'

/** 状态条：进行中 / 失败 / 成功 */
export const STATUS_INFO =
  'flex items-center gap-8px px-10px py-8px rounded-8px bg-violet-soft text-violet-ink text-12px'
export const STATUS_ERR =
  'flex flex-col gap-6px px-10px py-8px rounded-8px border border-solid border-[#e4b7b4] bg-[#fbeeed] text-danger text-12px'
export const STATUS_OK =
  'flex items-center gap-8px px-10px py-8px rounded-8px border border-solid border-[#bcd8c9] bg-[#eaf3ee] text-success text-12px'

/** 转圈（UnoCSS 内置 animate-spin，无需自定义关键帧） */
export const SPINNER =
  'inline-block shrink-0 w-14px h-14px border-2 border-solid border-violet-line border-t-violet rounded-full animate-spin'
