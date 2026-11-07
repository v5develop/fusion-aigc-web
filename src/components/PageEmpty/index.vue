<script setup lang="ts">
/**
 * 空状态（全站统一，对齐原型 5185 PageEmpty）：插画 + 主文案 + 可选说明 + 默认插槽放一个主操作。
 * 规范（10-交接文档/09-交互、动效与状态.md）：空态 = 图标 + 标题 + 一句说明 + 一个主操作，不堆多个按钮。
 *
 *   <PageEmpty text="还没有任务" description="生成的图片和视频会出现在这里">
 *     <button class="sx-btn-primary" @click="go">去生成</button>
 *   </PageEmpty>
 *
 * compact：用在列表栏 / 卡片里，插画缩小一半、上下留白收紧。
 */
import EmptyIllustration from '@/components/EmptyIllustration/index.vue'

withDefaults(defineProps<{ text?: string; description?: string; compact?: boolean }>(), {
  text: '暂无数据',
  description: '',
  compact: false,
})
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center text-center" :class="compact ? 'py-16px' : 'py-32px'" role="status">
    <EmptyIllustration :class="compact ? 'w-137px h-73px' : 'w-274px h-146px max-w-full'" />
    <p class="m-0 text-ink-2" :class="compact ? 'mt-10px text-13px leading-20px' : 'mt-16px text-15px leading-22px'">{{ text }}</p>
    <p v-if="description" class="m-0 mt-4px max-w-360px text-12px leading-18px text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-14px flex items-center gap-8px">
      <slot />
    </div>
  </div>
</template>
