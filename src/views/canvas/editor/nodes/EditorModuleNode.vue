<script setup lang="ts">
/**
 * 模板分组框（原型 CanvasModuleNode + canvas-v31）：模板快照里的 module 节点，仅作视觉分组，不可拖选、不参与连线。
 * 右上角「×」删除模块：底板连同落在底板范围内的节点一起删除（由画布页确认后执行）。
 */
import { computed } from 'vue'
import EditorIcon from '../EditorIcon.vue'
import type { CanvasNodeData } from '../types.ts'
import { FOCUS_RING } from '../ui.ts'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const width = computed(() => props.data.width ?? 760)
const height = computed(() => props.data.height ?? 520)
/**
 * 底板色（原型 templateTintForShell）：快照存的是 rgba 浅色直接用；旧紫 rgba(142,102,249,…) 换成藤紫 .09；
 * 只给了 #rrggbb 实色时按 .09 透明度（0x17）铺底。
 */
const tint = computed(() => {
  const raw = (props.data.color ?? '').trim()
  if (!raw || /^rgba\(142,\s*102,\s*249/.test(raw)) return 'rgba(135, 95, 154, 0.09)'
  if (/^#[0-9a-f]{6}$/i.test(raw)) return `${raw}17`
  return raw
})
</script>

<template>
  <div
    class="group relative border border-solid border-line rounded-8px pointer-events-none"
    :style="{ width: `${width}px`, height: `${height}px`, background: tint }"
  >
    <div class="absolute top-12px left-14px flex items-baseline gap-6px">
      <strong class="text-13px font-600 text-[rgba(31,35,41,0.66)] tracking-[0.02em]">{{
        data.title || '模块'
      }}</strong>
      <span class="text-muted text-11px">{{ data.subtitle || '模板模块' }}</span>
    </div>
    <!-- 原型 .wf-module-node__close：22px、半透明白底，悬停模块时转实、悬停按钮转红 -->
    <button
      type="button"
      class="absolute top-10px right-12px grid w-22px h-22px p-0 place-items-center border border-solid border-[rgba(31,35,41,0.08)] rounded-6px bg-white/72 text-muted cursor-pointer pointer-events-auto opacity-55 transition-[opacity,color,border-color,background-color] duration-120 group-hover:opacity-100 focus-visible:opacity-100 hover:border-[#e4b7b4] hover:bg-[#fbeeed] hover:text-danger nodrag"
      :class="FOCUS_RING"
      :title="`删除模块「${data.title || '模块'}」及模块内的节点`"
      :aria-label="`删除模块「${data.title || '模块'}」及模块内的节点`"
      @click.stop="emit('remove')"
    >
      <EditorIcon name="close" :size="12" />
    </button>
  </div>
</template>
