<script setup lang="ts">
/**
 * 三栏工作台 · 底部提交条：外观全部交给共用的 CreationActionBar（原型整宽主按钮；拿到报价时按钮第二行「消耗 N 点」），
 * 这里只保留工作室特有的幂等重试口径。
 *
 * <p>表单未就绪时只置灰（原型提交条上方没有余额行，也不写未就绪原因）；悬停提示（title）：
 * 有 disabledReason 时给未就绪原因（页面多半让按钮保持可点、点了 toast 同一句），就绪时给 hint
 * （原型 ToolSubmitBar hint，如「按模特 × 生成张数逐个提交，每个任务单独出图」）；
 * 幂等重试态（useIdempotentSubmit.retrying）按钮文案换成「重试生成」，并在按钮上方给出重试提示。
 */
import { computed } from 'vue'
import CreationActionBar from '@/components/Creation/CreationActionBar.vue'

const props = withDefaults(
  defineProps<{
    /** 按钮主文案（重试态自动换成「重试生成」） */
    label: string
    submitting?: boolean
    /** 表单未就绪：置灰 */
    disabled?: boolean
    /** 未就绪原因（如「还没传服装图：上衣」）：不占版面，作提交条的悬停提示（title） */
    disabledReason?: string
    /** 就绪时的悬停说明（怎么拆任务）；有未就绪原因时让位给原因 */
    hint?: string
    /** 幂等重试态：上次提交失败，沿用原 Idempotency-Key */
    retry?: boolean
    /** 预计消耗点数（useStudioCost）；null = 没有报价，不显示消耗行 */
    points?: number | null
  }>(),
  { submitting: false, disabled: false, disabledReason: '', hint: '', retry: false, points: null },
)

const emit = defineEmits<{ submit: [] }>()

const btnText = computed(() => (props.retry ? '重试生成' : props.label))
const RETRY_NOTE = '上次提交未成功，可直接重试（沿用原幂等键）；改动任意参数后会按新内容重新提交'
</script>

<template>
  <CreationActionBar
    :label="btnText"
    :cost-points="points"
    :disabled="disabled"
    :loading="submitting"
    :title="disabledReason || hint || undefined"
    @submit="emit('submit')"
  >
    <template #extra>
      <p
        v-if="retry"
        class="m-0 text-11px leading-15px text-center"
        :class="disabled ? 'text-warning' : 'text-placeholder'"
      >
        {{ RETRY_NOTE }}
      </p>
    </template>
  </CreationActionBar>
</template>
