<script setup lang="ts">
/** 计费动作的进度 / 失败 / 完成提示条（编辑、多视图、图层共用） */
import type { ActionPhase } from './useActionRun.ts'
import { formatElapsed } from './image-actions.ts'
import { ACTION_BTN, SPINNER, STATUS_ERR, STATUS_INFO, STATUS_OK } from './action-ui.ts'

defineProps<{
  phase: ActionPhase
  error: string
  elapsed: number
  /** 进行中的文案，如「正在编辑图片」 */
  runningText: string
  doneText: string
  /** 失败时重试钮文案 */
  retryText?: string
}>()

const emit = defineEmits<{ retry: []; stop: []; resume: [] }>()
</script>

<template>
  <div aria-live="polite">
    <div v-if="phase === 'submitting'" :class="STATUS_INFO" role="status">
      <span :class="SPINNER" aria-hidden="true" />正在提交…
    </div>
    <div v-else-if="phase === 'polling'" :class="STATUS_INFO" role="status">
      <span :class="SPINNER" aria-hidden="true" />
      <span class="flex-1">{{ runningText }}，已等待 {{ formatElapsed(elapsed) }}</span>
      <button type="button" :class="ACTION_BTN" class="!h-28px !px-8px !text-12px" @click="emit('stop')">
        停止等待
      </button>
    </div>
    <div v-else-if="phase === 'stopped'" :class="STATUS_INFO">
      <span class="flex-1">已停止等待，任务仍在后台进行，不会撤回</span>
      <button type="button" :class="ACTION_BTN" class="!h-28px !px-8px !text-12px" @click="emit('resume')">
        继续等待
      </button>
    </div>
    <div v-else-if="phase === 'error'" :class="STATUS_ERR" role="alert">
      <span class="leading-18px">{{ error }}</span>
      <button type="button" :class="ACTION_BTN" class="self-start !h-28px !px-10px !text-12px" @click="emit('retry')">
        {{ retryText ?? '重试' }}
      </button>
    </div>
    <div v-else-if="phase === 'done'" :class="STATUS_OK" role="status">{{ doneText }}</div>
  </div>
</template>
