<script setup lang="ts">
const { placeholder } = defineProps<{ placeholder?: string }>()
const value = defineModel<string>('value', { required: true })
</script>

<template>
  <textarea class="textarea" v-model="value" :placeholder="placeholder"></textarea>
</template>

<style scoped lang="less">
.textarea {
  width: 100%;
  height: 108px;
  border: 1px solid #f0f0f0;
  outline: none;
  resize: none;
  padding: 16px;
  border-radius: 5px;
  transition: all 0.3s;
  &:focus {
    border-color: var(--main-color);
  }
}
</style>
