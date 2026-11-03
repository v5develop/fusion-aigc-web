<script setup lang="ts">
/**
 * 创作页底部提交栏（原型商拍换装「开始换装」/ 工具详情「开始抠图 · 消耗 8 点」同款）：整宽藤紫渐变主按钮，
 * 圆角 10、深紫描边、内高光 + 短投影（ll-btn-primary，与原型 dump 同值）。默认只有一行粗体白字（高 52）；
 * 传了 costText 才出第二行消耗说明（高 56，原型只有工具页有）。
 * 不能提交的原因写在按钮上方一行小字（warning 色，aria-live）。
 *
 * <p>传 form 时按钮是 type=submit 并挂到该表单（工具页 / 工作流页的 &lt;form&gt; 提交）；
 * 不传时是 type=button，点击发 submit 事件（工作室页面）。加载中按钮文案换成「提交中…」并转圈。
 * #extra 插槽放在按钮上方，用于页面自己的补充说明（如幂等重试提示）。
 */
import { useId } from 'vue'

const {
  label,
  costText = '',
  disabled = false,
  loading = false,
  reason = '',
  form,
} = defineProps<{
  /** 按钮主文案，如「开始换装」 */
  label: string
  /** 按钮第二行：消耗 / 任务数说明 */
  costText?: string
  disabled?: boolean
  loading?: boolean
  /** 还不能提交的原因（按钮上方一行 warning 小字） */
  reason?: string
  /** 关联的表单 id；有值时按钮为 type=submit */
  form?: string
}>()

const emit = defineEmits<{ submit: [] }>()

const reasonId = `creation-action-reason-${useId()}`

function onClick() {
  if (form || disabled || loading) return
  emit('submit')
}
</script>

<template>
  <div class="flex flex-col gap-6px">
    <slot name="extra" />
    <p v-if="reason" :id="reasonId" class="m-0 text-11px leading-15px text-warning text-center" aria-live="polite">
      {{ reason }}
    </p>
    <button
      :type="form ? 'submit' : 'button'"
      :form="form"
      class="ll-btn-primary relative w-full py-0 px-16px flex-col !gap-2px !rounded-10px ![transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:!transition-none outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
      :class="costText ? 'h-56px' : 'h-52px'"
      :disabled="disabled || loading"
      :aria-busy="loading || undefined"
      :aria-describedby="reason ? reasonId : undefined"
      @click="onClick"
    >
      <span class="flex items-center gap-6px text-15px font-600 leading-20px">
        <span
          v-if="loading"
          class="block w-12px h-12px box-border rounded-full border-1.5px border-solid border-white/35 border-t-white animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {{ loading ? '提交中…' : label }}
      </span>
      <span v-if="costText" class="text-11px font-400 leading-15px opacity-85" aria-live="polite">{{ costText }}</span>
    </button>
  </div>
</template>
