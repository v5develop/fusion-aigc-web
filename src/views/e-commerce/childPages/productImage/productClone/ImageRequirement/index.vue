<script setup lang="ts">
const list = defineModel<any[]>('list', { required: true })
</script>

<template>
  <div
    v-show="list.length"
    class="w-336px max-w-full box-border p-12px rounded-lg border border-solid border-line-soft bg-surface2"
  >
    <div class="text-13px font-600 leading-20px text-ink-2">单张参考要求</div>
    <div class="text-11px leading-17px text-muted">每张参考图可单独备注参考要求，不填默认处理。</div>

    <div v-for="(item, i) in list" :key="item" class="flex items-center gap-8px mt-8px">
      <span class="flex-none sx-label">参考图{{ i + 1 }}</span>
      <n-input v-model:value="item.input" type="text" placeholder="请输入" :aria-label="`参考图${i + 1}的参考要求`" />
    </div>
  </div>
</template>
