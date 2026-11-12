// @unocss-include
import type { InjectionKey } from 'vue'
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
export const POP_SURFACE = `border border-solid border-line rounded-8px bg-overlay shadow-[0_12px_28px_rgba(58,38,72,0.14),0_2px_6px_rgba(31,35,41,0.06)] ${POP_FADE}`

/** 节点卡片（canvas-v31 §5：border 1px line / r8 / 白底 / --canvas-node-shadow）；悬停描边转浅藤紫 */
export const NODE_CARD =
  'group relative bg-surface border border-solid border-line rounded-10px text-ink-2 text-12px shadow-node transition-[border-color,box-shadow] duration-120 hover:border-violet-line'

/** 选中态（方案 A）：藤紫描边 + 2px 环（透明度 0.38）+ 短影，不再抬 36px */
export const NODE_CARD_SELECTED =
  '!border-violet !shadow-[0_0_0_2px_rgb(var(--xq-violet-rgb)/0.38),0_2px_6px_rgba(16,24,40,0.08)]'

/**
 * 节点右下角缩放把手（原型 .wf-node-resize v3.1：18px 命中区、9px 直角线、nwse 光标；悬停 / 选中才出现）。
 * 线色用藤紫描边色，悬停加深到主色。
 */
export const NODE_RESIZE_GRIP =
  'absolute right-0 bottom-0 z-3 block w-14px h-14px cursor-nwse-resize touch-none nodrag nopan before:content-empty before:absolute before:right-3px before:bottom-3px before:w-8px before:h-8px before:border-r-2 before:border-b-2 before:border-r-solid before:border-b-solid before:border-[#b9a0c7] before:rounded-br-4px before:opacity-0 before:transition-opacity before:duration-120 group-hover:before:opacity-100 [.is-selected_&]:before:opacity-100 hover:before:!border-violet [[data-theme=dark]_&]:before:border-[#8a7596]'

/** 右 / 下边缘缩放条：8px 命中区（一半压在卡片外），悬停显示 2px 主色线；角落 14px 留给 GRIP */
export const NODE_RESIZE_EDGE_X =
  'absolute -right-4px top-0 bottom-14px z-2 w-8px cursor-ew-resize touch-none nodrag nopan after:content-empty after:absolute after:right-3px after:top-8px after:bottom-0 after:w-2px after:rounded-full after:bg-violet after:opacity-0 after:transition-opacity after:duration-120 hover:after:opacity-60'
export const NODE_RESIZE_EDGE_Y =
  'absolute -bottom-4px left-0 right-14px z-2 h-8px cursor-ns-resize touch-none nodrag nopan after:content-empty after:absolute after:bottom-3px after:left-8px after:right-0 after:h-2px after:rounded-full after:bg-violet after:opacity-0 after:transition-opacity after:duration-120 hover:after:opacity-60'

/** 节点头高度（方案 A：44）；卡内内容区高度 = 外框高 − NODE_HEAD_H − 内边距，各节点共用此常量 */
export const NODE_HEAD_H = 44

/** 节点头（方案 A）：44px / gap 6 / 左右 12 / 底部细分隔 */
export const NODE_HEAD = 'flex h-44px items-center gap-6px px-12px border-b border-b-solid border-line-soft'

/** 视频 / 工具节点头：方案 A 同样 44px / 左右 12（gap 8 / 无分隔线） */
export const NODE_HEAD_PLAIN = 'flex h-44px items-center gap-8px px-12px'

/** 节点标题：14px 600 ink */
export const NODE_TITLE =
  'min-w-0 overflow-hidden text-ink text-14px font-600 leading-20px text-ellipsis whitespace-nowrap'

/** 头部 28px 图标钮（设置 / 更多）；::after 外扩 3px 命中区（原型 .wf-node-more::after） */
export const NODE_ICON_BTN = `relative grid shrink-0 w-28px h-28px p-0 place-items-center border-none rounded-4px bg-transparent text-muted text-16px leading-none cursor-pointer hover:bg-surface2 hover:text-ink after:content-empty after:absolute after:-inset-3px nodrag ${FOCUS_RING}`

/**
 * 画布语义色（canvas-v31 --canvas-green / red / amber 及其浅底、描边）：比全局 success / danger / warning
 * 的浅底与描边略深，画布内一律用这一组字面值。
 */
export const CANVAS_OK = 'border-success-line bg-success-soft text-success'
export const CANVAS_ERR = 'border-danger-line bg-danger-soft text-danger'

/** 生成节点的执行钮：浅绿底 + 绿描边（canvas-v31 .wf-model-node__actions button.is-run，hover 见 .wf-console__run） */
export const NODE_RUN_BTN = `relative grid shrink-0 w-28px h-28px after:content-empty after:absolute after:-inset-3px p-0 place-items-center border border-solid ${CANVAS_OK} rounded-4px cursor-pointer hover:border-success hover:bg-success-soft disabled:opacity-50 disabled:cursor-not-allowed nodrag ${FOCUS_RING}`

/** 生成节点的徽标（超强模型等）：琥珀浅底（.wf-model-node__badge） */
export const NODE_BADGE =
  'shrink-0 px-6px py-1px border border-solid border-warning-line rounded-3px bg-warning-soft text-warning text-11px font-600 leading-16px whitespace-nowrap'

