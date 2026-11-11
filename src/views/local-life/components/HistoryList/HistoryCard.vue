<script setup lang="ts">
/**
 * 历史卡（规范 §10.3，原型 StudioHistoryColumn `.v3-hist__card`；与工具页 / 电商 HistoryColumn 同一套材质）：
 * 最小高 74（失败带原因时自然变高，不重叠）、r18 squircle、缩略 44 / r14（多张 3/6px 叠影 + 张数角标）、
 * 第一行 13/18 单行截断，第二行：进行中 = 4px 进度条 + 百分比，已完成 = 时间，其它终态 = 状态胶囊（状态只出现一次）；
 * 操作钮放第二行右侧（#actions 插槽，用 IconButton size="sm"，间距 8 由这里给）。
 * 可选摘要行（`summary` 或 #summary 插槽，如文案正文 / 笔记正文）：夹在标题与状态行之间，11/15 单行省略；
 * 有摘要时标题行高收到 17、状态行收到 20，三行正好塞进 74 高的卡（内容区 52），不撑高卡片。不传则与之前完全一致。
 *
 * <p>整卡选中用铺满的透明按钮（卡内还有操作钮，按钮里不能再套按钮）；选中后通知 Workbench 在 <1440 时切回「生成结果」。
 * 本地生活列表没有真实进度：不传 progress 时按 startedAt + etaSec 渐近外推（6% 起、永远 < 90%），文字标「约」，
 * 超过预计耗时改说「仍在生成」（只是估算，不冲到 95% 卡住）。
 */
import { computed, inject, ref, watchEffect } from 'vue'
import { formatFullTime, formatShortTime } from '@/utils/time.ts'
import { LL_WORKBENCH_KEY } from '../Workbench/context.ts'
import { ossResize, thumbFallback } from '@/utils/oss'

type Status = 'running' | 'success' | 'error' | 'warning'

const {
  title,
  status,
  statusLabel,
  time,
  thumb = '',
  placeholder = '—',
  count = 0,
  progress,
  etaSec = 90,
  failReason = '',
  summary = '',
  selected = false,
} = defineProps<{
  /** 第一行（提示词 / 内容摘要 / 功能名） */
  title: string
  status: Status
  /** 状态文案（生成中 / 失败 / 待确认…），胶囊与读屏用 */
  statusLabel: string
  /** 创建时间（毫秒） */
  time?: number
  /** 缩略图地址（只放图片；视频成品传封面或输入图） */
  thumb?: string
  /** 没有缩略图时缩略块里的字 */
  placeholder?: string
  /** 产物张数：≥2 显示叠影与角标 */
  count?: number
  /** 真实进度 0–100；不传则按 time + etaSec 估算 */
  progress?: number
  /** 估算进度用的预计耗时（秒） */
  etaSec?: number
  /** 失败原因：失败时显示在第二行下面（最多两行） */
  failReason?: string
  /** 摘要行（第二行，单行省略）；也可用 #summary 插槽 */
  summary?: string
  selected?: boolean
}>()

const emit = defineEmits<{ select: [] }>()
const slots = defineSlots<{ actions?: () => unknown; summary?: () => unknown }>()
/** 插槽不是响应式的，按渲染时求值，不做 computed 缓存 */
const hasSummary = () => !!summary || !!slots.summary
/** 读屏名 / 悬停提示里的摘要只取前 60 字（正文可能很长） */
const summaryShort = computed(() => {
  const text = summary || '' // 接口偶有 null，防一手
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
})

const workbench = inject(LL_WORKBENCH_KEY, undefined)

function onSelect() {
  emit('select')
  workbench?.revealPreview()
}

// 估算进度要随时间走：只在「进行中且没有真实进度」时每 2s 刷一次
const now = ref(Date.now())
watchEffect((onCleanup) => {
  if (status !== 'running' || progress !== undefined || !time) return
  now.value = Date.now()
  const id = setInterval(() => (now.value = Date.now()), 2000)
  onCleanup(() => clearInterval(id))
})

/** 没有真实进度、只能按耗时估 */
const estimated = computed(() => progress === undefined)
/** 已用时 / 预计耗时 */
const elapsedRatio = computed(() => (time ? (now.value - time) / (Math.max(1, etaSec) * 1000) : 0))

/**
 * 估算进度走渐近曲线 6 + 84·(1 − e^(−t/eta))：到预计耗时约 59%、两倍约 79%，越往后越慢、永远到不了 90，
 * 不会冲到 95% 后一动不动（那种「卡在 95」比慢更让人以为坏了）。真实进度原样显示。
 */
const percent = computed(() => {
  if (progress !== undefined) return Math.min(100, Math.max(0, Math.round(progress)))
  if (!time) return 6
  return Math.round(6 + 84 * (1 - Math.exp(-Math.max(0, elapsedRatio.value))))
})

/** 进度旁的字：真实进度写百分比；估算的写「约 n%」，超过预计耗时改说「仍在生成」，不假装快好了 */
const percentText = computed(() => {
  if (!estimated.value) return `${percent.value}%`
  return elapsedRatio.value > 1 ? '仍在生成' : `约 ${percent.value}%`
})

/** 历史卡空间窄：今天 HH:mm / 同年 MM-DD / 跨年 YYYY-MM-DD，完整时间放悬停提示 / 读屏名 */
const fullTime = computed(() => formatFullTime(time))
const shortTime = computed(() => formatShortTime(time))

