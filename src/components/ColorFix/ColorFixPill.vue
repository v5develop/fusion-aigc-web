<script setup lang="ts">
/**
 * 压在结果图上的毛玻璃胶囊「校色调整」（原型 .v3-cf-edit）：视觉 26 高 r13、白 84% + 模糊 8、影 0 2 8 .14，
 * violet-ink 11px；命中区 sx-hit 外扩 4px（34 高，触屏 38）。定位交给父级（class 透传，如 absolute top-10px right-10px）。
 * `variant="muted"` 是「下载校色前」那种次要胶囊（白 72%、ink-2 字）。
 */
const {
  label = '校色调整',
  pressed,
  icon = true,
  variant = 'primary',
} = defineProps<{
  label?: string
  /** aria-pressed（参数台开着） */
  pressed?: boolean
  /** 显示滑杆图标（下载类胶囊传 false） */
  icon?: boolean
  variant?: 'primary' | 'muted'
}>()
defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="sx-hit inline-flex items-center gap-4px h-26px box-border px-10px rounded-13px border border-solid border-white/60 backdrop-blur-[8px] text-11px font-500 leading-none whitespace-nowrap cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.14)] [transition:background_120ms] hover:bg-white motion-reduce:transition-none outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
    :class="variant === 'muted' ? 'bg-white/72 text-ink-2' : 'bg-white/84 text-violet-ink'"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    @click="$emit('click', $event)"
  >
    <svg
      v-if="icon"
      class="w-13px h-13px"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
    <slot>{{ label }}</slot>
  </button>
</template>
