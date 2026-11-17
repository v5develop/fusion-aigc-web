<script setup lang="ts">
/**
 * 视频做同款（/local-life/video-replicate）：把爆款视频换成你的人和商品，三步出片。
 * 上传视频 → 选要换的 → 确认生成（多段默认先做第 1 段，满意再继续）；接口见 api/replicate.ts（Go 原生，未就绪时 `?mock=replicate`）。
 * 页面只负责编排步骤：状态与动作在 useReplicate，各步骤是同目录的 Step* / JobView；页头二级导航：新建 / 历史 / 我的方案。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { REPLICATE_SKILL_ID } from '@/api/agent.ts'
import HistoryList from './HistoryList.vue'
import JobView from './JobView.vue'
import SavedPlans from './SavedPlans.vue'
import StepAnalyzing from './StepAnalyzing.vue'
import StepPlan from './StepPlan.vue'
import StepStart from './StepStart.vue'
import { useReplicate, type Tab } from './useReplicate.ts'
import './video-replicate.css'

const rep = useReplicate()
const route = useRoute()
const tab = rep.tab
const TABS: { k: Tab; l: string }[] = [
  { k: 'new', l: '新建' },
  { k: 'hist', l: '历史' },
  { k: 'saved', l: '我的方案' },
]
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

onMounted(() => {
  void rep.loadLimits()
  void rep.initSamples()
  const j = route.query.job
  if (typeof j === 'string' && j) void rep.openJob(j)
  else void openPlanFromQuery()
})

/** 对话里的方案深链 ?plan=<planNo>：进入方案步骤；过期 / 已改过 / 找不到 → 提示后照常从头开始 */
const planHint = ref('')
async function openPlanFromQuery() {
  const p = route.query.plan
  const no = Array.isArray(p) ? p[0] : p
  if (typeof no !== 'string' || !no) return
  planHint.value = (await rep.openPlan(no)) || ''
}

// 通知 / 外部链接在本页内换 ?job=：重新打开该任务（首次进入由 onMounted 处理）
watch(
  () => route.query.job,
  (j, old) => {
    if (typeof j === 'string' && j && j !== old) {
      tab.value = 'new'
      void rep.openJob(j)
    }
  },
)

/** 步骤条：上传视频 → 选要换的 → 确认生成（生成与交付属于第三步之后） */
const current = computed(() => ({ start: 0, analyzing: 1, plan: 2, job: 3 })[rep.step.value])
const STEPS = ['上传视频', '选要换的', '确认生成']

function openFromHistory(id: number | string) {
  tab.value = 'new'
  void rep.openJob(id)
}

const maxSec = computed(() => rep.limits.value?.maxDurationSec ?? 80)
</script>

<template>
  <div class="mx-auto flex w-full max-w-880px flex-col gap-14px px-16px pb-40px pt-24px max-sm:px-12px">
    <header>
      <h1 class="m-0 text-26px font-600 leading-36px tracking-[.02em] text-ink">
        {{ rep.step.value === 'start' ? '上传一条想做同款的视频' : '视频做同款' }}
      </h1>
      <p class="m-0 mt-6px text-13px leading-20px text-muted">把爆款视频换成你的人和商品，三步出片</p>
      <p v-if="planHint" class="m-0 mt-6px rounded-10px bg-surface2 px-12px py-8px text-12px text-ink-2" role="status">
        {{ planHint }}
      </p>
      <p v-if="rep.step.value === 'start'" class="m-0 mt-2px text-11px text-placeholder">
        MP4 / MOV，最长 {{ maxSec }} 秒，300MB 以内
      </p>
      <p
        v-if="rep.notReady.value"
        class="m-0 mt-6px rounded-10px bg-surface2 px-12px py-8px text-12px text-ink-2"
        role="status"
      >
        {{ rep.notReadyText.value }}
      </p>
      <div class="mt-10px flex flex-wrap items-center gap-8px">
      <div class="flex gap-8px" role="tablist" aria-label="视频做同款">
        <button
          v-for="t in TABS"
          :key="t.k"
          type="button"
          role="tab"
          :aria-selected="tab === t.k"
          :class="[
            'h-32px rounded-16px border border-solid px-14px text-12px cursor-pointer select-none',
            tab === t.k
              ? 'border-violet-line bg-violet-tint font-600 text-violet-ink'
              : 'border-soft-line bg-surface text-muted hover:text-ink',
            FOCUS,
          ]"
          @click="rep.tab.value = t.k"
        >
          {{ t.l }}
        </button>
      </div>
        <!-- 次要入口：换成跟智能体对话来做（复刻技能深链） -->
        <RouterLink
          :to="{ path: '/agent', query: { skill: REPLICATE_SKILL_ID } }"
          :class="[
            'ml-auto inline-flex h-32px items-center gap-6px rounded-16px border border-solid border-soft-line bg-surface px-14px text-12px text-muted no-underline hover:text-ink',
            FOCUS,
          ]"
        >
          <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
          用对话做
        </RouterLink>
      </div>
    </header>

    <template v-if="tab === 'new'">
      <ol class="m-0 flex list-none items-center gap-8px p-0 text-12px text-muted" aria-label="步骤">
        <template v-for="(l, i) in STEPS" :key="l">
          <li v-if="i" class="h-1px w-20px bg-line-strong" aria-hidden="true" />
          <li
            :class="['flex items-center gap-6px', i === Math.min(current, 2) ? 'font-600 text-ink' : '']"
            :aria-current="i === Math.min(current, 2) ? 'step' : undefined"
          >
            <span
              :class="[
                'grid h-18px w-18px place-items-center rounded-full text-10px font-600',
                i < Math.min(current, 2)
                  ? 'bg-success text-white'
                  : i === Math.min(current, 2)
                    ? 'bg-violet-solid text-white'
                    : 'bg-surface3 text-placeholder',
              ]"
            >
              {{ i < Math.min(current, 2) ? '✓' : i + 1 }}
            </span>
            {{ l }}
          </li>
        </template>
      </ol>

      <StepStart v-if="rep.step.value === 'start'" :rep="rep" />
      <StepAnalyzing v-else-if="rep.step.value === 'analyzing'" :rep="rep" />
      <StepPlan v-else-if="rep.step.value === 'plan'" :rep="rep" />
      <JobView v-else-if="rep.step.value === 'job' && rep.job.value" :rep="rep" />
      <div v-else-if="rep.step.value === 'job'" class="flex justify-center py-40px">
        <n-spin size="small" />
      </div>
    </template>
    <HistoryList v-else-if="tab === 'hist'" @open="openFromHistory" />
    <SavedPlans v-else :rep="rep" />
  </div>
</template>
