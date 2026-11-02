<script setup lang="ts">
/**
 * 三栏工作台 · 右列预览区。
 *
 * <p>选中批次的详情：批次摘要（状态 chip / 进度 / 成功失败数 / 点数 / 时间）+
 * 任务网格（per-task 状态 / 进度 / result_url / error_reason，成品点 n-image 大图预览）。
 * 未选中 / 无历史时显示空态引导。在跑批次由 useStudioHistory 轮询，这里只做展示。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { studioCancelBatch, studioDeleteBatch } from '@/api/studio.ts'
import type { StudioBatchDetail, StudioTask } from '@/api/studioTypes.ts'
import type { useStudioHistory } from '../../hooks.ts'
import { KIND_LABEL, batchChip, batchProgress, formatTime, isBatchTerminal, taskCaption, taskChip } from '../../constants.ts'

const props = defineProps<{
  /** useStudioHistory 实例（游标分页 + 在跑批次轮询） */
  history: ReturnType<typeof useStudioHistory>
  /** 预览的批次；null = 显示空态引导（selectedId 有值但列表还没有它时显示加载态） */
  detail: StudioBatchDetail | null
  /** 是否有批次正在被选中但还没进列表（提交后刷新的瞬间） */
  pending?: boolean
}>()

const emit = defineEmits<{
  reedit: [payload: Record<string, unknown>, detail: StudioBatchDetail]
}>()

const message = useMessage()
const ctl = props.history

// ---------------- 操作 ----------------

const acting = ref(false)

async function cancelBatch(d: StudioBatchDetail) {
  if (acting.value) return
  acting.value = true
  try {
    const res = await studioCancelBatch(d.batch.id)
    message.success(`已取消 ${res.data?.canceled_tasks ?? 0} 个未开始任务，点数原路退回`)
    await ctl.refresh()
  } finally {
    acting.value = false
  }
}

async function removeBatch(d: StudioBatchDetail) {
  await studioDeleteBatch(d.batch.id)
  message.success('已删除')
  await ctl.refresh()
}

function reedit(d: StudioBatchDetail) {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(d.batch.payload || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad payload')
    payload = parsed as Record<string, unknown>
  } catch {
    message.error('该记录没有可回填的参数')
    return
  }
  emit('reedit', payload, d)
}

// ---------------- 展示辅助 ----------------

const summary = computed(() => {
  const d = props.detail
  if (!d) return null
  const chip = batchChip(d.batch.status)
  return {
    title: `${KIND_LABEL[d.batch.kind] ?? d.batch.kind}批次 #${d.batch.id}`,
    chip,
    done: d.batch.task_done,
    failed: d.batch.task_failed,
    total: d.batch.task_total,
    points: d.batch.estimated_points,
    time: formatTime(d.batch.created_at),
    progress: batchProgress(d.batch),
    running: !isBatchTerminal(d.batch.status),
    reason: d.batch.error_reason,
  }
})

/** 任务态是否展示为进行中（0 排队 / 1 生成中 / 5 交付中） */
const isTaskRunning = (task: StudioTask) => task.status === 0 || task.status === 1 || task.status === 5
</script>

