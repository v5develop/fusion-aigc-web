<script setup lang="ts">
/**
 * 外观选项卡里的缩略界面：用 data-theme 把这一小块锁成浅色或深色，颜色全部取全站令牌，
 * 所以它就是切换后真实的样子（侧栏 / 卡片 / 正文 / 主按钮 / 标签）。中间那张「图」是固定色块——
 * 图片内容不随主题变，这里也一样。
 */
defineProps<{ theme: 'light' | 'dark' }>()
</script>

<template>
  <div :data-theme="theme" class="flex bg-page text-ink" aria-hidden="true">
    <div class="w-[22%] flex flex-col gap-4px p-5px bg-surface border-r border-r-solid border-shell-line">
      <span class="h-5px w-[70%] rounded-pill bg-violet/70" />
      <span class="mt-3px h-4px w-[85%] rounded-pill bg-ink/20" />
      <span class="h-6px w-full rounded-3px bg-violet-soft border border-solid border-violet-line" />
      <span class="h-4px w-[75%] rounded-pill bg-ink/20" />
      <span class="h-4px w-[80%] rounded-pill bg-ink/20" />
    </div>
    <div class="flex-1 p-6px flex flex-col gap-5px min-w-0">
      <div class="flex-1 flex gap-5px p-5px rounded-6px bg-surface border border-solid border-line shadow-card-v3">
        <span class="w-[42%] rounded-4px bg-[linear-gradient(135deg,#e9c9a8,#c98f6b_55%,#8d5a48)]" />
        <span class="flex-1 flex flex-col gap-3px min-w-0">
          <span class="h-5px w-[80%] rounded-pill bg-ink/85" />
          <span class="h-3px w-full rounded-pill bg-ink-2/45" />
          <span class="h-3px w-[70%] rounded-pill bg-muted/40" />
          <span class="mt-auto self-start h-5px w-[45%] rounded-pill bg-success-soft border border-solid border-success-line" />
        </span>
      </div>
      <div class="flex items-center gap-4px">
        <span class="flex-1 h-9px rounded-4px bg-surface border border-solid border-control" />
        <span class="w-[34%] h-9px rounded-4px sx-grad-primary border border-solid border-violet-border" />
      </div>
    </div>
  </div>
</template>
