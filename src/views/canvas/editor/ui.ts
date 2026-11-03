// @unocss-include
/**
 * 编辑器共用的原子类组合，数值取自原型 src/styles/canvas-v31.css（画布 v3.1 皮肤）：
 * 卡片 r8 + 1px 描边 + 节点投影；头部 36px；控件 r4；图标钮 28px；说明字 ≥ 11px。
 * 本文件是 .ts，默认不在 UnoCSS 扫描范围内，靠首行 @unocss-include 纳入（不用变体分组写法）。
 * 项目没有 border-style 重置（base.css 只设 box-sizing），所以描边一律显式带 border-solid。
 */

/** 「+」快捷添加可选的下游节点种类 */
export type QuickAddKind = 'image-model' | 'video-model' | 'tool'

/** 添加面板可新建的节点种类（与 store.addNode 的 kind 一致） */
export type AddPanelKind = 'text' | 'image' | 'video' | 'image-model' | 'video-model' | 'tool'

/** 端口「+」打开添加面板的请求：可选的下游种类 + 「+」钮在视口里的位置（面板与新节点都落在这里） */
export interface IQuickAddRequest {
  kinds: QuickAddKind[]
  clientX: number
  clientY: number
}

/** 键盘焦点环：只在键盘聚焦时出现 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2'

/**
 * 浮层淡入（原型 canvas-v31 §9：canvas-v31-fade 140ms ease-out，2px 下落）。
 * 关键帧 canvas-editor-fade 定义在 editor/index.vue 的非 scoped 样式块里（UnoCSS 表达不了 @keyframes）；
 * 关键帧用独立的 translate 属性，不覆盖元素自身的 -translate-x-50% 等定位变换。
 */
export const POP_FADE = 'animate-[canvas-editor-fade_140ms_ease-out] motion-reduce:animate-none'

/** 浮层面板外壳（控制台 / 添加面板 / 操作条）：line 描边 / r8 / 白底 / 藤紫调浮层投影 */
export const POP_SURFACE = `border border-solid border-line rounded-8px bg-white shadow-[0_12px_28px_rgba(58,38,72,0.14),0_2px_6px_rgba(31,35,41,0.06)] ${POP_FADE}`

/** 节点卡片（canvas-v31 §5：border 1px line / r8 / 白底 / --canvas-node-shadow）；悬停描边转浅藤紫 */
export const NODE_CARD =
  'group relative bg-white border border-solid border-line rounded-8px text-ink-2 text-12px shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_36px_rgba(16,24,40,0.13)] transition-[border-color,box-shadow] duration-120 hover:border-violet-line'

/** 选中态：藤紫描边 + 3px 浅藤紫环 + 带紫调的落影（与选框 / 浮层同一色族，不用原型的蓝） */
export const NODE_CARD_SELECTED =
  '!border-violet !shadow-[0_0_0_3px_rgba(135,95,154,0.15),0_2px_4px_rgba(58,38,72,0.07),0_16px_36px_rgba(58,38,72,0.15)]'

/**
 * 节点右下角缩放把手（原型 .wf-node-resize v3.1：18px 命中区、9px 直角线、nwse 光标；悬停 / 选中才出现）。
 * 线色用藤紫描边色，悬停加深到主色。
 */
export const NODE_RESIZE_GRIP =
  'absolute right-3px bottom-3px z-3 block w-18px h-18px cursor-nwse-resize opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 before:content-empty before:absolute before:right-0 before:bottom-0 before:w-9px before:h-9px before:border-r before:border-b before:border-r-solid before:border-b-solid before:border-[#b9a0c7] before:rounded-br-4px hover:before:border-violet nodrag'

/** 节点头：36px / gap 6 / 左右 10 / 底部细分隔（canvas-v31 只给文字 / 图片 / 模型节点） */
export const NODE_HEAD = 'flex h-36px items-center gap-6px px-10px border-b border-b-solid border-line-soft'

/** 视频 / 工具节点头：v3.1 皮肤没覆盖，沿用原型组件自身样式（36px / gap 8 / 左右 12 / 无分隔线） */
export const NODE_HEAD_PLAIN = 'flex h-36px items-center gap-8px px-12px'

/** 节点标题：13px 600 ink */
export const NODE_TITLE =
  'min-w-0 overflow-hidden text-ink text-13px font-600 leading-18px text-ellipsis whitespace-nowrap'

/** 头部 28px 图标钮（设置 / 更多）；::after 外扩 3px 命中区（原型 .wf-node-more::after） */
export const NODE_ICON_BTN = `relative grid shrink-0 w-28px h-28px p-0 place-items-center border-none rounded-4px bg-transparent text-muted text-16px leading-none cursor-pointer hover:bg-surface2 hover:text-ink after:content-empty after:absolute after:-inset-3px nodrag ${FOCUS_RING}`

