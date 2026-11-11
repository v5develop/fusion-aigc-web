<script setup lang="ts">
/**
 * 产物转存素材库状态的小字提示（结果图下方）：pending =「保存到素材库中…」，failed =「未能保存到素材库」。
 * 只是说明，不挡操作——产物照常可看、可下载。failed 且调用方给了 retry 时附「重新存入素材库」按钮（契约 3.4.3）：
 * retry 负责调接口、把返回的 pending 写回并接上原有的转存轮询，按钮自己管加载态与 4002 提示。
 */
import LibraryRetryButton from '@/components/LibraryRetryButton/index.vue'
import { LIBRARY_FAILED_HINT, LIBRARY_PENDING_HINT, normalizeLibraryStatus } from './library-status.ts'

const { status, retry } = defineProps<{ status?: string; retry?: () => Promise<unknown> }>()
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
      class="flex flex-wrap items-center gap-x-8px gap-y-6px mt-6px"
    >
      <span
        class="inline-flex items-center gap-4px text-warning text-11px leading-16px"
        title="产物仍可查看和下载，但素材库里没有这条"
      >
        <span class="shrink-0 w-6px h-6px rounded-full bg-warning" aria-hidden="true" />
        {{ LIBRARY_FAILED_HINT }}，仍可查看和下载
      </span>
      <LibraryRetryButton v-if="retry" size="sm" :action="retry" />
    </div>
  </div>
</template>
