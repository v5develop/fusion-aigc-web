<script setup lang="ts">
interface TabItem {
  label: string
  value: string | number
}

const { tabs } = defineProps<{ tabs: TabItem[] }>()
const value = defineModel('value', { required: true })

</script>

<template>
  <div class="tab-container">
    <div
      v-for="tab in tabs"
      :key="tab.value"
      :class="['tab-item', { active: value === tab.value }]"
      @click="value = tab.value"
    >
      {{ tab.label }}
    </div>
  </div>
</template>

<style scoped lang="less">
.tab-container {
  display: flex;
  align-items: center;
  height: 34px;
  background: #f5f6f8;
  padding: 2px;
  border-radius: 6px;
  gap: 4px;
}

.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 16px;
  background: transparent;
  color: #8f8f8f;
  font-size: 14px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.6);
  }

  &.active {
    background: #ffffff;
    color: #333333;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
}
</style>
