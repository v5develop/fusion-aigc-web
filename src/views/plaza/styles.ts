// @unocss-include
/**
 * 广场筛选 chip（同资产库分类条）。
 * 本文件是 .ts，靠首行 @unocss-include 纳入 UnoCSS 扫描；变体分组写法在 .ts 里不生效，故逐条展开。
 */
export const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2'

export function chipClass(active: boolean, small = false) {
  return [
    'inline-flex items-center rounded-8px border border-solid font-500 cursor-pointer',
    small ? 'h-28px px-8px text-12px' : 'h-34px px-10px text-13px',
    active
      ? 'bg-violet-soft border-violet-line text-violet-ink'
      : 'bg-white border-line text-ink-2 hover:border-line-strong',
    FOCUS,
  ]
}
