<script setup lang="ts">
/**
 * Workbench 三栏模式的预览区内容（原型 ToolPreviewPanel 的「当前结果」段）：放进 Workbench 的 `#preview` 插槽，
 * 展示历史列选中的那一条——进行中骨架 / 失败原因 / 成品图（可放大、逐张下载）/ 成品视频（播放 + 下载）。
 *
 * <p>只负责展示；选中哪条、删除、轮询都在页面。`active=false`（还没有任何记录）时显示空态。
 * 下载钮常驻（不靠悬停，规范 §10.2），压在图上用 overlay 变体，头部同排钮间距 8。
 */
import { NImage, NImageGroup } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import { formatTime } from '../../constants.ts'

type Status = 'running' | 'success' | 'error' | 'warning'

const {
  active,
  title = '',
  status = 'success',
  statusLabel = '',
  time,
  images = [],
  video = '',
  poster = '',
  failReason = '',
  runningText = '正在生成，完成后会自动显示在这里',
  emptyText = '还没有记录，左侧填好内容后点底部按钮开始生成',
  ratio = '',
} = defineProps<{
  /** 是否有选中的记录；false 显示空态 */
  active: boolean
  title?: string
  status?: Status
  statusLabel?: string
  /** 创建时间（毫秒） */
  time?: number
  images?: string[]
  video?: string
  /** 视频封面 */
  poster?: string
  failReason?: string
  runningText?: string
  emptyText?: string
  /** 进行中骨架的宽高比（如 3/4、9/16），不传按 3/4 */
  ratio?: string
}>()

defineSlots<{ meta?: () => unknown; actions?: () => unknown }>()

const CHIP: Record<Status, string> = {
  running: 'll-chip-running',
  success: 'll-chip-success',
  error: 'll-chip-error',
  warning: 'll-chip-warning',
}
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <div v-if="!active" class="flex-1 grid place-items-center p-16px">
      <div class="sx-empty w-full max-w-420px">
        <span class="sx-empty-title">生成结果</span>
        <span class="sx-empty-desc">{{ emptyText }}</span>
      </div>
    </div>

    <template v-else>
      <header class="flex-none flex items-center gap-8px min-h-56px px-16px py-12px box-border border-b border-b-solid border-b-line-soft">
        <div class="min-w-0 flex-1 flex flex-col gap-2px">
          <h2 class="m-0 truncate text-14px font-600 leading-20px text-ink" :title="title">{{ title }}</h2>
          <span class="flex items-center gap-8px min-w-0 text-11px leading-16px text-muted tabular-nums">
            <span v-if="statusLabel" class="sx-chip flex-none" :class="CHIP[status]">{{ statusLabel }}</span>
            <span class="flex-none">{{ formatTime(time) }}</span>
            <slot name="meta"></slot>
          </span>
        </div>
        <span class="flex-none flex items-center gap-8px">
          <IconButton v-if="status === 'success' && video" label="下载视频" :href="video" target="_blank" download>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </IconButton>
          <slot name="actions"></slot>
        </span>
      </header>

      <div class="flex-1 min-h-0 overflow-auto p-16px [scrollbar-width:thin]">
        <div v-if="status === 'running'" class="flex flex-col items-center gap-10px">
          <div
            class="w-full max-w-320px rounded-lg bg-sunken animate-pulse motion-reduce:animate-none"
            :style="{ aspectRatio: ratio || '3 / 4' }"
            aria-hidden="true"
          />
          <p class="m-0 text-12px leading-18px text-muted" role="status">{{ runningText }}</p>
        </div>

        <div
          v-else-if="status === 'error'"
          class="flex items-start gap-8px p-12px rounded-lg border border-solid border-danger-line bg-danger-soft text-13px leading-20px text-alert-danger"
          role="status"
        >
          {{ failReason || '生成失败，点数已按规则退回' }}
        </div>

        <template v-else>
          <video
            v-if="video"
            :src="video"
            :poster="poster || undefined"
            controls
            preload="metadata"
            class="block w-full max-h-[calc(100vh-220px)] rounded-lg bg-black object-contain"
          />
          <NImageGroup v-else-if="images.length">
            <div class="grid gap-12px" :class="images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
              <div
                v-for="(url, i) in images"
                :key="url"
                class="relative min-w-0 overflow-hidden rounded-lg border border-solid border-line bg-surface3"
              >
                <NImage
                  :src="url"
                  :alt="`${title} 第 ${i + 1} 张`"
                  class="block w-full"
                  :img-props="{ class: 'block w-full h-auto', alt: `${title} 第 ${i + 1} 张` }"
                />
                <span class="absolute top-8px right-8px">
                  <IconButton :label="`下载第 ${i + 1} 张`" variant="overlay" :href="url" target="_blank" download>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                    </svg>
                  </IconButton>
                </span>
              </div>
            </div>
          </NImageGroup>
          <p v-else class="m-0 ll-empty py-24px">任务已完成，但没有返回产物地址</p>
        </template>
      </div>
    </template>
  </div>
</template>
