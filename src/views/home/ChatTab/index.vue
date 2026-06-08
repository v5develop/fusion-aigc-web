<script lang="ts">
export type TTabValue = 'image' | 'video' | 'ecommerce'
</script>

<script setup lang="ts">
/** 双向绑定的选中值 */
const modelValue = defineModel<TTabValue>({ required: true })

const options = [
  { label: 'AI 图片创作', value: 'image' as const },
  { label: 'AI 视频创作', value: 'video' as const },
  { label: '电商商品', value: 'ecommerce' as const },
]

function handleTabClick(value: TTabValue) {
  if (value !== modelValue.value) {
    modelValue.value = value
  }
}
</script>

<template>
  <div class="chat-tab">
    <button
      v-for="item in options"
      :key="item.value"
      class="chat-tab__item"
      :class="{ 'chat-tab__item--active': modelValue === item.value }"
      @click="handleTabClick(item.value)"
    >
      <span class="chat-tab__label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style scoped lang="less">
.chat-tab {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-bottom: 24px;

  &__item {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 9px 16px;
    border: 1px solid transparent;
    border-radius: 211px;
    background-color: #fff;
    cursor: pointer;
    transition:
      border-color 0.25s ease,
      color 0.25s ease;
    outline: none;
    box-sizing: border-box;

    &--active {
      border-color: var(--main-color);
    }
  }

  &__label {
    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    white-space: nowrap;
    transition: color 0.25s ease;

    .chat-tab__item--active & {
      color: var(--main-color);
    }
  }
}
</style>
