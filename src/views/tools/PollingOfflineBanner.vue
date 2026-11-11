<script setup lang="ts">
/**
 * 断网提示条：与创作页（views/studio/components/StudioWorkspaceColumns）同一份文案与样式。
 * 放在 relative 容器里，顶部居中悬浮；正常时不渲染。颜色用色板里的危险提示（原型 `.sx-alert--danger`）：
 * 底 danger-soft #fdf1f0、字 #8f4b47、描边 danger-line。
 */
defineProps<{ show: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    v-if="show"
    role="alert"
    class="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-12px rounded-b-8px border border-t-0 border-solid border-danger-line bg-danger-soft px-16px py-6px text-13px text-alert-danger shadow-[0_4px_10px_rgba(31,35,41,0.10)]"
  >
    <span>网络异常，已暂停轮询</span>
    <button
      type="button"
      class="cursor-pointer rounded-4px border border-solid border-danger-line bg-white px-12px h-32px text-13px font-500 text-danger hover:border-danger outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
      @click="$emit('retry')"
    >
      重试
    </button>
  </div>
</template>
