// @unocss-include
/**
 * 编辑器共用的原子类组合，数值取自原型 src/styles/canvas-v31.css（画布 v3.1 皮肤）：
 * 卡片 r8 + 1px 描边 + 节点投影；头部 36px；控件 r4；图标钮 28px；说明字 ≥ 11px。
 * 本文件是 .ts，默认不在 UnoCSS 扫描范围内，靠首行 @unocss-include 纳入（不用变体分组写法）。
 * 项目没有 border-style 重置（base.css 只设 box-sizing），所以描边一律显式带 border-solid。
 */

/** 「+」快捷添加可选的下游节点种类 */
export type QuickAddKind = 'image-model' | 'video-model' | 'tool'

/** 键盘焦点环：只在键盘聚焦时出现 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-1'

/** 节点卡片（canvas-v31 §5：border 1px line / r8 / 白底 / --canvas-node-shadow） */
export const NODE_CARD =
  'group relative bg-white border border-solid border-line rounded-8px text-ink-2 text-12px shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_36px_rgba(16,24,40,0.13)]'

/** 选中态：藤紫描边 + 2px 柔光 */
export const NODE_CARD_SELECTED =
  '!border-violet !shadow-[0_0_0_2px_rgba(135,95,154,0.16),0_2px_4px_rgba(16,24,40,0.06),0_16px_36px_rgba(16,24,40,0.13)]'

/** 节点头：36px / gap 6 / 左右 10 / 底部细分隔 */
export const NODE_HEAD = 'flex h-36px items-center gap-6px px-10px border-b border-b-solid border-line-soft'

/** 节点标题：13px 600 ink */
export const NODE_TITLE =
  'min-w-0 overflow-hidden text-ink text-13px font-600 leading-18px text-ellipsis whitespace-nowrap'

/** 头部 28px 图标钮（设置 / 更多） */
export const NODE_ICON_BTN = `grid shrink-0 w-28px h-28px p-0 place-items-center border-none rounded-4px bg-transparent text-muted text-16px leading-none cursor-pointer hover:bg-surface2 hover:text-ink nodrag ${FOCUS_RING}`

/** 生成节点的执行钮：浅绿底 + 绿描边（canvas-v31 .wf-model-node__actions button.is-run） */
export const NODE_RUN_BTN = `grid shrink-0 w-28px h-28px p-0 place-items-center border border-solid border-success-line rounded-4px bg-success-soft text-success cursor-pointer hover:border-success disabled:opacity-50 disabled:cursor-not-allowed nodrag ${FOCUS_RING}`

/** 生成节点的徽标（超强模型等）：琥珀浅底 */
export const NODE_BADGE =
  'shrink-0 px-6px py-1px border border-solid border-warning-line rounded-3px bg-warning-soft text-warning text-11px font-600 leading-16px whitespace-nowrap'

/** 端口旁的序号 / 计数徽标（17px 圆，藤紫浅底） */
export const PORT_COUNT =
  'absolute z-2 grid w-17px h-17px place-items-center border border-solid border-violet-line rounded-full bg-violet-soft text-violet text-10px font-600 leading-none -translate-y-50% pointer-events-none'

/** 棋盘格底（模型结果区 / 空图片区） */
export const CHECKER_BG =
  '[background:repeating-conic-gradient(#eff1f3_0%,#eff1f3_25%,transparent_0%,transparent_50%)_0_0/16px_16px,#f3f4f5]'

/** 浮动工具条（左竖条 / 底横条） */
export const TOOLBAR =
  'absolute z-5 flex gap-2px p-6px border border-solid border-line rounded-8px bg-white/96 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_12px_rgba(31,35,41,0.06)]'

/** 工具条 28px 按钮；is-on / aria-disabled 态用属性选择器表达 */
export const TOOLBAR_BTN = `grid w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink [&.is-on]:border-violet-line [&.is-on]:bg-violet-soft [&.is-on]:text-violet-ink [&.is-on]:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1)] aria-disabled:opacity-30 aria-disabled:cursor-not-allowed aria-disabled:hover:border-transparent aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted ${FOCUS_RING}`

/** 顶栏普通按钮：30px / r4 / 细描边轻拟物 */
export const TOP_BTN = `inline-flex shrink-0 items-center h-30px gap-5px px-10px border border-solid border-line-strong rounded-4px bg-white text-ink-2 text-13px font-500 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(31,35,41,0.05)] hover:bg-surface2 hover:text-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${FOCUS_RING}`

/** 顶栏主按钮「执行模型」：藤紫渐变 + 深描边 */
export const TOP_BTN_PRIMARY = `inline-flex shrink-0 items-center h-30px gap-5px px-10px border border-solid border-violet-border rounded-4px bg-gradient-to-b from-violet-top to-violet-bottom text-white text-13px font-500 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] hover:from-violet hover:to-violet-deep active:from-violet-deep active:to-violet-press aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${FOCUS_RING}`
