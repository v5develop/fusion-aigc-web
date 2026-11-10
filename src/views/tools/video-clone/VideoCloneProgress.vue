<script setup lang="ts">
/**
 * 解析四步：上传 / 抽帧 + 音轨 / 看画面 / 标维度（由后端 stage 映射）；进行中显示阶段说明与进度，
 * 失败显示后端给的中文原因，可重试时给「重新解析」，并给「直接出片」的退路。
 */
import { computed } from 'vue'
import { VC_STEPS } from '../video-clone/constants'
import type { VideoCloneState } from '../video-clone/useVideoClone'

const props = defineProps<{ state: VideoCloneState; disabled?: boolean }>()
const emit = defineEmits<{ skip: [] }>()

const stepState = (i: number) => {
  const s = props.state
  if (s.ready) return 'done'
  if (s.failed) return i < s.step ? 'done' : i === s.step ? 'error' : 'todo'
  return i < s.step ? 'done' : i === s.step ? 'on' : 'todo'
}
const reused = computed(() => props.state.ready && props.state.view?.reused)
</script>

<template>
  <div class="flex flex-col gap-8px">
    <ol class="m-0 p-0 list-none flex flex-wrap items-center gap-6px" aria-label="解析进度">
      <li
        v-for="(label, i) in VC_STEPS"
        :key="label"
        class="inline-flex items-center gap-4px h-26px box-border px-10px rounded-full border border-solid text-12px whitespace-nowrap"
        :class="{
          'border-violet-line text-violet-ink': stepState(i) === 'done',
          'border-violet bg-violet-soft text-violet-ink font-600': stepState(i) === 'on',
          'border-danger-line bg-danger-soft text-danger font-600': stepState(i) === 'error',
          'border-line text-placeholder': stepState(i) === 'todo',
        }"
        :aria-current="stepState(i) === 'on' ? 'step' : undefined"
      >
        <svg
          v-if="stepState(i) === 'done'"
          class="w-11px h-11px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <span
          v-else-if="stepState(i) === 'on'"
          class="block w-10px h-10px box-border rounded-full border-1.5px border-solid border-violet-line border-t-violet animate-spin [animation-duration:800ms] motion-reduce:animate-none"
          aria-hidden="true"
        />
        {{ label }}
        <span class="sr-only">{{
          { done: '（已完成）', on: '（进行中）', error: '（失败）', todo: '' }[stepState(i)]
        }}</span>
      </li>
    </ol>

    <div v-if="state.running" class="flex flex-col gap-6px" role="status" aria-live="polite">
      <p class="m-0 flex items-center gap-8px text-12px leading-18px text-muted">
        <span>{{ state.stageText }}</span>
        <span v-if="state.progress !== null" class="ml-auto tabular-nums text-violet-ink">{{ state.progress }}%</span>
      </p>
      <div
        class="h-4px overflow-hidden rounded-full bg-surface3"
        role="progressbar"
        aria-label="解析进度"
        :aria-valuenow="state.progress ?? undefined"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full sx-grad-progress [transition:width_.4s_ease] motion-reduce:transition-none"
          :style="{ width: `${Math.max(state.progress ?? 4, 4)}%` }"
        />
      </div>
      <p class="m-0 text-11px leading-16px text-placeholder">只解析一次，之后标维度不用再等；解析不扣点数</p>
    </div>

    <div
      v-if="state.pollPaused"
      class="flex flex-wrap items-center gap-8px p-10px box-border rounded-12px border border-solid border-warning-line bg-warning-soft"
      role="alert"
    >
      <span class="flex-1 min-w-0 text-12px leading-18px text-alert-warning">网络不稳，暂时拿不到解析进度</span>
      <button type="button" class="sx-btn !h-32px !px-10px !text-12px" @click="state.resumePolling()">继续查询</button>
    </div>

    <div
      v-else-if="state.failed"
      class="flex flex-col gap-8px p-10px box-border rounded-12px border border-solid border-danger-line bg-danger-soft"
      role="alert"
    >
      <p class="m-0 text-12px leading-18px text-alert-danger">{{ state.errorText }}</p>
      <div class="flex flex-wrap items-center gap-8px">
        <button
          v-if="state.canRetry"
          type="button"
          class="sx-btn-primary !h-32px !px-12px !text-12px"
          :disabled="disabled"
          @click="state.retry()"
        >
          重新解析
        </button>
        <button type="button" class="sx-btn !h-32px !px-10px !text-12px" :disabled="disabled" @click="emit('skip')">
          不解析，直接出片
        </button>
      </div>
    </div>

    <p v-else-if="reused" class="m-0 text-11px leading-16px text-placeholder">这条原片之前解析过，直接用上次的结果</p>
  </div>
</template>