/** 端口旁的序号 / 计数徽标（17px 圆，藤紫浅底；原型 .wf-model-node__ref-count / __out-index） */
export const PORT_COUNT =
  'absolute z-2 grid w-17px h-17px place-items-center border border-solid border-violet-line rounded-full bg-violet-soft text-violet text-10px font-600 leading-none -translate-y-50% pointer-events-none'

/** 视频生成节点的输出序号：红系（.wf-model-node.is-video .wf-model-node__out-index） */
export const PORT_COUNT_VIDEO = '!border-danger-line !bg-danger-soft !text-danger'

/** 棋盘格底（模型结果区 / 空图片区；.wf-model-node__checker：#e9ecef 方格 + surface-3） */
export const CHECKER_BG =
  '[background:repeating-conic-gradient(var(--xq-checker-b)_0%,var(--xq-checker-b)_25%,transparent_0%,transparent_50%)_0_0/16px_16px,var(--xq-surface3)]'

/** 运行中 / 失败 / 部分成功提示条的公共骨架（.wf-model-node__running / __error：居中、r4、11px） */
export const NODE_NOTICE = 'flex items-center justify-center gap-6px mt-6px px-8px py-5px rounded-4px text-11px'

/** 浮动工具条（左竖条 / 底横条）：浮层 r18；按钮用 IconButton quiet（32px）。触屏上按钮命中区外扩 4px，间距放到 8px 免得互相覆盖；桌面外观不变 */
export const TOOLBAR =
  'sx-squircle absolute z-5 flex gap-2px [@media(pointer:coarse)]:gap-8px p-6px border border-solid border-line rounded-18px bg-white/96 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_12px_rgba(31,35,41,0.06)]'

/**
 * 顶栏普通按钮（5185 .wf-top-btn 新版）：32px / r14 squircle / 0.8px #d9d9d9 描边 / 白→#f8f9fa 板材 + 内高光 + 短投影。
 * 32px 即命中区下限，不再另补伪元素。
 */
export const TOP_BTN = `sx-squircle inline-flex shrink-0 items-center h-32px gap-5px px-12px border-[0.8px] border-solid border-line-strong rounded-14px bg-gradient-to-b from-surface to-soft-bottom text-ink-2 text-13px font-500 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(31,35,41,0.05)] hover:border-control hover:from-surface2 hover:to-surface3 hover:text-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${FOCUS_RING}`

/** 顶栏主按钮「执行模型」：藤紫渐变 #7b5591→#6a487b + 0 4px 12px 紫调投影；hover 提亮、按下内凹 */
export const TOP_BTN_PRIMARY = `sx-squircle inline-flex shrink-0 items-center h-32px gap-5px px-14px border-[0.8px] border-solid border-violet-border rounded-14px bg-gradient-to-b from-[#7b5591] to-[#6a487b] text-white text-13px font-500 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_12px_rgba(106,72,123,0.24)] hover:from-[#86609c] hover:to-[#74508a] active:from-[#6b487c] active:to-violet-press active:shadow-[inset_0_1px_3px_rgba(31,35,41,0.24)] aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${FOCUS_RING}`

/** 多选操作条按钮（原型 v3.1 .wf-selection-bar button：28px / r4 / 13px）；悬停走藤紫浅底 */
export const SELECTION_BTN = `inline-flex items-center h-28px gap-4px px-8px border border-solid border-transparent rounded-4px bg-transparent text-ink-2 text-13px cursor-pointer hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink ${FOCUS_RING}`

/**
 * 节点菜单（「…」与右键共用一份定义）：画布页 provide 打开函数，NodeMenu 注入后把菜单开在「…」下方。
 * 没注入到（节点组件被单独使用）时 NodeMenu 退回自带的下拉菜单。
 */
export interface INodeMenuHost {
  /** trigger：「…」按钮本身，菜单关闭时把焦点还给它 */
  open: (nodeId: string, anchor: DOMRect, trigger?: HTMLElement) => void
}
export const NODE_MENU_HOST: InjectionKey<INodeMenuHost> = Symbol('canvas-node-menu-host')

/**
 * 节点卡右上角悬停「×」删除钮（原型 .wf-node-delete）：卡外上沿 22px 圆钮，悬停 / 选中才出现；
 * ::after 往下外扩 8px 把钮和卡之间的空隙接上，鼠标从卡移到钮不会丢失悬停。
 */
export const NODE_DELETE_BTN = `absolute -top-26px right-0 z-4 grid w-22px h-22px p-0 place-items-center border border-solid border-line rounded-full bg-surface text-muted text-13px leading-none cursor-pointer opacity-0 shadow-[0_4px_12px_rgba(30,41,59,0.1)] transition-opacity duration-120 motion-reduce:transition-none after:content-empty after:absolute after:-inset-x-3px after:-top-3px after:-bottom-8px group-hover:opacity-100 [.is-selected_&]:opacity-100 hover:!border-danger-line hover:!bg-danger-soft hover:!text-danger focus-visible:opacity-100 nodrag nopan ${FOCUS_RING}`
