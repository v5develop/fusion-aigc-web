<script setup lang="ts">
/**
 * 电商功能页的分段切换（原型 `.sx-seg--picker`，规范 §4.1）：轨道内边距 3、gap 2、r6、#f3f4f5 + 内凹输入影；
 * 选项等分、高 30、r4；选中 = violet-line 描边 + 白→#f8f3fc 渐变 + violet-ink 600，过渡 300ms。
 */
interface TabItem {
  label: string
  value: string | number
}

const { tabs } = defineProps<{ tabs: TabItem[] }>()
const value = defineModel('value', { required: true })
</script>

<template>
  <div class="sx-seg !flex w-full box-border" role="radiogroup">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="radio"
      :aria-checked="value === tab.value"
      class="sx-seg-item sx-focus flex-1 min-w-0 px-14px !text-13px bg-transparent motion-reduce:transition-none"
      :class="value === tab.value ? 'sx-seg-on' : 'hover:text-ink'"
      @click="value = tab.value"
    >
      <span class="truncate">{{ tab.label }}</span>
    </button>
  </div>
</template>
