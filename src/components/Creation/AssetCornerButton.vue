<script setup lang="ts">
/**
 * 「从资产库添加」角钮（5185 原型 `.ml-role__asset` / `.sx-medbtn` 云钮）——全站唯一一份。
 *
 * <p>视觉 20 圆：1px #c9cfd6、白→#f7f8f9、内高光 + 内白圈 + 0 1px 3px .18；图标 ionicons CloudOutline 12（光学上移 0.5）；
 * 悬停藤紫描边 + 藤紫字；命中区 ::after 外扩到 32（触屏 40）。
 *
 * <p>`corner`（默认）：挂在宿主（须 relative）右下角外沿 -12/-12；传 `corner=false` 时只给 absolute，位置由调用方 class / style 定
 * （如「+ 点击添加」格内右下 4/4、叠片右沿随张数走的 left）。label 默认「从资产库添加」，同时作读屏名与悬停提示。
 */
const {
  label = '从资产库添加',
  disabled = false,
  corner = true,
} = defineProps<{
  label?: string
  disabled?: boolean
  /** true：宿主右下角外沿 -12/-12；false：位置交给调用方 */
  corner?: boolean
}>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="absolute z-12 grid w-20px h-20px min-w-20px place-items-center p-0 leading-0 border border-solid border-control rounded-full bg-gradient-to-b from-white to-surface2 text-ink-2 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),inset_0_0_0_1px_rgba(255,255,255,0.7),0_1px_3px_rgba(31,35,41,0.18)] [&:not(:disabled):hover]:(border-violet text-violet-ink) [&:not(:disabled):active]:(from-surface3 to-surface shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)]) focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-45 cursor-not-allowed) after:(content-empty absolute -inset-6px rounded-full) [@media(pointer:coarse)]:after:-inset-10px"
    :class="corner ? '-right-12px -bottom-12px' : ''"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    @click.stop="emit('click', $event)"
  >
    <svg
      class="block w-12px h-12px -translate-y-0.5px"
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      stroke-width="32"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M400 240c-8.89-89.54-71-144-144-144-69 0-113.44 48.2-128 96-60 6-112 43.59-112 112 0 66 54 112 120 112h260c55 0 100-27.44 100-88 0-59.82-53-85.76-96-88z"
      />
    </svg>
  </button>
</template>
