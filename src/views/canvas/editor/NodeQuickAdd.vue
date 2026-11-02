<script setup lang="ts">
/**
 * 输出口右侧的「+」（原型 .wf-node-quick-add：28px 圆、right -40px、垂直居中，
 * 常驻 55% 透明，悬停 / 选中节点时不透明）。点开后选一种下游节点，由画布页新建并自动连线。
 */
import type { DropdownOption } from 'naive-ui'
import EditorIcon from './EditorIcon.vue'
import { FOCUS_RING, type QuickAddKind } from './ui.ts'

const props = defineProps<{
  kinds: QuickAddKind[]
  /** 圆钮垂直位置（与输出口同一 top） */
  top?: string
}>()

const emit = defineEmits<{ pick: [kind: QuickAddKind] }>()

const LABELS: Record<QuickAddKind, string> = {
  'image-model': '图片生成',
  'video-model': '视频生成',
  tool: '工具',
}

const options: DropdownOption[] = props.kinds.map((kind) => ({ key: kind, label: `添加${LABELS[kind]}节点` }))

function onSelect(key: string | number) {
  emit('pick', key as QuickAddKind)
}
</script>

<template>
  <n-dropdown trigger="click" placement="right-start" size="small" :options="options" @select="onSelect">
    <button
      type="button"
      class="absolute -right-40px z-10 grid w-28px h-28px p-0 place-items-center border border-solid border-line rounded-full bg-white text-muted cursor-pointer -translate-y-50% opacity-55 transition-opacity duration-120 shadow-[0_1px_2px_rgba(16,24,40,0.06)] group-hover:opacity-100 [.is-selected_&]:opacity-100 hover:border-violet hover:bg-violet-soft hover:text-violet-ink focus-visible:opacity-100 nodrag"
      :class="FOCUS_RING"
      :style="{ top: top ?? '50%' }"
      title="从此节点添加"
      aria-label="从此节点添加下游节点"
      @click.stop
    >
      <EditorIcon name="plus" :size="18" />
    </button>
  </n-dropdown>
</template>
