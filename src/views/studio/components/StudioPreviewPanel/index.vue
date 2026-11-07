<script setup lang="ts">
/**
 * 三栏工作台 · 右列预览区。
 *
 * <p>选中批次的详情：批次摘要（状态 chip / 进度 / 成功失败数 / 点数 / 时间）+
 * 任务网格（per-task 状态 / 进度 / result_url / error_reason）。生成中的进度行显示批次当前阶段（切图中 / 反推中 / 生图中）；
 * 每张成品常驻「下载」，点图打开对照（MediaLightbox：输入图 → 成品，见 compare.ts）；
 * 失败的任务给「重试这张」（只重跑这一张、重新冻结这 1 张的点数，确认后调 studioRetryTask 并刷新进入轮询）。
 * 未选中 / 无历史时：有功能介绍文案（#intro 插槽 / intro 属性 / 按 feature 查 STUDIO_INTRO）就按原型
 * ToolIntroPanel 整列显示「功能介绍 + 适用场景」，否则显示空态引导。在跑批次由 useStudioHistory 轮询，这里只做展示。
 */
import { computed, ref, useSlots } from 'vue'
import { useMessage } from 'naive-ui'
import { studioCancelBatch, studioDeleteBatch, studioRetryTask } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import type { StudioBatchDetail, StudioTask } from '@/api/studioTypes.ts'
import IconButton from '@/components/IconButton/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import type { LightboxItem } from '@/components/MediaLightbox/index.vue'
import type { useStudioHistory } from '../../hooks.ts'
import {
  KIND_LABEL,
  batchChip,
  batchProgress,
  formatTime,
  isBatchTerminal,
  taskCaption,
  taskChip,
} from '../../constants.ts'
import { STUDIO_INTRO } from './intro.ts'
import { canRetryTask, compareItems, retrySupported, unitPoints } from './compare.ts'

const props = defineProps<{
  /** useStudioHistory 实例（游标分页 + 在跑批次轮询） */
  history: ReturnType<typeof useStudioHistory>
  /** 预览的批次；null = 显示空态引导（selectedId 有值但列表还没有它时显示加载态） */
  detail: StudioBatchDetail | null
  /** 是否有批次正在被选中但还没进列表（提交后刷新的瞬间） */
  pending?: boolean
  /** 功能键：查 STUDIO_INTRO 取默认的功能介绍文案（tryon / pose / imagegen） */
  feature?: string
  /** 功能介绍正文；传了覆盖 STUDIO_INTRO 的默认值 */
  intro?: string
  /** 适用场景；传了覆盖 STUDIO_INTRO 的默认值 */
  scenes?: string[]
}>()

const slots = useSlots()

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

// ---------------- 单张重试 ----------------

const retrying = ref('')

function retryConfirmText(d: StudioBatchDetail) {
  const unit = unitPoints(d.batch)
  return `只重新生成这一张，会按原入口重新冻结这 1 张的点数${unit ? `（约 ${unit} 点）` : ''}，其余图片不受影响。确定重试？`
}

async function retryTask(task: StudioTask) {
  if (retrying.value) return
  retrying.value = task.task_id
  try {
    await studioRetryTask(task.task_id)
  } catch (err) {
    const e = toApiError(err)
    // 业务失败（不满足重试条件 / 点数不足等）拦截器已 toast；只补「接口不存在」与传输层失败
    if (e?.httpStatus === 404 && e.code === -1) {
      retrySupported.value = false
      message.warning('单张重试暂未开放，可点「重新编辑」再提交')
    } else if (!e || e.isNetwork) {
      message.error('重试请求没有发出去，请检查网络后再试')
    }
    retrying.value = ''
    return
  }
  // 重试已成功（已重新冻结点数）：刷新失败不能再报成「重试失败」，免得用户再点一次重复扣点。
  // 刷新完成前保持 retrying，防止连点
  try {
    // 批次被拉回进行中：刷新列表即按需进入轮询
    await ctl.refresh()
    message.success('已重新提交这一张，生成好会自动刷新')
  } catch {
    message.warning('已重新提交，刷新失败，请稍后查看')
  } finally {
    retrying.value = ''
  }
}

// ---------------- 结果对照 / 下载 ----------------

const lbShow = ref(false)
const lbIndex = ref(0)
const lbItems = ref<LightboxItem[]>([])

function openCompare(d: StudioBatchDetail, task: StudioTask) {
  const { items, index } = compareItems(d, task)
  lbItems.value = items
  lbIndex.value = index
  lbShow.value = true
}

const downloadPath = 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14'

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

/** 无结果时的功能介绍：属性优先，其次按 feature 查默认文案；都没有就回到空态引导 */
const introCopy = computed(() => {
  const fallback = props.feature ? STUDIO_INTRO[props.feature] : undefined
  const intro = props.intro ?? fallback?.intro ?? ''
  const scenes = props.scenes ?? fallback?.scenes ?? []
  return intro || scenes.length ? { intro, scenes } : null
})
const showIntro = computed(() => !!slots.intro || !!introCopy.value)

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

