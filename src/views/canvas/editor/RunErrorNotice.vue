<script setup lang="ts">
/**
 * 失败提示：展示 error 文案；retryable 为真才出「重试」（重试 = 新 run_id，由 store 生成）。
 * UPSTREAM_UNKNOWN 点数不退，不能暗示已退款。
 */
import { computed } from 'vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasNodeData } from './types.ts'

const props = defineProps<{ nodeId: string; data: CanvasNodeData }>()

const store = useCanvasEditor()

const isUnknown = computed(() => props.data.errorCode === 'UPSTREAM_UNKNOWN')
</script>

<template>
  <div class="mt-6px px-8px py-4px rounded-6px text-11px bg-danger-soft text-danger break-all">
    <div>{{ data.errorMessage || '执行失败' }}</div>
    <div v-if="isUnknown" class="mt-2px font-600">结果未知，点数未退回，将由系统对账</div>
    <button
      v-if="data.retryable"
      type="button"
      class="nodrag mt-4px px-8px py-2px border border-danger-line rounded-4px bg-white text-danger text-11px cursor-pointer hover:bg-danger-soft"
      @click.stop="store.retryNode(nodeId)"
    >
      重试
    </button>
  </div>
</template>
