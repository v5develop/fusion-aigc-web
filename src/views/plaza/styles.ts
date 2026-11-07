// @unocss-include
/**
 * 广场筛选条（原型 5185 AgentView .ref-cats / .ref-subs / .ref-search，与智能体首页模板浏览同一套）。
 * 本文件是 .ts，靠首行 @unocss-include 纳入 UnoCSS 扫描；变体分组写法在 .ts 里不生效，故逐条展开。
 */
export const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2'

/** 一级分类胶囊：32 高 r16，软线底；选中 #dcc9e9 描边 + 白→淡紫渐变 + 藤紫 600 */
export function chipClass(active: boolean) {
  return [
    'flex-none inline-flex items-center h-32px px-15px rounded-16px border border-solid text-12px whitespace-nowrap cursor-pointer select-none',
    '[transition:border-color_0.12s,background_0.12s,color_0.12s] motion-reduce:transition-none',
    active
      ? 'border-#dcc9e9 bg-[linear-gradient(#fff,#faf4fd)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] font-600 text-violet-ink'
      : 'border-white/90 bg-[linear-gradient(rgba(255,255,255,0.82),rgba(246,246,247,0.64))] text-muted hover:border-#aeb4b9 hover:text-ink',
    FOCUS,
  ]
}

/** 二级细分：26 高 r13，常态无边框透明底；after 上下各外扩 3px，命中高度 32（不超过行间距 6 的一半） */
export function subChipClass(active: boolean) {
  return [
    'relative after:content-empty after:absolute after:inset-x-0 after:-inset-y-3px',
    'inline-flex items-center h-26px px-10px rounded-13px border border-solid text-12px whitespace-nowrap cursor-pointer select-none',
    '[transition:border-color_0.12s,background_0.12s,color_0.12s] motion-reduce:transition-none',
    active
      ? 'border-#e3d3ee bg-[linear-gradient(#fff,#fbf8fd)] font-600 text-violet-ink'
      : 'border-transparent bg-transparent text-muted hover:bg-[linear-gradient(#fff,#fbfcfd)] hover:text-ink',
    FOCUS,
  ]
}

/** 一级分类横排（溢出横滑、隐藏滚动条） */
export const CATS_ROW =
  'flex min-w-0 flex-1 gap-8px overflow-x-auto py-2px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

/** 搜索框 240×32 r16，右侧放大镜 */
export const SEARCH_INPUT =
  'box-border h-32px w-full rounded-16px border border-solid border-white/90 bg-[linear-gradient(rgba(255,255,255,0.82),rgba(246,246,247,0.64))] pl-14px pr-32px text-12px text-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)] outline-none placeholder:text-placeholder focus:border-violet focus:shadow-focus'
