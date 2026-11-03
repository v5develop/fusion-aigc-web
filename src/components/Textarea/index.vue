<script setup lang="ts">
const { placeholder } = defineProps<{ placeholder?: string }>()
const value = defineModel<string>('value', { required: true })
</script>

<template>
  <!-- 输入框规范（§4.1）：1px 控件描边 + 内凹输入影，hover 描边加深；焦点 violet 描边 + 3px 藤紫外环 -->
  <textarea
    class="block w-full h-108px p-16px resize-none rounded-sm bg-white [font-family:inherit] text-13px leading-20px text-ink border border-solid border-control shadow-inset-input outline-none placeholder:text-placeholder hover:border-control-hover focus:(border-violet shadow-focus) transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none"
    v-model="value"
    :placeholder="placeholder"
  ></textarea>
</template>
