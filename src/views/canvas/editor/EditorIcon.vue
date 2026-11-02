<script setup lang="ts">
/** 编辑器内联 SVG 图标（项目无 iconfont / vicons，线性 24×24 stroke 风格） */
const props = defineProps<{ name: string; size?: number }>()

const PATHS: Record<string, string> = {
  text: 'M5 6h14M5 12h9M5 18h12',
  image: 'M4 5.5h16v13H4zM8.2 10a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM4.8 16.5l4.4-4.2 3.2 3 3-2.8 3.8 3.6',
  video: 'M4 6h11v12H4zM15 10.5l5-3v9l-5-3z',
  model: 'M12 3.5l1.7 4.4 4.4 1.7-4.4 1.7L12 15.7l-1.7-4.4-4.4-1.7 4.4-1.7zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  tool: 'M5 7h14M5 12h14M5 17h14M9 5v4M15 10v4M7 15v4',
  play: 'M9 6.5v11l8.5-5.5z',
  stop: 'M8 8h8v8H8z',
  plus: 'M12 5.5v13M5.5 12h13',
  back: 'M14.5 18l-6-6 6-6',
  check: 'M5 13l4.2 4L19 7.5',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  fit: 'M4 9V4.5h5M20 9V4.5h-5M4 15v4.5h5M20 15v4.5h-5',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l4.5 4.5M8.2 11h5.6M11 8.2v5.6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l4.5 4.5M8.2 11h5.6',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  refresh: 'M19 12a7 7 0 1 1-2.1-5L19 9.2M19 4.5v4.7h-4.7',
}

const d = () => PATHS[props.name] ?? ''
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="d()" />
  </svg>
</template>
