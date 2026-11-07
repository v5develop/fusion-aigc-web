<script setup lang="ts">
/**
 * 图标按钮（全站统一，2026-11-07 尺寸整改）。
 *
 * - 可点区域 ≥ 32×32，触屏 ≥ 44×44；视觉尺寸：sm 24（列表行内，命中区由伪元素补足）/ md 32 / lg 40。
 * - label 必填：同时作为 aria-label 与悬停提示（图标按钮没有可见文字，读屏和新用户都靠它）。
 * - href 有值时渲染成 <a>（下载用 download 属性），否则 <button type="button">。
 * - reveal：只在父级 .group 悬停时显示，但触屏与键盘聚焦时始终可见。
 *
 *   <IconButton label="下载" :href="url" download @click.stop><DownloadIcon /></IconButton>
 *   <IconButton label="删除" variant="danger" size="sm" @click="remove"><TrashIcon /></IconButton>
 */
import { computed } from 'vue'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'plate' | 'quiet' | 'overlay' | 'danger'

const props = withDefaults(
  defineProps<{
    label: string
    size?: Size
    variant?: Variant
    href?: string
    /** 下载文件名；只写属性（true）= 用地址里的文件名。Boolean 必须写在 String 前，否则裸属性会被转成 '' */
    download?: boolean | string
    target?: string
    disabled?: boolean
    loading?: boolean
    reveal?: boolean
    /** 选中 / 已收藏等「开」状态 */
    pressed?: boolean
    /** 不显示悬停提示（label 仍作为 aria-label） */
    noTitle?: boolean
  }>(),
  { size: 'md', variant: 'plate', href: undefined, download: undefined, target: undefined, disabled: false, loading: false, reveal: false, pressed: undefined, noTitle: false },
)
const emit = defineEmits<{ click: [e: MouseEvent] }>()

const SIZE: Record<Size, string> = { sm: 'sx-iconbtn-sm', md: '', lg: 'sx-iconbtn-lg' }
const VARIANT: Record<Variant, string> = { plate: '', quiet: 'sx-iconbtn-quiet', overlay: 'sx-iconbtn-overlay', danger: 'sx-iconbtn-danger' }
const ICON: Record<Size, string> = { sm: 'text-14px', md: 'text-16px', lg: 'text-18px' }

const cls = computed(() => [
  'sx-iconbtn',
  SIZE[props.size],
  VARIANT[props.variant],
  props.reveal && 'sx-reveal',
  props.pressed && '!text-violet-ink !border-violet-line !bg-none !bg-violet-soft',
  // 不用 pointer-events-none：禁用时仍要能悬停看到 title 里的原因，点击也不能穿透到下面的卡片
  (props.disabled || props.loading) && 'opacity-50 cursor-not-allowed',
])
const downloadAttr = computed(() => (props.download === true ? '' : props.download || undefined))

function onClick(e: MouseEvent) {
  if (props.disabled || props.loading) {
    // 禁用 / 加载中：既不触发自身，也不冒泡到外层可点的卡片
    e.preventDefault()
    e.stopPropagation()
    return
  }
  emit('click', e)
}
</script>

<template>
  <a
    v-if="href && !disabled"
    :href="href"
    :download="downloadAttr"
    :target="target"
    :rel="target === '_blank' ? 'noopener noreferrer' : undefined"
    :class="cls"
    :aria-label="label"
    :title="noTitle ? undefined : label"
    @click="onClick"
  >
    <span :class="ICON[size]" class="inline-flex leading-none [&>svg]:(w-1em h-1em)" aria-hidden="true"><slot /></span>
  </a>
  <button
    v-else
    type="button"
    :class="cls"
    :disabled="disabled || loading"
    :aria-label="label"
    :aria-pressed="pressed"
    :aria-busy="loading || undefined"
    :title="noTitle ? undefined : label"
    @click="onClick"
  >
    <span v-if="loading" :class="ICON[size]" class="inline-block w-1em h-1em rounded-full border-2 border-solid border-current border-r-transparent animate-spin" aria-hidden="true" />
    <span v-else :class="ICON[size]" class="inline-flex leading-none [&>svg]:(w-1em h-1em)" aria-hidden="true"><slot /></span>
  </button>
</template>
