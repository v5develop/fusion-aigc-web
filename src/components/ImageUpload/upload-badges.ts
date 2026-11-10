// @unocss-include
/**
 * 上传格角标（ImageUpload / VideoUpload 共用）。
 *
 * <p>口径对齐原型 xiaoqi-tools-5183：
 * - 圆钮材质 `.sx-medbtn`：20 圆、12 图标、1px #c9cfd6、白→#f7f8f9、内高光 + 短投影，点击区 ::after 外扩 4 到 28；
 *   hover 描边 violet、字 violet-ink；focus-visible 2px violet outline、偏移 2（styles/v3-theme.css:2150-2200）。
 * - 删除：右上角内缩 4，悬停才出现、键盘聚焦时也出现，0.16s 淡入（ProductPipeSlots.vue `.ptile__del`）。
 * - 资产添加：右下角内缩 4，常显（ProductPipeSlots.vue `.ptile__icon`）；上传入口上的云钮挂在右下角外沿 -12
 *   （BatchImageZone.vue:493 `.batch-add__cloud`）。
 * - 上传 / 替换：悬停时盖在图片正中（MlReferenceSlots.vue:1062-1082 `.ml-thumb__actions`）。
 * - 放大查看：原型是点图放大，没有角钮位置；这里放左上角内缩 4，与删除对称、不和其它钮相撞。
 *
 * <p>位置 / 显隐都可由调用方逐个覆盖。默认不开任何角标（空数组），组件外观与改动前完全一致。
 */

/** 内置的四种动作；调用方也可以传自定义 key，配 `onClick` 自己处理 */
export type UploadBadgeKey = 'replace' | 'delete' | 'preview' | 'fromAsset'

/** 角标位置：四个角 + 正中（「上传 / 替换」在原型里是盖在图上居中） */
export type UploadBadgePlacement = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'

/** 角标显隐：hover = 悬停 / 键盘聚焦时出现；always = 常显 */
export type UploadBadgeVisibility = 'hover' | 'always'

/** 一个角标的完整配置；只写 key 时其余取原型默认 */
export interface UploadBadgeAction {
  key: UploadBadgeKey | (string & {})
  /** 无障碍名称（aria-label）；内置动作默认用原型文案 */
  label?: string
  /** 悬停提示（title）；不传 = label */
  tooltip?: string
  /** 图标：内置四种之一，或一段 24×24 viewBox 的 SVG path（d 属性） */
  icon?: UploadBadgeKey | { path: string }
  placement?: UploadBadgePlacement
  /** 不传 = 内置默认（资产添加常显，其余跟组件的 badgeVisibility） */
  visibility?: UploadBadgeVisibility
  /** 挂在角外沿（-12，原型资产云钮的挂法）；默认内缩 4 */
  outside?: boolean
  /** 禁用；可按格子序号判断 */
  disabled?: boolean | ((index: number) => boolean)
  /** 自定义处理；传了就不走内置行为（badge-click 事件照常发出） */
  onClick?: (index: number) => void
}

/** 配置项：可以只写 key 字符串 */
export type UploadBadgeInput = UploadBadgeKey | UploadBadgeAction

/** 归一化后的角标（模板直接用） */
export interface ResolvedUploadBadge {
  key: string
  label: string
  tooltip: string
  path: string
  placement: UploadBadgePlacement
  visibility: UploadBadgeVisibility
  outside: boolean
  disabled: UploadBadgeAction['disabled']
  onClick?: (index: number) => void
}

/** 24×24 线性图标（stroke 1.8，与 StudioMedBtn 同一套画法） */
export const UPLOAD_BADGE_ICONS: Record<UploadBadgeKey, string> = {
  // 垃圾桶（同 studio 删除钮）
  delete: 'M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5',
  // 云 + 上箭头（原型 CloudUploadOutline）
  replace: 'M7 18.5h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.75 4.75 0 0 0 7 18.5zM12 16v-5.5M9.5 13l2.5-2.5 2.5 2.5',
  // 放大镜 + 加号
  preview: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.2 15.2 20 20M10.5 8v5M8 10.5h5',
  // 云（原型资产云钮 MediaCloudIcon / StudioImageUpload 云钮）
  fromAsset: 'M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 8.6 4.75 4.75 0 0 0 7 18z',
}

type BadgeDefaults = Pick<ResolvedUploadBadge, 'label' | 'placement' | 'outside'> & {
  tooltip?: string
  visibility?: UploadBadgeVisibility
}

/** 内置动作默认值；文案取原型（image / video 两套） */
export const UPLOAD_BADGE_DEFAULTS: Record<'image' | 'video', Record<UploadBadgeKey, BadgeDefaults>> = {
  image: {
    // SingleImageZone.vue:156 / BatchImageZone.vue:274
    delete: { label: '移除该图', placement: 'top-right', outside: false },
    // MlReferenceSlots.vue:389-390
    replace: { label: '上传 / 替换', placement: 'center', outside: false },
    // BatchImageZone.vue:240「放大查看 {name}」
    preview: { label: '放大查看', placement: 'top-left', outside: false },
    // ProductPipeSlots.vue:352 资产添加（替换素材）；常显
    fromAsset: {
      label: '资产添加（替换素材）',
      tooltip: '从资产库添加',
      placement: 'bottom-right',
      outside: false,
      visibility: 'always',
    },
  },
  video: {
    // SingleVideoZone.vue:153
    delete: { label: '移除该视频', placement: 'top-right', outside: false },
    replace: { label: '上传 / 替换', placement: 'center', outside: false },
    // SingleVideoZone.vue:129「预览 {name}」
    preview: { label: '预览', placement: 'top-left', outside: false },
    fromAsset: {
      label: '资产添加（替换素材）',
      tooltip: '从资产库添加',
      placement: 'bottom-right',
      outside: false,
      visibility: 'always',
    },
  },
}

