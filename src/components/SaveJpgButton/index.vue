<script setup lang="ts">
/**
 * 「另存为 JPG」图标钮：放在单图「下载」钮旁，下载原图的行为不变。
 * 只对静态图片出现（视频 / 动图 / SVG 自动隐藏）；透明 PNG 转换后铺白底。
 * url 必须是原图地址（不是水印展示副本）。
 *
 *   <SaveJpgButton :url="r.original" :name="title" size="sm" variant="quiet" />
 */
import { computed, ref } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { canSaveAsJpg, saveImageAsJpg } from '@/utils/download.ts'

const props = withDefaults(
  defineProps<{
    url?: string
    /** 文件名（扩展名会被替换为 .jpg） */
    name?: string
    size?: 'sm' | 'md' | 'lg'
    variant?: 'plate' | 'quiet' | 'overlay' | 'danger'
    disabled?: boolean
    reveal?: boolean
  }>(),
  { url: '', name: undefined, size: 'md', variant: 'plate', disabled: false, reveal: false },
)

const show = computed(() => canSaveAsJpg(props.url))
const busy = ref(false)
async function save() {
  if (busy.value || !props.url) return
  busy.value = true
  try {
    await saveImageAsJpg(props.url, props.name)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <IconButton
    v-if="show"
    label="另存为 JPG"
    :size="size"
    :variant="variant"
    :loading="busy"
    :disabled="disabled"
    :reveal="reveal"
    @click.stop="save"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <text x="12" y="17" text-anchor="middle" font-size="6.5" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">JPG</text>
    </svg>
  </IconButton>
</template>
