<script setup lang="ts">
/**
 * 三栏工作台 · 底部提交条（信息组织参考 s1.1 ToolSubmitBar）。
 *
 * <p>左侧提交说明（如「共 N 张 = 模特数 × 张数」/ 未就绪原因 / 重试提示），
 * 右侧主 CTA（ll-btn-primary）；表单未就绪时置灰并给出原因；
 * 幂等重试态（useIdempotentSubmit.retrying）按钮文案换成「重试生成」。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 按钮主文案（重试态自动换成「重试生成」） */
    label: string
    submitting?: boolean
    /** 表单未就绪：置灰 + 左侧展示 disabledReason */
    disabled?: boolean
    /** 未就绪原因（如「还没传服装图：上衣」） */
    disabledReason?: string
    /** 左侧提交说明，如「共 4 张 = 2 位模特 × 每位 2 张」 */
    metaText?: string
    /** 幂等重试态：上次提交失败，沿用原 Idempotency-Key */
    retry?: boolean
  }>(),
  { submitting: false, disabled: false, disabledReason: '', metaText: '', retry: false },
)

defineEmits<{ submit: [] }>()

const btnText = computed(() => (props.retry ? '重试生成' : props.label))
const noteText = computed(() => {
  if (props.retry) return '上次提交未成功，可直接重试（沿用原幂等键）；改动任意参数后会按新内容重新提交'
  return props.disabledReason
})
</script>

<template>
  <div class="flex gap-12px items-center min-w-0" :title="retry ? noteText : undefined">
    <div class="flex flex-1 min-w-0 flex-col gap-2px">
      <span v-if="metaText" class="text-12px text-ink-2">{{ metaText }}</span>
      <span v-if="noteText" class="text-11px leading-15px" :class="disabled ? 'text-warning' : 'text-placeholder'">{{ noteText }}</span>
    </div>
    <button
      type="button"
      class="ll-btn-primary relative flex-none h-40px px-22px py-0"
      :disabled="disabled || submitting"
      @click="$emit('submit')"
    >
      <span v-if="submitting" class="stu-spin absolute top-1/2 left-12px w-12px h-12px -mt-6px border-1.5px border-solid border-white/35 border-t-white rounded-full" aria-hidden="true" />
      <span>{{ btnText }}</span>
    </button>
  </div>
</template>

<style scoped lang="less">
/* keyframes 与其引用只能写在 Less 中 */
.stu-spin {
  animation: stu-spin 0.7s linear infinite;
}

@keyframes stu-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
