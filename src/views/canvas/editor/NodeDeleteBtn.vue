<script setup lang="ts">
/**
 * 节点卡右上角悬停「×」（原型 .wf-node-delete）：悬停 / 选中才出现；
 * 锁定或执行中的节点不给（避免误删进行中的任务），删除走画布的撤销栈（Ctrl+Z 可还原）。
 */
import { NODE_DELETE_BTN } from './ui.ts'

defineProps<{
  /** 节点标题，用于无障碍名 */
  title: string
  /** 锁定 / 执行中：不显示 */
  hidden?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <button
    v-if="!hidden"
    type="button"
    :class="NODE_DELETE_BTN"
    title="删除（Ctrl+Z 可撤销）"
    :aria-label="`删除 ${title}`"
    @click.stop="emit('remove')"
  >
    ×
  </button>
</template>
