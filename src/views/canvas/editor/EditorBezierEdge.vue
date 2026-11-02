<script setup lang="ts">
/**
 * 贝塞尔连线：水平三次贝塞尔，控制点偏移 max(50, |dx| * 0.4)。
 * 可见线不接收鼠标事件；另铺一条 12px 透明线作为命中区，
 * 选中后加粗并在中点显示断开按钮。线色取连线 data.color（快照私有字段）。
 */
import { computed } from 'vue'
import { EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core'
import { useCanvasEditor } from './useCanvasEditor.ts'

const props = defineProps<EdgeProps>()

const store = useCanvasEditor()

const path = computed(() => {
  const sx = props.sourceX
  const sy = props.sourceY
  const tx = props.targetX
  const ty = props.targetY
  const offset = Math.max(50, Math.abs(tx - sx) * 0.4)
  return `M ${sx} ${sy} C ${sx + offset} ${sy}, ${tx - offset} ${ty}, ${tx} ${ty}`
})

const color = computed(() => {
  const fromData = (props.data as { color?: string } | undefined)?.color
  return fromData || '#38bdf8'
})

const midpoint = computed(() => ({
  x: (props.sourceX + props.targetX) / 2,
  y: (props.sourceY + props.targetY) / 2,
}))
</script>

<template>
  <path
    class="cursor-pointer [pointer-events:stroke]"
    :d="path"
    stroke="transparent"
    stroke-width="12"
    stroke-linecap="round"
    fill="none"
  />
  <path
    class="pointer-events-none editor-edge-line"
    :class="{ 'is-selected': props.selected }"
    :d="path"
    :stroke="color"
    :stroke-width="props.selected ? 3 : 2"
    stroke-linecap="round"
    fill="none"
  />
  <EdgeLabelRenderer v-if="props.selected">
    <button
      type="button"
      class="absolute z-4 grid w-24px h-24px place-items-center p-0 border-2 border-white rounded-full bg-danger text-white font-inherit text-14px leading-none cursor-pointer shadow-[0_4px_12px_rgba(180,67,62,0.35)] [pointer-events:all] hover:bg-#c1524c"
      title="断开连线"
      aria-label="断开连线"
      :style="{ transform: `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px)` }"
      @click.stop="store.removeEdgeById(props.id)"
    >×</button>
  </EdgeLabelRenderer>
</template>

<style scoped>
/* 选中态投影颜色取自 script 的 color，只有 v-bind() 能在 CSS 里引用 */
.editor-edge-line.is-selected {
  filter: drop-shadow(0 0 4px v-bind(color));
}
</style>
