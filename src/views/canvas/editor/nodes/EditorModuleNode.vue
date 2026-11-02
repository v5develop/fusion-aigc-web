<script setup lang="ts">
/** 模板分组框：模板快照里的 module 节点，仅作视觉分组，不可拖选、不参与连线 */
import { computed } from 'vue'
import type { CanvasNodeData } from '../types.ts'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const width = computed(() => props.data.width ?? 640)
const height = computed(() => props.data.height ?? 420)
const color = computed(() => props.data.color || '#875f9a')
</script>

<template>
  <div
    class="relative border border-dashed rounded-12px pointer-events-none"
    :style="{ width: `${width}px`, height: `${height}px`, borderColor: color, background: `${color}0d` }"
  >
    <span class="absolute top-10px left-14px text-12px font-600 text-inherit opacity-70">{{ data.title || '模块' }}</span>
  </div>
</template>