/** 只有一张且已出图：按原型 StudioResult 单图展示（contain 居中、最大高 620） */
const single = computed(() => {
  const tasks = props.detail?.tasks ?? []
  const only = tasks.length === 1 ? tasks[0] : undefined
  return only && only.status === 2 && only.result_url ? only : null
})
</script>

<template>
  <div class="stu-scroll h-full box-border p-12px overflow-y-auto [scrollbar-gutter:stable]">
    <!-- 加载态：选中的批次还没进已加载列表（原型 .studio-result-muted：最小高 420、r8、page 底） -->
    <div
      v-if="pending && !detail"
      class="flex min-h-420px flex-col items-center justify-center gap-8px rounded-lg bg-page"
      role="status"
      aria-live="polite"
    >
      <n-spin size="small" />
      <span class="text-13px leading-20px text-muted">正在载入批次…</span>
    </div>

    <!-- 功能介绍（原型 ToolIntroPanel fill：没有记录时占满整列；内边距 18、块间距 14） -->
    <div v-else-if="!detail && showIntro" class="flex h-full min-h-0 flex-col p-6px">
      <slot name="intro">
        <aside class="flex flex-col gap-14px" aria-label="功能介绍">
          <!-- 原型 .tool-intro__head 高 22（标题 14·600·1.55），正文是 aside 的下一项：块距 14 + 自身上外边距 6 = 20 -->
          <div>
            <h3 class="m-0 text-14px font-600 leading-22px text-ink">功能介绍</h3>
            <p v-if="introCopy!.intro" class="mb-0 mt-20px text-13px leading-[1.65] text-ink-2">
              {{ introCopy!.intro }}
            </p>
          </div>
          <div
            v-if="introCopy!.scenes.length"
            class="p-10px box-border border border-solid border-line-soft rounded-6px bg-surface2"
          >
            <p class="m-0 text-13px font-500 leading-20px text-ink">适用场景</p>
            <ul class="m-0 mt-6px flex list-none flex-col gap-5px p-0 text-13px leading-[1.55] text-ink-2">
              <li v-for="scene in introCopy!.scenes" :key="scene">{{ scene }}</li>
            </ul>
          </div>
        </aside>
      </slot>
    </div>

    <!-- 空态（原型 StudioPreviewEmpty：最小高 420、内边距 24、r8、gap 6；图标圆 56 / 26） -->
    <div
      v-else-if="!detail"
      class="flex h-full min-h-420px box-border flex-col items-center justify-center gap-6px p-24px rounded-lg bg-white text-center"
    >
      <span
        class="mb-6px flex h-56px w-56px items-center justify-center rounded-full bg-page text-violet"
        aria-hidden="true"
      >
        <svg
          class="h-26px w-26px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
          <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
        </svg>
      </span>
      <p class="m-0 text-13px font-500 leading-20px text-muted">生成后在这里出结果</p>
      <p class="m-0 text-11px leading-17px text-placeholder">在左侧传好素材、调好参数，点底部按钮提交</p>
      <p class="m-0 text-11px leading-17px text-placeholder">生成过程中可以随时改参数接着做下一批</p>
    </div>

    <!-- 批次详情 -->
    <template v-else>
      <div class="mb-12px p-12px border border-solid border-line rounded-lg bg-white">
        <div class="flex gap-8px items-center">
          <span class="text-14px font-600 text-ink">{{ summary!.title }}</span>
          <span class="ll-chip" :class="summary!.chip.cls">{{ summary!.chip.label }}</span>
        </div>
        <div class="mt-6px text-13px text-muted">
          成功 {{ summary!.done }} · 失败 {{ summary!.failed }} / 共 {{ summary!.total }} 张
          <span class="mx-4px text-line-strong">·</span> 预估 {{ summary!.points }} 点
          <span class="mx-4px text-line-strong">·</span> {{ summary!.time }}
        </div>
        <!-- 生成中（原型 StudioProgress：横条高 6 / r3 + 百分比 + 可离开提示） -->
        <div v-if="summary!.running" class="mt-8px flex flex-col gap-8px p-16px rounded-lg bg-page">
          <div
            class="h-6px overflow-hidden rounded-3px bg-line-soft"
            role="progressbar"
            :aria-valuenow="Math.round(summary!.progress)"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="批次进度"
          >
            <div
              class="h-full rounded-3px sx-grad-progress transition-[width] duration-slow ease-sx"
              :style="{ width: summary!.progress + '%' }"
            />
          </div>
          <div class="flex items-center gap-8px">
            <span class="text-13px leading-20px text-ink">{{ summary!.chip.label }}</span>
            <span class="text-11px leading-16px text-ink tabular-nums">{{ Math.round(summary!.progress) }}%</span>
          </div>
          <p class="m-0 text-11px leading-16px text-placeholder">可以离开这一页，任务不会中断，回来会接着显示进度</p>
        </div>
        <div v-if="summary!.reason" class="mt-6px text-13px text-danger break-all">{{ summary!.reason }}</div>
        <div class="flex flex-wrap gap-6px justify-end mt-8px">
          <n-popconfirm v-if="summary!.running" @positive-click="cancelBatch(detail!)">
            <template #trigger
              ><button type="button" class="sx-btn-ghost !text-violet-ink hover:!text-violet-press">
                取消批次
              </button></template
            >
            只会取消还没开始的任务，已开始的继续跑完，确定取消？
          </n-popconfirm>
          <button type="button" class="sx-btn-ghost !text-violet-ink hover:!text-violet-press" @click="reedit(detail!)">
            重新编辑
          </button>
          <n-popconfirm v-if="!summary!.running" @positive-click="removeBatch(detail!)">
            <template #trigger
              ><button type="button" class="sx-btn-ghost !text-danger hover:!bg-danger-soft">删除批次</button></template
            >
            删除后历史里不再显示（已入素材库的成品图不受影响），确定删除？
          </n-popconfirm>
        </div>
      </div>

      <!-- 单张成品：原型 StudioResult 图片（最大高 620、r8、contain 居中） -->
      <div v-if="single">
        <div class="relative flex justify-center">
          <button
            type="button"
            class="block max-w-full p-0 border-0 bg-transparent cursor-zoom-in sx-focus rounded-lg"
            :aria-label="`查看${taskCaption(single)}与原图对照`"
            @click="openCompare(detail!, single)"
          >
            <img
              :src="single.result_url"
              :alt="taskCaption(single)"
              class="block max-w-full max-h-620px rounded-lg object-contain"
            />
          </button>
          <IconButton
            label="下载"
            variant="overlay"
            class="!absolute top-8px right-8px"
            :href="single.result_url"
            download
            target="_blank"
            @click.stop
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="downloadPath" />
            </svg>
          </IconButton>
        </div>
        <div class="mt-6px flex items-center justify-center gap-6px">
          <span
            class="overflow-hidden text-11px text-muted whitespace-nowrap text-ellipsis"
            :title="taskCaption(single)"
            >{{ taskCaption(single) }}</span
          >
          <span class="ll-chip" :class="taskChip(single.status).cls">{{ taskChip(single.status).label }}</span>
        </div>
      </div>
      <div v-else class="grid gap-12px content-start justify-center grid-cols-[repeat(auto-fit,minmax(200px,300px))]">
        <div v-for="task in detail!.tasks" :key="task.id">
          <div class="relative aspect-[3/4] overflow-hidden border border-solid border-line rounded-lg bg-surface2">
            <template v-if="task.status === 2 && task.result_url">
              <button
                type="button"
                class="block w-full h-full p-0 border-0 bg-transparent cursor-zoom-in sx-focus"
                :aria-label="`查看${taskCaption(task)}与原图对照`"
                @click="openCompare(detail!, task)"
              >
                <img
                  :src="task.result_url"
                  :alt="taskCaption(task)"
                  class="block w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
              <IconButton
                label="下载"
                variant="overlay"
                class="!absolute top-8px right-8px"
                :href="task.result_url"
                download
                target="_blank"
                @click.stop
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="downloadPath" />
                </svg>
              </IconButton>
            </template>
            <div v-else-if="isTaskRunning(task)" class="flex h-full flex-col items-center justify-center gap-8px">
              <n-spin size="small" />
              <span class="text-12px text-ink-2">{{ task.status === 0 ? '排队中' : `${task.progress}%` }}</span>
              <div v-if="task.status !== 0" class="w-3/5 h-3px overflow-hidden rounded-999px bg-line-soft">
                <div
                  class="h-full rounded-999px bg-[linear-gradient(90deg,#8a639f,#7a548c)] transition-[width] duration-240 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                  :style="{ width: task.progress + '%' }"
                />
              </div>
            </div>
            <div
              v-else-if="task.status === 3"
              class="flex h-full flex-col items-center justify-center gap-10px p-10px overflow-hidden text-12px leading-18px text-center break-all bg-danger-soft text-danger"
              :title="task.error_reason"
            >
              <span>{{ task.error_reason || '生成失败' }}</span>
              <n-popconfirm
                v-if="retrySupported && canRetryTask(detail!.batch, task)"
                @positive-click="retryTask(task)"
              >
                <template #trigger>
                  <button type="button" class="sx-btn" :disabled="!!retrying">
                    {{ retrying === task.task_id ? '提交中…' : '重试这张' }}
                  </button>
                </template>
                {{ retryConfirmText(detail!) }}
              </n-popconfirm>
            </div>
            <div
              v-else
              class="flex h-full items-center justify-center p-10px overflow-hidden text-12px leading-18px text-center break-all bg-warning-soft text-warning"
            >
              {{ taskChip(task.status).label }}
            </div>
          </div>
          <div class="flex gap-6px items-center justify-between mt-6px">
            <span
              class="overflow-hidden text-11px text-muted whitespace-nowrap text-ellipsis"
              :title="taskCaption(task)"
              >{{ taskCaption(task) }}</span
            >
            <span class="ll-chip" :class="taskChip(task.status).cls">{{ taskChip(task.status).label }}</span>
          </div>
        </div>
      </div>
    </template>

    <MediaLightbox v-model:show="lbShow" v-model:index="lbIndex" :items="lbItems" />
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