<template>
  <div class="stu-scroll h-full px-16px py-14px overflow-y-auto [scrollbar-gutter:stable]">
    <!-- 加载态：选中的批次还没进已加载列表 -->
    <div v-if="pending && !detail" class="flex h-full items-center justify-center" v-loading="true" />

    <!-- 空态引导 -->
    <div v-else-if="!detail" class="flex h-full items-center justify-center">
      <div class="max-w-360px p-32px border border-dashed border-line-strong rounded-10px bg-[linear-gradient(#ffffff,#f7f8f9)] text-center">
        <svg class="w-36px h-36px text-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15l-5-5-11 11" />
        </svg>
        <p class="mt-10px mb-0 mx-0 text-13px font-600 text-ink-2">还没有可预览的批次</p>
        <p class="mt-6px mb-0 mx-0 text-11px leading-18px text-placeholder">在左侧传好素材、调好参数，点底部按钮提交；<br />生成结果会按批次显示在这里，生成过程中可以随时改参数接着做下一批</p>
      </div>
    </div>

    <!-- 批次详情 -->
    <template v-else>
      <div class="px-14px py-12px mb-14px border border-solid border-line rounded-10px bg-white shadow-[0_2px_4px_-1px_rgba(31,35,41,0.08)]">
        <div class="flex gap-8px items-center">
          <span class="text-14px font-600 text-ink">{{ summary!.title }}</span>
          <span class="ll-chip" :class="summary!.chip.cls">{{ summary!.chip.label }}</span>
        </div>
        <div class="mt-6px text-12px text-muted">
          成功 {{ summary!.done }} · 失败 {{ summary!.failed }} / 共 {{ summary!.total }} 张
          <span class="mx-4px text-line-strong">·</span> 预估 {{ summary!.points }} 点
          <span class="mx-4px text-line-strong">·</span> {{ summary!.time }}
        </div>
        <div v-if="summary!.running" class="h-4px mt-8px overflow-hidden rounded-999px bg-line-soft">
          <div class="h-full rounded-999px bg-[linear-gradient(90deg,#8a639f,#7a548c)] transition-[width] duration-240 ease-[cubic-bezier(0.2,0.7,0.2,1)]" :style="{ width: summary!.progress + '%' }" />
        </div>
        <div v-if="summary!.reason" class="mt-6px text-12px text-danger break-all">{{ summary!.reason }}</div>
        <div class="flex gap-14px justify-end mt-10px">
          <n-popconfirm v-if="summary!.running" @positive-click="cancelBatch(detail!)">
            <template #trigger><span class="text-12px text-violet cursor-pointer hover:text-violet-press">取消批次</span></template>
            只会取消还没开始的任务，已开始的继续跑完，确定取消？
          </n-popconfirm>
          <span class="text-12px text-violet cursor-pointer hover:text-violet-press" @click="reedit(detail!)">重新编辑</span>
          <n-popconfirm v-if="!summary!.running" @positive-click="removeBatch(detail!)">
            <template #trigger><span class="text-12px ll-danger-link">删除批次</span></template>
            删除后历史里不再显示（已入素材库的成品图不受影响），确定删除？
          </n-popconfirm>
        </div>
      </div>

      <div class="grid gap-12px content-start grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
        <div v-for="task in detail!.tasks" :key="task.id">
          <div class="aspect-[3/4] overflow-hidden border border-solid border-line rounded-8px bg-surface2">
            <n-image
              v-if="task.status === 2 && task.result_url"
              :src="task.result_url"
              :alt="taskCaption(task)"
              class="w-full h-full [&_img]:block [&_img]:w-full [&_img]:h-full"
              object-fit="cover"
              lazy
            />
            <div v-else-if="isTaskRunning(task)" class="flex h-full flex-col items-center justify-center gap-8px">
              <n-spin size="small" />
              <span class="text-12px text-ink-2">{{ task.status === 0 ? '排队中' : `${task.progress}%` }}</span>
              <div v-if="task.status !== 0" class="w-3/5 h-3px overflow-hidden rounded-999px bg-line-soft">
                <div class="h-full rounded-999px bg-[linear-gradient(90deg,#8a639f,#7a548c)] transition-[width] duration-240 ease-[cubic-bezier(0.2,0.7,0.2,1)]" :style="{ width: task.progress + '%' }" />
              </div>
            </div>
            <div v-else-if="task.status === 3" class="flex h-full items-center justify-center p-10px overflow-hidden text-12px leading-18px text-center break-all bg-danger-soft text-danger" :title="task.error_reason">{{ task.error_reason || '生成失败' }}</div>
            <div v-else class="flex h-full items-center justify-center p-10px overflow-hidden text-12px leading-18px text-center break-all bg-warning-soft text-warning">{{ taskChip(task.status).label }}</div>
          </div>
          <div class="flex gap-6px items-center justify-between mt-6px">
            <span class="overflow-hidden text-11px text-muted whitespace-nowrap text-ellipsis" :title="taskCaption(task)">{{ taskCaption(task) }}</span>
            <span class="ll-chip" :class="taskChip(task.status).cls">{{ taskChip(task.status).label }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
