<script setup lang="ts">
/**
 * 纯展示：原片与成片并排（手机竖排）。没有地址的一侧显示占位；成片地址可能是占位图（data: 开头不当视频播）。
 * 播放 / 出错只往外抛事件，由调用方决定要不要续签地址。
 */
withDefaults(
  defineProps<{
    sourceUrl?: string
    sourceLabel?: string
    /** 原片侧占位文案（没有地址时；默认留空，与原页面一致） */
    sourceEmpty?: string
    resultUrl?: string
    resultLabel?: string
    resultAlt?: string
    /** 成片侧占位文案（还没有地址时） */
    resultEmpty?: string
    /** 右下角「AI 生成」标识 */
    aiMark?: boolean
    /** 成片侧按图片显示（预览版占位图）；不传时 data: 开头按图片 */
    resultAsImage?: boolean
  }>(),
  { sourceLabel: '原片', resultLabel: '你的成片', resultAlt: '你的成片', resultEmpty: '成片已生成', aiMark: true },
)
const emit = defineEmits<{ (e: 'result-play'): void; (e: 'result-error'): void }>()
const isPlaying = (u?: string) => !!u && !u.startsWith('data:')
</script>

<template>
  <div class="grid grid-cols-2 gap-10px max-sm:grid-cols-1">
    <figure class="relative m-0 aspect-[9/16] max-h-360px overflow-hidden rounded-14px bg-surface3">
      <video v-if="sourceUrl" :src="`${sourceUrl}#t=0.1`" muted playsinline controls class="h-full w-full object-cover" />
      <span v-else-if="sourceEmpty" class="grid h-full w-full place-items-center px-12px text-center text-11px text-placeholder">{{ sourceEmpty }}</span>
      <figcaption class="absolute left-8px top-8px rounded-4px bg-black/55 px-6px py-2px text-10px text-white">{{ sourceLabel }}</figcaption>
    </figure>
    <figure class="relative m-0 aspect-[9/16] max-h-360px overflow-hidden rounded-14px bg-surface3">
      <video v-if="isPlaying(resultUrl) && !resultAsImage" :src="resultUrl" controls playsinline class="h-full w-full object-cover" @play="emit('result-play')" @error="emit('result-error')" />
      <img v-else-if="resultUrl" :src="resultUrl" :alt="resultAlt" class="h-full w-full object-cover" />
      <span v-else class="grid h-full w-full place-items-center px-12px text-center text-11px text-placeholder">{{ resultEmpty }}</span>
      <figcaption class="absolute left-8px top-8px rounded-4px bg-violet-solid px-6px py-2px text-10px text-white">{{ resultLabel }}</figcaption>
      <span v-if="aiMark" class="absolute bottom-8px right-8px rounded-4px bg-black/55 px-6px py-2px text-10px text-white">AI 生成</span>
    </figure>
  </div>
</template>
