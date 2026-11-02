<script setup lang="ts">
/** 提示词文本节点：正文编辑 + 右侧 text 输出口（连到生成节点的 prompt 口） */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const store = useCanvasEditor()

const text = computed({
  get: () => props.data.text ?? '',
  set: (value: string) => store.updateNodeData(props.id, { text: value }),
})

const width = computed(() => props.data.width ?? 300)
const height = computed(() => props.data.height ?? 190)
</script>

<template>
  <div class="ll-card group relative text-12px text-ink" :class="{ 'is-selected': selected, '!border-violet !shadow-[0_0_0_2px_rgba(135,95,154,0.18),0_10px_18px_-10px_rgba(31,35,41,0.22)]': selected }" :style="{ width: `${width}px` }">
    <header class="flex h-34px items-center gap-8px pl-12px pr-10px border-b border-line-soft rounded-t-10px">
      <span class="shrink-0 w-8px h-8px rounded-full bg-[#22c55e]" />
      <span class="overflow-hidden flex-1 text-13px font-600 text-ellipsis whitespace-nowrap">{{ data.title || '文字' }}</span>
      <span class="shrink-0 px-6px py-1px rounded-4px bg-violet-soft text-violet-ink text-10px leading-16px">提示词</span>
      <button type="button" class="absolute -top-9px -right-9px z-3 grid w-20px h-20px p-0 place-items-center border border-line rounded-full bg-white text-muted text-12px leading-none cursor-pointer opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:border-danger-line hover:bg-danger-soft hover:text-danger" title="删除节点" @click.stop="emit('remove')">×</button>
    </header>
    <div class="px-10px pt-8px pb-10px">
      <textarea
        v-model="text"
        class="block w-full px-10px py-8px border border-line rounded-8px bg-surface2 text-ink text-12px leading-18px resize-none outline-none focus:border-violet focus:bg-white nodrag nowheel"
        maxlength="3000"
        placeholder="输入提示词，连到生成节点的提示词口…"
        :style="{ height: `${Math.max(80, height - 76)}px` }"
      />
      <div class="mt-4px text-right text-placeholder text-10px">{{ text.length }} / 3000</div>
    </div>
    <Handle id="text" type="source" :position="Position.Right" class="ed-port ed-port--text" />
  </div>
</template>

<style scoped lang="less">
// Handle 是 Vue Flow 组件，自带 .vue-flow__handle 样式，端口样式留在 Less 以保证优先级
@import '../node-base.less';
</style>
