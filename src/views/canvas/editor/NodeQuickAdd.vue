<script setup lang="ts">
/**
 * 输出口右侧的「+」（原型 .wf-node-quick-add：28px 圆、right -40px、垂直居中，
 * 常驻隐藏（opacity 0），悬停 / 选中节点或键盘聚焦时出现，过渡 0.12s）。
 * 点击后由画布页在「+」旁打开添加面板（只列可接到本节点下游的种类），选中即新建并自动连线。
 */
import EditorIcon from './EditorIcon.vue'
import { FOCUS_RING, type IQuickAddRequest, type QuickAddKind } from './ui.ts'

const props = defineProps<{
  kinds: QuickAddKind[]
  /** 圆钮垂直位置（与输出口同一 top） */
  top?: string
}>()

const emit = defineEmits<{ open: [request: IQuickAddRequest] }>()

function onClick(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit('open', { kinds: props.kinds, clientX: rect.right, clientY: rect.top + rect.height / 2 })
}
</script>

<template>
  <button
    type="button"
    class="absolute -right-40px z-10 grid w-28px h-28px p-0 place-items-center border border-solid border-line rounded-full bg-white text-muted cursor-pointer -translate-y-50% opacity-0 transition-opacity duration-120 shadow-[0_1px_2px_rgba(16,24,40,0.06)] group-hover:opacity-100 [.is-selected_&]:opacity-100 hover:border-violet hover:bg-violet-soft hover:text-violet-ink focus-visible:opacity-100 nodrag"
    :class="FOCUS_RING"
    :style="{ top: top ?? '50%' }"
    title="从此节点添加"
    aria-label="从此节点添加下游节点"
    aria-haspopup="dialog"
    @click.stop="onClick"
  >
    <EditorIcon name="plus" :size="18" />
  </button>
</template>