/**
 * 画布语义色（canvas-v31 --canvas-green / red / amber 及其浅底、描边）：比全局 success / danger / warning
 * 的浅底与描边略深，画布内一律用这一组字面值。
 */
export const CANVAS_OK = 'border-[#bcd8c9] bg-[#eaf3ee] text-success'
export const CANVAS_ERR = 'border-[#e4b7b4] bg-[#fbeeed] text-danger'

/** 生成节点的执行钮：浅绿底 + 绿描边（canvas-v31 .wf-model-node__actions button.is-run，hover 见 .wf-console__run） */
export const NODE_RUN_BTN = `grid shrink-0 w-28px h-28px p-0 place-items-center border border-solid ${CANVAS_OK} rounded-4px cursor-pointer hover:border-[#a4c9b6] hover:bg-[#e0eee6] disabled:opacity-50 disabled:cursor-not-allowed nodrag ${FOCUS_RING}`

/** 生成节点的徽标（超强模型等）：琥珀浅底（.wf-model-node__badge） */
export const NODE_BADGE =
  'shrink-0 px-6px py-1px border border-solid border-[#e5cfa9] rounded-3px bg-[#f8f1e4] text-warning text-11px font-600 leading-16px whitespace-nowrap'

/** 端口旁的序号 / 计数徽标（17px 圆，藤紫浅底；原型 .wf-model-node__ref-count / __out-index） */
export const PORT_COUNT =
  'absolute z-2 grid w-17px h-17px place-items-center border border-solid border-violet-line rounded-full bg-violet-soft text-violet text-10px font-600 leading-none -translate-y-50% pointer-events-none'

/** 视频生成节点的输出序号：红系（.wf-model-node.is-video .wf-model-node__out-index） */
export const PORT_COUNT_VIDEO = '!border-[#e4b7b4] !bg-[#fdf3f2] !text-[#b13a36]'

/** 棋盘格底（模型结果区 / 空图片区；.wf-model-node__checker：#e9ecef 方格 + surface-3） */
export const CHECKER_BG =
  '[background:repeating-conic-gradient(#e9ecef_0%,#e9ecef_25%,transparent_0%,transparent_50%)_0_0/16px_16px,#f3f4f5]'

/** 运行中 / 失败 / 部分成功提示条的公共骨架（.wf-model-node__running / __error：居中、r4、11px） */
export const NODE_NOTICE = 'flex items-center justify-center gap-6px mt-6px px-8px py-5px rounded-4px text-11px'

/** 浮动工具条（左竖条 / 底横条） */
export const TOOLBAR =
  'absolute z-5 flex gap-2px p-6px border border-solid border-line rounded-8px bg-white/96 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_12px_rgba(31,35,41,0.06)]'

/** 工具条 28px 按钮；is-on / aria-disabled 态用属性选择器表达 */
export const TOOLBAR_BTN = `grid w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink [&.is-on]:border-violet-line [&.is-on]:bg-violet-soft [&.is-on]:text-violet-ink [&.is-on]:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1),inset_0_0_0_1px_rgba(31,35,41,0.03)] aria-disabled:opacity-30 aria-disabled:cursor-not-allowed aria-disabled:hover:border-transparent aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted ${FOCUS_RING}`

/** 顶栏普通按钮（.wf-top-btn）：30px / r4 / 控件描边 #c9cfd6 / 白渐变板材 + 内高光内底线 + 短投影 */
export const TOP_BTN = `inline-flex shrink-0 items-center h-30px gap-5px px-10px border border-solid border-control rounded-4px bg-gradient-to-b from-white to-#fbfcfc text-ink-2 text-13px font-500 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] hover:border-control-hover hover:from-surface2 hover:to-surface2 hover:text-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${FOCUS_RING}`

/** 顶栏主按钮「执行模型」（.wf-top-btn.is-primary）：藤紫渐变 + 深描边；hover #926ba6→#835a96；按下 #6b487c→#5f3f6f 内凹 */
export const TOP_BTN_PRIMARY = `inline-flex shrink-0 items-center h-30px gap-5px px-10px border border-solid border-violet-border rounded-4px bg-gradient-to-b from-violet-top to-violet-bottom text-white text-13px font-500 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] hover:from-#926ba6 hover:to-#835a96 active:border-violet-press active:from-violet-deep active:to-violet-press active:shadow-[inset_0_1px_3px_rgba(31,35,41,0.24)] aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${FOCUS_RING}`

/** 多选操作条按钮（原型 v3.1 .wf-selection-bar button：28px / r4 / 13px）；悬停走藤紫浅底 */
export const SELECTION_BTN = `inline-flex items-center h-28px gap-4px px-8px border border-solid border-transparent rounded-4px bg-transparent text-ink-2 text-13px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink ${FOCUS_RING}`
