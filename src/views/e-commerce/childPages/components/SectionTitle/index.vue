<script setup lang="ts">
/**
 * 电商功能页左栏的分组标题（原型卡内小节：13 / 600 / 20，ink）。
 * 右侧可放开关等附加控件（默认插槽内容两端对齐）。
 */
</script>

<template>
  <h2
    class="flex items-center justify-between gap-8px m-0 mt-18px first:mt-0 mb-8px text-13px font-600 leading-20px text-ink"
  >
    <slot />
  </h2>
</template>
