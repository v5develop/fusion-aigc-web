<script setup lang="ts">
/**
 * 节点里打开的大图灯箱（共用 MediaLightbox，Teleport 到 body，下载在灯箱里）。
 * 灯箱只拦截自己处理的按键；画布页在 window 上监听 Delete / Backspace / Ctrl+Z 等快捷键，
 * 灯箱打开期间在 document 捕获阶段截住其余按键，免得看大图时按退格把选中的节点删了。
 */
import { onBeforeUnmount, watch } from 'vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'

const props = defineProps<{ items: LightboxItem[] }>()
const show = defineModel<boolean>('show', { required: true })
const index = defineModel<number>('index', { default: 0 })

function guard(event: KeyboardEvent) {
  event.stopPropagation()
}

// 只在灯箱真的渲染出来时拦截（items 为空时不渲染，拦了会让画布快捷键全部失灵）
watch(
  () => show.value && props.items.length > 0,
  (open) => {
    if (open) document.addEventListener('keydown', guard, true)
    else document.removeEventListener('keydown', guard, true)
  },
  { immediate: true },
)
// 内容被清空（节点被删 / 候选被移除完）：把 show 复位，免得下次有图时不点就自己弹出来
watch(
  () => props.items.length,
  (count) => {
    if (!count && show.value) show.value = false
  },
)
onBeforeUnmount(() => document.removeEventListener('keydown', guard, true))
</script>

<template>
  <MediaLightbox v-if="props.items.length" v-model:show="show" v-model:index="index" :items="props.items" />
</template>