const CHIP: Record<Status, string> = {
  running: 'bg-info-soft text-violet-ink',
  success: 'bg-success-soft text-success',
  error: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
}
const DOT: Record<Status, string> = {
  running: 'bg-violet',
  success: 'bg-success',
  error: 'bg-danger',
  warning: 'bg-warning',
}
</script>

<template>
  <li class="min-w-0">
    <div
      class="group relative flex items-stretch gap-10px box-border min-h-74px p-10px rounded-18px sx-squircle border border-solid [transition:border-color_110ms,background_110ms,box-shadow_110ms] motion-reduce:transition-none"
      :class="
        selected
          ? 'border-violet-line bg-[linear-gradient(180deg,#ffffff_0%,#faf4fd_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05),inset_0_1px_0_#fff]'
          : 'border-line bg-white hover:(border-control-hover shadow-[0_8px_18px_rgba(31,35,41,0.08)])'
      "
    >
      <button
        type="button"
        class="absolute inset-0 w-full h-full p-0 rounded-18px border-none bg-transparent cursor-pointer sx-focus"
        :aria-pressed="selected"
        :aria-label="`${fullTime} ${statusLabel}：${title}${summaryShort ? '，' + summaryShort : ''}`"
        :title="[`${fullTime} · ${title}`, summaryShort, failReason].filter(Boolean).join('\n')"
        @click="onSelect"
      />

      <!-- 缩略 44 / r14（内图同心 r13）；进行中且没图时是骨架 -->
      <span
        v-if="status === 'running' && !thumb"
        class="flex-none w-44px h-44px self-center rounded-14px bg-sunken animate-pulse motion-reduce:animate-none pointer-events-none"
        aria-hidden="true"
      />
      <span
        v-else
        class="relative flex-none grid place-items-center w-44px h-44px self-center box-border rounded-14px border border-solid border-line bg-surface3 text-placeholder pointer-events-none"
        :class="
          count >= 3
            ? 'shadow-[3px_-3px_0_-1px_var(--xq-surface),3px_-3px_0_0_var(--xq-line),6px_-6px_0_-1px_var(--xq-surface),6px_-6px_0_0_var(--xq-line)]'
            : count === 2
              ? 'shadow-[3px_-3px_0_-1px_var(--xq-surface),3px_-3px_0_0_var(--xq-line)]'
              : ''
        "
        aria-hidden="true"
      >
        <img
          v-if="thumb"
          :src="ossResize(thumb, 44, 44)"
          alt=""
          loading="lazy"
          decoding="async"
          @error="(e: Event) => thumbFallback(e, thumb)"
          class="absolute inset-0 block h-full w-full rounded-13px object-cover object-center"
        />
        <span v-else class="text-11px">{{ placeholder }}</span>
        <span
          v-if="count > 1"
          class="absolute z-2 -top-4px -right-4px grid min-w-16px h-16px box-border place-items-center px-4px rounded-full border border-solid border-white bg-ink text-10px font-600 leading-none text-surface"
          >{{ count }}</span
        >
      </span>

      <span class="min-w-0 flex-1 flex flex-col justify-between" :class="hasSummary() ? 'gap-0' : 'gap-2px'">
        <span
          class="truncate text-13px pointer-events-none"
          :class="[status === 'error' ? 'text-danger' : 'text-ink', hasSummary() ? 'leading-17px' : 'leading-18px']"
          >{{ title }}</span
        >
        <span v-if="hasSummary()" class="truncate text-11px leading-15px text-muted pointer-events-none">
          <slot name="summary">{{ summary }}</slot>
        </span>
        <span class="flex items-center gap-6px min-w-0" :class="hasSummary() ? 'h-20px' : 'h-24px'">
          <!-- 进行中：4px 进度条（轨 #eceef0 内凹，紫渐变填充）+ 百分比 11/600 -->
          <template v-if="status === 'running'">
            <span
              class="relative flex-1 min-w-12px h-4px rounded-full bg-ghost-press shadow-[inset_0_1px_1px_rgba(31,35,41,0.06)] overflow-hidden pointer-events-none"
              role="progressbar"
              :aria-valuenow="percent"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuetext="estimated ? `估算进度，${percentText}` : undefined"
              :aria-label="statusLabel"
            >
              <span
                class="absolute inset-y-0 left-0 rounded-full sx-grad-progress [transition:width_160ms_linear] motion-reduce:transition-none"
                :style="{ width: `${percent}%` }"
              />
            </span>
            <span class="flex-none text-11px font-600 leading-16px text-violet-ink tabular-nums pointer-events-none">{{
              percentText
            }}</span>
          </template>
          <span
            v-else-if="status === 'success'"
            class="min-w-0 truncate text-11px leading-16px text-muted tabular-nums whitespace-nowrap pointer-events-none"
            :title="fullTime"
            >{{ shortTime }}</span
          >
          <span
            v-else
            class="flex-none inline-flex items-center h-18px px-7px rounded-full text-11px leading-none whitespace-nowrap pointer-events-none"
            :class="CHIP[status]"
          >
            <i class="w-5px h-5px rounded-full mr-4px" :class="DOT[status]" aria-hidden="true"></i>{{ statusLabel }}
          </span>
          <span v-if="$slots.actions" class="relative z-1 ml-auto flex flex-none items-center gap-8px">
            <slot name="actions"></slot>
          </span>
        </span>
        <span
          v-if="status === 'error' && failReason"
          class="line-clamp-2 text-11px leading-15px text-danger pointer-events-none"
          >{{ failReason }}</span
        >
      </span>
    </div>
  </li>
</template>
