<script setup lang="ts">
/**
 * 每日签到入口。签到是阶段性活动，开关在后台「签到设置」，由 GET /api/v1/users/check-in 的 enabled 下发。
 *
 * <p>状态没拿到或 enabled=false 时整个组件什么都不渲染，也不会调 POST。
 * 页面回到前台时重新读一次状态，后台关掉开关后入口随之消失。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NPopover } from 'naive-ui'
import { checkInStatus, checkInSubmit, type ICheckInResult, type ICheckInStatus } from '@/api/check-in'
import { useUserInfoStore } from '@/stores/user-info.ts'

const props = withDefaults(defineProps<{ placement?: 'right-end' | 'top-start' | 'top-end' }>(), {
  placement: 'right-end',
})

const FOCUS = 'focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)'
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

const userStore = useUserInfoStore()
const status = ref<ICheckInStatus | null>(null)
const open = ref(false)
const submitting = ref(false)
const result = ref<ICheckInResult | null>(null)

const enabled = computed(() => status.value?.enabled === true)
const done = computed(() => status.value?.todayCheckedIn === true)
const label = computed(() => (done.value ? '今日已签到' : '每日签到'))

const days = computed(() =>
  (status.value?.recentDays ?? []).map((d, i, arr) => {
    // date 是 yyyy-MM-dd，按本地日期解析，避免被当成 UTC 零点
    const [y, m, day] = d.date.split('-').map(Number)
    const dt = new Date(y ?? 0, (m ?? 1) - 1, day ?? 1)
    return { ...d, week: i === arr.length - 1 ? '今天' : `周${WEEK[dt.getDay()]}` }
  }),
)

async function loadStatus() {
  try {
    const res = await checkInStatus()
    status.value = res.data ?? null
  } catch {
    status.value = null
  }
}

async function submit() {
  if (!enabled.value || done.value || submitting.value) return
  submitting.value = true
  try {
    const res = await checkInSubmit()
    result.value = res.data
    void userStore.updateUserInfo()
  } catch {
    // 后端原因（已签到、活动已关闭等）已由拦截器提示
  } finally {
    submitting.value = false
    await loadStatus()
  }
}

function onShow(show: boolean) {
  open.value = show
  if (show) {
    result.value = null
    void loadStatus()
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void loadStatus()
}
onMounted(() => {
  void loadStatus()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
</script>

<template>
  <n-popover
    v-if="enabled"
    trigger="click"
    :show="open"
    :placement="props.placement"
    :show-arrow="false"
    raw
    @update:show="onShow"
  >
    <template #trigger>
      <button
        type="button"
        class="relative grid h-32px w-32px flex-none place-items-center rounded-md border border-solid border-transparent bg-transparent p-0 cursor-pointer hover:(bg-surface3 text-ink)"
        :class="[FOCUS, done ? 'text-muted' : 'text-violet']"
        :aria-label="label"
        :title="label"
        aria-haspopup="dialog"
        :aria-expanded="open"
      >
        <svg
          class="h-18px w-18px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="5.5" width="16" height="14" rx="2" />
          <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
          <path d="m9.5 14.5 2 2 3.5-3.5" />
        </svg>
        <span
          v-if="!done"
          class="absolute right-3px top-3px h-6px w-6px rounded-full border border-solid border-white bg-danger"
          aria-hidden="true"
        />
      </button>
    </template>

    <div
      class="flex w-300px flex-col gap-12px rounded-10px border border-solid border-line bg-white p-14px shadow-pop"
      role="dialog"
      aria-label="每日签到"
    >
      <div class="flex items-baseline gap-8px">
        <b class="text-14px font-600 text-ink">每日签到</b>
        <span class="text-12px text-muted">
          已连续签到 <b class="font-600 text-violet-ink tabular-nums">{{ status?.consecutiveDays ?? 0 }}</b> 天
        </span>
      </div>

      <ul v-if="days.length" class="m-0 grid list-none grid-cols-7 gap-4px p-0">
        <li
          v-for="d in days"
          :key="d.date"
          class="flex flex-col items-center gap-2px rounded-6px border border-solid py-6px"
          :class="
            d.checkedIn ? 'border-violet-line bg-violet-soft text-violet-ink' : 'border-line bg-surface2 text-muted'
          "
        >
          <span class="text-10px leading-14px">{{ d.week }}</span>
          <span class="text-11px font-600 leading-16px tabular-nums">{{
            d.checkedIn ? `+${d.rewardPoints}` : '—'
          }}</span>
          <span class="sr-only">{{ d.date }}{{ d.checkedIn ? '已签到' : '未签到' }}</span>
        </li>
      </ul>

      <p
        v-if="result"
        class="m-0 rounded-6px bg-success-soft px-10px py-8px text-12px leading-18px text-success"
        role="status"
      >
        签到成功，获得 {{ result.rewardPoints }} 点，已连续 {{ result.consecutiveDays }} 天。<br />
        当前余额 {{ result.balanceAfter }} 点，明天签到可得 {{ result.nextRewardPoints }} 点。
      </p>
      <p v-else-if="done" class="m-0 text-12px leading-18px text-muted">
        今天已签到，明天签到可得 {{ status?.nextRewardPoints ?? 0 }} 点。
      </p>
      <p v-else class="m-0 text-12px leading-18px text-muted">今天签到可得 {{ status?.nextRewardPoints ?? 0 }} 点。</p>

      <button type="button" class="sx-btn-primary w-full" :disabled="done || submitting" @click="submit">
        {{ submitting ? '签到中…' : done ? '今日已签到' : '立即签到' }}
      </button>
    </div>
  </n-popover>
</template>
