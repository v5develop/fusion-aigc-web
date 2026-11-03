<script setup lang="ts">
/**
 * 本地生活表单分组卡（原型 StudioSplit 操作区的 section 卡 + v3 卡头）。
 *
 * <p>外观逐值取自原型：r8、1px line（#e5e7eb）、白底、v3 卡投影
 * `0 1px 2px rgba(31,35,41,.04), 0 8px 18px rgba(31,35,41,.05)`（v3-theme.css:54-55、487-493）；
 * 内边距 16（工作室卡 `rounded-2xl bg-surface p-4`，AiCopyContent.vue / StudioParamCard.vue）、卡内 gap 12（StudioParamCard `gap-3`）。
 * 卡头：标题 14/600 ink + 一行 11px muted 说明，基线对齐、gap 6，说明溢出省略（v3-theme.css:99-117 `.v3-card__head`）。
 * 右侧 #extra 放卡头动作（AI帮写、展开等）。
 */
import { useId } from 'vue'

const {
  title,
  hint = '',
  required = false,
} = defineProps<{
  title: string
  /** 标题后的一行说明（选填、张数上限等） */
  hint?: string
  /** 标题后加红色星号（只是展示，校验仍由页面负责） */
  required?: boolean
}>()

defineSlots<{ default?: () => unknown; extra?: () => unknown }>()

const titleId = `ll-card-${useId()}`
</script>

<template>
  <section
    class="flex flex-col gap-12px min-w-0 p-16px box-border rounded-lg border border-solid border-line bg-white shadow-card-v3"
    :aria-labelledby="titleId"
  >
    <header class="flex items-center gap-8px min-w-0 min-h-24px">
      <div class="flex flex-1 items-baseline gap-6px min-w-0">
        <h2 :id="titleId" class="flex-none m-0 text-14px font-600 leading-20px text-ink">
          {{ title }}<span v-if="required" class="ml-2px text-danger" aria-hidden="true">*</span>
        </h2>
        <span v-if="hint" class="min-w-0 truncate text-11px leading-16px text-muted" :title="hint">{{ hint }}</span>
      </div>
      <div v-if="$slots.extra" class="flex flex-none items-center gap-6px">
        <slot name="extra" />
      </div>
    </header>
    <slot />
  </section>
</template>
