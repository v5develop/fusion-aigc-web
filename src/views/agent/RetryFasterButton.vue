<script setup lang="ts">
/**
 * 智能体结果卡「换更快模型」：与「重试这 n 张」并排的第二个重试入口。
 *
 * <p>只在服务端说有更快替代时才出现——父组件把「失败且 retryable 且 fasterModelAvailable」的任务传进来，
 * 一个都没有就不渲染（没有可用替代时按钮自然隐藏）。模型由服务端选，这里不让用户挑；
 * 价格按替代模型重新计价，重试前服务端不提供只读报价，所以确认框只讲清「会按更快模型的价格重新扣点」，
 * 提交成功后用响应里的 totalPoints 回显实际扣了多少。
 *
 * <p>本组件只管「确认 → 调接口 → 错误处理」，不改父级数据：成功后 emit {@code retried}（带完整响应），
 * 父组件按它把失败格换成新任务（与普通重试同一套换格逻辑）。提交中通过 {@code busy} 事件告知父组件，
 * 父组件据此禁用别的重试按钮。
 */
import { computed, ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { toApiError } from '@/api'
import { AGENT_NO_FASTER_MODEL_CODE, agentGenerationRetry } from '@/api/agent.ts'
import type { IAgentGenTask, IAgentRetryView } from '@/api/agent.ts'
import { BILLING_BLOCK_CODES, emitBillingBlock } from '@/utils/billing-guide'

const props = defineProps<{
  conversationId: string
  /** 失败、可重试、且服务端标了 fasterModelAvailable 的任务；空 = 不渲染 */
  tasks: IAgentGenTask[]
  disabled?: boolean
  /** 按钮样式类，和父级「重试这 n 张」保持一致（默认 sx-soft-btn） */
  buttonClass?: string
}>()
const emit = defineEmits<{
  retried: [view: IAgentRetryView]
  busy: [value: boolean]
  /** 服务端说此刻没有更快的模型（配置变更 / 网关未就绪）：父组件可据此把这批任务的 fasterModelAvailable 摘掉 */
  unavailable: []
}>()

const MAX = 50
const dialog = useDialog()
const message = useMessage()
const submitting = ref(false)
const picked = computed(() => props.tasks.filter((t) => t.fasterModelAvailable && t.retryable).slice(0, MAX))

function ask() {
  const n = picked.value.length
  if (!n || submitting.value || props.disabled) return
  dialog.warning({
    title: `换更快模型重试这 ${n} 张`,
    content: `将用更快的模型重新生成 ${n} 张，按该模型的价格重新扣点（原任务的点数已退回，不会重复扣）。`,
    positiveText: '确认重试',
    negativeText: '取消',
    onPositiveClick: () => {
      void submit(picked.value.map((t) => t.taskId))
    },
  })
}

async function submit(taskIds: string[]) {
  submitting.value = true
  emit('busy', true)
  try {
    const res = await agentGenerationRetry(props.conversationId, taskIds, { fasterModel: true })
    const view = res.data
    if (view) emit('retried', view)
    const ok = view?.tasks?.length ?? 0
    if (ok) {
      const cost = typeof view?.totalPoints === 'number' && view.totalPoints > 0 ? `，共 ${view.totalPoints} 点数` : ''
      message.success(`已用更快的模型重新提交 ${ok} 张${cost}`)
    }
    const failed = view?.failed ?? []
    if (failed.length) {
      const reasons = [...new Set(failed.map((f) => f.reason).filter(Boolean))].join('；')
      message.warning(`${failed.length} 张未能重试${reasons ? `：${reasons}` : ''}`)
    }
  } catch (err) {
    const e = toApiError(err)
    if (e?.code === AGENT_NO_FASTER_MODEL_CODE) {
      // 请求层已 toast 服务端文案；这里只通知父组件收起入口
      emit('unavailable')
    } else if (e && (BILLING_BLOCK_CODES.has(e.code) || e.code === 402 || e.httpStatus === 402)) {
      // 3003 已由拦截器弹引导购买（generation-retry 在 BILLING_GUARD_PATTERNS 里）；HTTP 402 补发同一个信号
      if (e.httpStatus === 402 || e.code === 402) emitBillingBlock(3003)
    } else if (!e || e.code === -1 || e.httpStatus) {
      message.error('换模型重试失败，请稍后再试')
    }
  } finally {
    submitting.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <button
    v-if="picked.length"
    type="button"
    :class="buttonClass ?? 'sx-soft-btn'"
    :disabled="disabled || submitting"
    :aria-busy="submitting"
    title="由系统选择出图更快的模型，按该模型的价格重新计费"
    @click="ask"
  >
    {{ submitting ? '提交中…' : '换更快模型' }}
  </button>
</template>
