<script setup lang="ts">
/** 文字位下方的小提示：「会自动加到图上」；第一个版式位旁带「本次给图片加字」开关。 */
import { overlayEnabled } from './useTextOverlay.ts'

defineProps<{ first?: boolean; disabled?: boolean }>()
</script>

<template>
  <p class="m-0 flex items-center gap-8px text-11px leading-16px text-muted">
    <span>{{ overlayEnabled ? '会自动加到图上' : '本次不会加到图上' }}</span>
    <label v-if="first" class="inline-flex cursor-pointer items-center gap-4px text-ink-2">
      <input v-model="overlayEnabled" type="checkbox" :disabled="disabled" class="m-0" />
      本次给图片加字
    </label>
  </p>
</template>
