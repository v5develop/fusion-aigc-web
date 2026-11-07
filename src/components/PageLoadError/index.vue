<script setup lang="ts">
/**
 * 加载失败占位（全站统一，对齐原型 5185 PageLoadError）：48 圆警告标 + 标题 + 说明 + 可选「重试」。
 * 用在整块数据取不到的时候（列表 / 详情）；表单字段的错误不要用它，按规范在字段下写 12px 红字。
 *
 *   <PageLoadError :subtitle="error" retryable @retry="reload" />
 */
withDefaults(defineProps<{ title?: string; subtitle?: string; retryable?: boolean; compact?: boolean }>(), {
  title: '加载失败',
  subtitle: '网络异常或请求超时，请检查后重试',
  retryable: false,
  compact: false,
})
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center text-center" :class="compact ? 'py-16px' : 'py-32px'" role="alert">
    <div
      class="grid place-items-center w-48px h-48px rounded-full border-2 border-solid border-warning text-warning text-24px font-600 leading-none"
      aria-hidden="true"
    >
      !
    </div>
    <p class="m-0 mt-12px text-14px leading-20px text-ink-2">{{ title }}</p>
    <p class="m-0 mt-4px max-w-360px text-12px leading-18px text-placeholder">{{ subtitle }}</p>
    <button v-if="retryable" type="button" class="sx-btn mt-12px" @click="$emit('retry')">重试</button>
  </div>
</template>