/** 上传入口上的「从资产库选」云钮文案（BatchImageZone.vue:311-312） */
export const UPLOAD_ENTRY_ASSET_LABEL = {
  image: '从资产库添加图片',
  video: '从资产库添加视频',
  tooltip: '从资产库添加',
}

const isBuiltin = (key: string): key is UploadBadgeKey =>
  key === 'replace' || key === 'delete' || key === 'preview' || key === 'fromAsset'

/** 把调用方配置归一化为模板可直接渲染的角标列表 */
export function resolveUploadBadges(
  input: UploadBadgeInput[] | undefined,
  media: 'image' | 'video',
  visibility: UploadBadgeVisibility,
): ResolvedUploadBadge[] {
  if (!input?.length) return []
  return input.map((raw) => {
    const action: UploadBadgeAction = typeof raw === 'string' ? { key: raw } : raw
    const def = isBuiltin(action.key) ? UPLOAD_BADGE_DEFAULTS[media][action.key] : undefined
    const iconKey = action.icon ?? (isBuiltin(action.key) ? action.key : 'replace')
    const label = action.label ?? def?.label ?? action.key
    return {
      key: action.key,
      label,
      tooltip: action.tooltip ?? (action.label ? action.label : (def?.tooltip ?? label)),
      path: typeof iconKey === 'string' ? UPLOAD_BADGE_ICONS[iconKey] : iconKey.path,
      placement: action.placement ?? def?.placement ?? 'top-right',
      visibility: action.visibility ?? def?.visibility ?? visibility,
      outside: action.outside ?? def?.outside ?? false,
      disabled: action.disabled,
      onClick: action.onClick,
    }
  })
}

export const isBadgeDisabled = (badge: ResolvedUploadBadge, index: number) =>
  typeof badge.disabled === 'function' ? badge.disabled(index) : !!badge.disabled

/**
 * 原型 `.sx-medbtn` 材质（v3-theme.css:2156-2200）。
 * 位置 / 显隐由 badgeClass() 追加。本文件是 .ts，靠首行 @unocss-include 纳入扫描；.ts 里变体分组不生效，故逐条展开。
 */
export const MEDBTN =
  'absolute z-12 grid w-20px h-20px min-w-20px place-items-center p-0 leading-0 rounded-full cursor-pointer ' +
  'border border-solid border-control bg-gradient-to-b from-white to-surface2 text-ink-2 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),inset_0_0_0_1px_rgba(255,255,255,0.7),0_1px_3px_rgba(31,35,41,0.18)] ' +
  'hover:border-violet hover:text-violet-ink active:from-surface3 active:to-white active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)] ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-control disabled:hover:text-ink-2 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2 ' +
  "after:content-[''] after:absolute after:-inset-6px [@media(pointer:coarse)]:after:-inset-12px [&_svg]:block [&_svg]:w-12px [&_svg]:h-12px"

const PLACEMENT_INSIDE: Record<UploadBadgePlacement, string> = {
  'top-right': 'top-4px right-4px',
  'top-left': 'top-4px left-4px',
  'bottom-right': 'bottom-4px right-4px',
  'bottom-left': 'bottom-4px left-4px',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
}

const PLACEMENT_OUTSIDE: Record<UploadBadgePlacement, string> = {
  'top-right': '-top-12px -right-12px',
  'top-left': '-top-12px -left-12px',
  'bottom-right': '-bottom-12px -right-12px',
  'bottom-left': '-bottom-12px -left-12px',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
}

/**
 * hover 显隐：父元素需带 `group`。悬停或格子内有焦点时淡入（0.16s，ProductPipeSlots.vue `.ptile__del`），
 * 自身 focus-visible 时也出现，保证键盘可达；禁用且悬停型的直接隐藏（原型 `.ptile__del:disabled{opacity:0}`）。
 */
const HOVER_REVEAL =
  'opacity-0 pointer-events-none transition-opacity duration-160 ease-[ease] motion-reduce:transition-none ' +
  'group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ' +
  'focus-visible:opacity-100 focus-visible:pointer-events-auto [@media(hover:none)]:(opacity-100 pointer-events-auto)'

export function badgeClass(badge: ResolvedUploadBadge): string {
  const pos = (badge.outside ? PLACEMENT_OUTSIDE : PLACEMENT_INSIDE)[badge.placement]
  return `${MEDBTN} ${pos} ${badge.visibility === 'hover' ? HOVER_REVEAL : ''}`
}

/** "3 / 4"、"3/4"、"0.75" → 宽高比（宽 / 高）；无法解析时回退 1 */
export function parseAspectRatio(ratio: string | number | undefined): number {
  if (ratio === undefined) return 1
  if (typeof ratio === 'number') return ratio > 0 ? ratio : 1
  const [w, h] = ratio.split('/').map((s) => Number(s.trim()))
  const value = h === undefined ? w : (w ?? 0) / h
  return value && Number.isFinite(value) && value > 0 ? value : 1
}
