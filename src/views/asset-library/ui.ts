// @unocss-include —— 本文件只放类名字符串，默认扫描不含 .ts，靠这行让 UnoCSS 生成这些原子类
/**
 * 资产页共用的原子类组合（原型 5185 AssetsView：relay-sourcebar / relay-source-tab / relay-btn）。
 * 尺寸按 2026-11-07 整改口径放大：可点文字 ≥12px、可点高 ≥30px（原型 26 高 11px 太小）。
 */

/** 第二行筛选条：44 高、白底、下细线 */
export const ROW_CLS =
  'flex items-center gap-10px shrink-0 min-h-44px px-20px py-6px bg-white border-b border-b-solid border-line-soft max-md:flex-wrap'

/** 行首说明字（纯说明，11px 可以） */
export const ROW_LABEL_CLS = 'shrink-0 text-11px text-placeholder whitespace-nowrap'

/** 胶囊筛选项（来源 / 官方分类 / 标签带）：选中 = 内凹 + 藤紫字 */
export const PILL_CLS =
  'sx-squircle inline-flex items-center gap-5px shrink-0 h-30px px-10px rounded-15px border border-solid text-12px font-500 leading-none whitespace-nowrap cursor-pointer select-none ' +
  'transition-[border-color,background,color,box-shadow] duration-fast sx-focus'
export const PILL_OFF =
  'border-line text-ink-2 bg-gradient-to-b from-white to-surface3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] hover:border-line-strong'
export const PILL_ON =
  'border-line text-violet-ink bg-gradient-to-b from-white to-plate-bottom shadow-[inset_0_2px_5px_rgba(31,35,41,0.10),inset_0_-1px_0_rgba(255,255,255,0.9)]'

/** 胶囊里的计数 */
export const PILL_COUNT_CLS = 'text-11px leading-none tabular-nums opacity-70'

/** 工具钮（选择 / 筛选 / 标签管理）：32 高、胶囊 */
export const TOOL_CLS =
  'sx-squircle inline-flex items-center gap-6px shrink-0 h-32px px-12px rounded-16px border border-solid border-control bg-gradient-to-b from-white to-soft-bottom ' +
  'shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(31,35,41,0.05)] text-12px font-500 text-ink-2 whitespace-nowrap cursor-pointer select-none ' +
  'hover:(border-violet-line text-violet-ink bg-white) active:shadow-press disabled:(opacity-50 cursor-not-allowed) sx-focus'
export const TOOL_ON = '!border-violet-line !text-violet-ink !bg-violet-soft !bg-none'

/** 搜索框（原型 relay-search：中性描边 + 内阴影，聚焦只加深内阴影） */
export const SEARCH_CLS =
  'sx-squircle flex items-center gap-6px shrink-0 w-190px h-32px ml-auto px-12px rounded-16px border border-solid border-control bg-gradient-to-b from-white to-soft-bottom text-placeholder ' +
  'focus-within:(border-soft-line-focus shadow-[inset_0_2px_6px_rgba(31,35,41,0.13)]) max-md:w-150px'

/** 下载文件名：标题去掉文件系统不认的字符 */
export function downloadName(title: string, isVideo: boolean): string {
  const base = (title || '资产').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)
  return `${base}.${isVideo ? 'mp4' : 'jpg'}`
}

/** 复制文本到剪贴板（失败给出可操作的提示） */
export async function copyText(text: string, message: { success: (s: string) => void; warning: (s: string) => void }) {
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    message.warning('浏览器不允许复制，请手动选中文本复制')
  }
}
