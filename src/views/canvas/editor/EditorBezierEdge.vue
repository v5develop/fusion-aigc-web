<script setup lang="ts">
/**
 * 贝塞尔连线：水平三次贝塞尔，控制点偏移 max(50, |dx| * 0.4)。
 * 可见线不接收鼠标事件；另铺一条 12px 透明线作为命中区，
 * 选中后加粗发光（drop-shadow 5px）并在中点显示红色断开按钮（原型 #ef4444，v3.1 皮肤未覆盖）。线色取连线 data.color（快照私有字段），
 * 渲染时按原型主题映射成设计系统色（图片藤紫 / 提示词绿 / 视频红）。
 */
import { computed } from 'vue'
import { EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core'
import { useCanvasEditor } from './useCanvasEditor.ts'
import { edgeDisplayColor } from './ports.ts'

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

const color = computed(() => edgeDisplayColor((props.data as { color?: string } | undefined)?.color))

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
    class="pointer-events-none"
    :d="path"
    :stroke="color"
    :stroke-width="props.selected ? 3 : 2"
    :style="{ filter: props.selected ? `drop-shadow(0 0 5px ${color})` : undefined }"
    stroke-linecap="round"
    fill="none"
  />
  <EdgeLabelRenderer v-if="props.selected">
    <button
      type="button"
      class="absolute z-4 grid w-28px h-28px place-items-center p-0 border-2 border-solid border-white rounded-full bg-[#ef4444] text-white font-inherit text-16px leading-none cursor-pointer shadow-[0_4px_12px_rgba(239,68,68,0.35)] [pointer-events:all] hover:bg-[#dc2626] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2"
      title="断开连线"
      aria-label="断开连线"
      :style="{ transform: `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px)` }"
      @click.stop="store.removeEdgeById(props.id)"
    >
      ×
    </button>
  </EdgeLabelRenderer>
</template>
