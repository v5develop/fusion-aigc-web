<script setup lang="ts">
/**
 * 一条回复里的复刻卡片列表。key = entity.type + entity.id，由页面保证「同 key 只显示最新一帧、位置留在第一次出现处」（原位更新）。
 * 卡片自身不改任何业务状态：JobCard 的动作经 send 事件变成一条用户消息。
 */
import type { ReplicateAnalysis, ReplicateJob, ReplicatePlan, ReplicatePreview } from '@/api/replicate.ts'
import { CARD_ANCHOR_ATTR, type ReplicateCardFrame } from '@/api/replicate-card.ts'
import '@/views/video-replicate/video-replicate.css'
import AnalysisCard from './AnalysisCard.vue'
import JobCard from './JobCard.vue'
import PlanCard from './PlanCard.vue'
import PreviewCard from './PreviewCard.vue'

defineProps<{ frames: ReplicateCardFrame[]; busy?: boolean; sourceUrl?: string; latest?: boolean }>()
const emit = defineEmits<{ (e: 'send', text: string): void; (e: 'draft', text: string): void }>()
const anchor = (key: string) => ({ [CARD_ANCHOR_ATTR]: key })
</script>

<template>
  <div v-if="frames.length" class="flex flex-col gap-8px">
    <template v-for="f in frames" :key="f.key">
      <!-- 工具失败：一行紧凑的失败说明，不占卡片位 -->
      <div
        v-if="f.isError"
        class="flex max-w-480px items-start gap-8px rounded-12px bg-danger-soft px-12px py-8px text-12px leading-18px text-ink-2"
        role="alert"
      >
        <svg class="mt-2px h-14px w-14px flex-none text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
        <span class="min-w-0 flex-1 break-words">{{ f.error?.message }}<template v-if="f.error?.retryable">（可以再试一次）</template></span>
      </div>
      <div v-else-if="f.type" v-bind="anchor(f.key)">
        <AnalysisCard
          v-if="f.type === 'analysis'"
          :view="f.view as ReplicateAnalysis"
          :disabled="busy || !latest"
          @send="(t: string) => emit('send', t)"
        />
        <PreviewCard v-else-if="f.type === 'preview'" :view="f.view as ReplicatePreview" />
        <PlanCard v-else-if="f.type === 'plan'" :view="f.view as ReplicatePlan" />
        <JobCard
          v-else
          :frame="f"
          :busy="busy"
          :source-url="sourceUrl"
          @send="(t: string) => emit('send', t)"
          @draft="(t: string) => emit('draft', t)"
        />
      </div>
    </template>
  </div>
</template>
