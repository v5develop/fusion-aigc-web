<script setup lang="ts">
/** 尚未接入的入口占位页：只展示标题与说明，不含任何业务功能（对齐原型空态版式） */
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-y-auto bg-page p-24px">
    <h1 class="m-0 mb-16px text-20px font-600 leading-[1.3] text-ink">{{ title }}</h1>
    <section
      class="flex min-h-360px flex-col items-center justify-center gap-8px rounded-8px border border-solid border-line bg-white px-24px py-32px text-center shadow-[0_1px_2px_rgba(31,35,41,0.04),0_8px_18px_rgba(31,35,41,0.05)]"
      :aria-label="title + '空态'"
    >
      <b class="text-14px font-600 text-ink">{{ title }}</b>
      <p class="m-0 max-w-420px text-11px leading-[1.7] text-muted">{{ description }}</p>
    </section>
  </div>
</template>
