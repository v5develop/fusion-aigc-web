<script setup lang="ts">
/**
 * 产物转存素材库状态的小字提示（结果图下方）：pending =「保存到素材库中…」，failed =「未能保存到素材库」。
 * 只是说明，不挡操作——产物照常可看、可下载；转存失败没有重试接口，不放按钮。
 */
import { LIBRARY_FAILED_HINT, LIBRARY_PENDING_HINT, normalizeLibraryStatus } from './library-status.ts'

const { status } = defineProps<{ status?: string }>()
</script>

<template>
  <!-- 外层常驻作 live region：状态从 pending 变 failed / 变空时读屏能播报（v-if 整块插入的 region 多数读屏不播） -->
  <div role="status" aria-live="polite">
    <div
      v-if="normalizeLibraryStatus(status) === 'pending'"
      class="flex items-center gap-4px mt-6px text-muted text-11px leading-16px"
      title="产物已可查看和下载，正在后台保存到素材库，通常几秒内完成"
    >
      <span
        class="shrink-0 w-10px h-10px border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-1000 motion-reduce:animate-none"
        aria-hidden="true"
      />
      {{ LIBRARY_PENDING_HINT }}
    </div>
    <div
      v-else-if="normalizeLibraryStatus(status) === 'failed'"
      class="flex items-center gap-4px mt-6px text-warning text-11px leading-16px"
      title="产物仍可查看和下载，但素材库里没有这条"
    >
      <span class="shrink-0 w-6px h-6px rounded-full bg-warning" aria-hidden="true" />
      {{ LIBRARY_FAILED_HINT }}，仍可查看和下载
    </div>
  </div>
</template>
