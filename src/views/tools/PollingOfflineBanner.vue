<script setup lang="ts">
/**
 * 断网提示条：与创作页（views/studio/components/StudioWorkspaceColumns）同一份文案与样式。
 * 放在 relative 容器里，顶部居中悬浮；正常时不渲染。
 */
defineProps<{ show: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    v-if="show"
    role="alert"
    class="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-12px rounded-b-8px bg-[#fff1f0] px-16px py-6px text-13px text-[#cf1322] shadow"
  >
    <span>网络异常，已暂停轮询</span>
    <button
      type="button"
      class="cursor-pointer rounded-4px border border-solid border-[#cf1322] bg-transparent px-8px py-2px text-12px text-[#cf1322]"
      @click="$emit('retry')"
    >
      重试
    </button>
  </div>
</template>
