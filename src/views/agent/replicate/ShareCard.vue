<script setup lang="ts">
/**
 * 对话卡片：成片分享为示例的投稿状态（CONTRACT §T）。「撤回」只发一条用户消息，卡片不改业务状态。
 */
import { computed } from 'vue'
import type { ReplicateShare } from '@/api/replicate-card.ts'

const props = defineProps<{ view: ReplicateShare; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const text = computed(() => {
  switch (props.view.status) {
    case 'pending':
      return '审核中'
    case 'approved':
      return '已上线为示例'
    case 'rejected':
      return props.view.rejectReason ? `未通过：${props.view.rejectReason}` : '未通过'
    default:
      return '已撤回'
  }
})
const tone = computed(() => (props.view.status === 'rejected' ? 'text-danger' : props.view.status === 'approved' ? 'text-success' : 'text-ink-2'))
const canWithdraw = computed(() => props.view.status === 'pending' || props.view.status === 'approved')
</script>

<template>
  <section class="sx-squircle flex w-full max-w-520px flex-wrap items-center gap-8px rounded-18px sx-soft px-16px py-12px" aria-label="分享为示例">
    <h3 class="vr-h3 !m-0">分享为示例</h3>
    <span :class="['min-w-0 flex-1 break-words text-13px leading-20px', tone]" role="status">{{ text }}</span>
    <button v-if="canWithdraw" type="button" class="sx-btn !h-28px !px-12px !text-12px" :disabled="disabled" @click="emit('send', '撤回我分享的示例')">撤回</button>
  </section>
</template>
