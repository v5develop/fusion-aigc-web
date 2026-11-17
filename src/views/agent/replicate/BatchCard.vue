<script setup lang="ts">
/**
 * 对话卡片：批量任务（CONTRACT §M）。头部总进度，每条一行小进度，点开某一行看那条的 JobCard（同一时间只展开一条）。
 * 只读：行摘要由 useBatchCard 低频刷新，展开的 JobCard 自己轮询；动作仍只是 emit send。
 */
import { computed, ref } from 'vue'
import type { ReplicateBatch, ReplicateCardFrame } from '@/api/replicate-card.ts'
import { fmtPts } from '@/views/video-replicate/constants.ts'
import JobCard from './JobCard.vue'
import { useBatchCard } from './useBatchCard.ts'

const props = defineProps<{ frame: ReplicateCardFrame; busy?: boolean; sourceUrl?: string }>()
const emit = defineEmits<{ (e: 'send', text: string): void; (e: 'draft', text: string): void }>()

const batch = computed(() => props.frame.view as ReplicateBatch)
const { rows, doneCount, failedCount } = useBatchCard(() => batch.value.jobs ?? [])
const total = computed(() => batch.value.total || rows.value.length)
const open = ref<number | null>(null)
const toggle = (id: number) => (open.value = open.value === id ? null : id)
const pct = (j: { segDone: number; segTotal: number }) => (j.segTotal > 0 ? Math.min(100, Math.round((j.segDone / j.segTotal) * 100)) : 0)
const tone = (s: string) => (s === 'failed' ? 'bg-danger' : s === 'succeeded' || s === 'partial' ? 'bg-success' : 'bg-violet')
/** 把行变成 JobCard 要的 frame（view 留空，JobCard 挂载后自己 GET） */
const jobFrame = (id: number): ReplicateCardFrame => ({ key: `job:${id}`, type: 'job', id: String(id), toolName: '', isError: false })
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="批量任务">
    <h3 class="vr-h3">批量 {{ total }} 条</h3>
    <p class="vr-sub" role="status">
      已结束 {{ doneCount }}/{{ total }} 条<template v-if="failedCount">，其中 {{ failedCount }} 条没做成</template>
    </p>
    <ul class="m-0 mt-8px flex list-none flex-col gap-6px p-0">
      <li v-for="(j, i) in rows" :key="j.jobId">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-8px rounded-10px border border-solid border-line bg-surface2 px-10px py-8px text-left"
          :aria-expanded="open === j.jobId"
          @click="toggle(j.jobId)"
        >
          <span class="w-20px flex-none text-12px font-600 tabular-nums text-muted">{{ i + 1 }}</span>
          <span class="flex min-w-0 flex-1 flex-col gap-4px">
            <span class="flex items-baseline gap-8px text-12px leading-18px">
              <b class="min-w-0 flex-1 truncate font-600 text-ink">{{ j.statusLabel }}</b>
              <span class="flex-none tabular-nums text-muted">{{ j.segDone }}/{{ j.segTotal }} 段</span>
            </span>
            <span class="block h-4px overflow-hidden rounded-2px bg-surface3" role="progressbar" :aria-valuenow="pct(j)" aria-valuemin="0" aria-valuemax="100">
              <i :class="['block h-full rounded-2px', tone(j.status)]" :style="{ width: `${pct(j)}%` }" />
            </span>
          </span>
          <span v-if="j.money?.confirmed" class="flex-none text-11px tabular-nums text-muted">{{ fmtPts(j.money.confirmed) }} 点</span>
          <svg :class="['h-14px w-14px flex-none text-muted transition-transform', open === j.jobId && 'rotate-180']" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div v-if="open === j.jobId" class="mt-6px">
          <JobCard :frame="jobFrame(j.jobId)" :busy="busy" :source-url="sourceUrl" @send="(t: string) => emit('send', t)" @draft="(t: string) => emit('draft', t)" />
        </div>
      </li>
    </ul>
  </section>
</template>
