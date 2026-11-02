<script setup lang="ts">
/** 编辑器内联 SVG 图标（项目无 iconfont / vicons，线性 24×24 stroke 风格） */
const props = defineProps<{ name: string; size?: number }>()

const PATHS: Record<string, string> = {
  text: 'M5 6h14M5 12h9M5 18h12',
  image: 'M4 5.5h16v13H4zM8.2 10a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM4.8 16.5l4.4-4.2 3.2 3 3-2.8 3.8 3.6',
  video: 'M4 6h11v12H4zM15 10.5l5-3v9l-5-3z',
  model:
    'M12 3.5l1.7 4.4 4.4 1.7-4.4 1.7L12 15.7l-1.7-4.4-4.4-1.7 4.4-1.7zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
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
  // ---- 以下对齐原型（ionicons5 Outline 的线性简化版）----
  arrowBack: 'M19 12H5.5M11 5.5L4.5 12l6.5 6.5',
  pencil: 'M4.5 19.5l1-4L15.5 5.5l3 3-10 10zM13.5 7.5l3 3',
  card: 'M3.5 6h17v12h-17zM3.5 10h17M7 14.5h4',
  layers: 'M12 4l8.5 4.5L12 13 3.5 8.5zM3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5',
  albums: 'M5 9h14v10H5zM7 6.5h10M9 4h6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.5 6-6 6h-.5c-2 0-3.3-.9-4.4-2.4L4 14.2a1.5 1.5 0 0 1 2.3-1.9L8 14',
  pointer: 'M20 4L4 10.5l7 2.5 2.5 7z',
  book: 'M12 6.5C10.5 5.3 8.5 5 4 5v13c4.5 0 6.5.3 8 1.5 1.5-1.2 3.5-1.5 8-1.5V5c-4.5 0-6.5.3-8 1.5zM12 6.5v13',
  grid: 'M5 5h5.5v5.5H5zM13.5 5H19v5.5h-5.5zM5 13.5h5.5V19H5zM13.5 13.5H19V19h-5.5z',
  minus: 'M5.5 12h13',
  undo: 'M9 6.5L4.5 11 9 15.5M5 11h9a5 5 0 0 1 0 10h-2',
  redo: 'M15 6.5l4.5 4.5-4.5 4.5M19 11h-9a5 5 0 0 0 0 10h2',
  download: 'M12 4.5v10M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
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
