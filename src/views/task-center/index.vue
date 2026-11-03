<script setup lang="ts">
/**
 * 任务中心：我的创作任务（只列父任务）。
 *
 * <p>数据全走 /api/v1/creation/task-center/*：状态 Tab 角标取 overview，列表取 tasks，
 * 入口 / 状态 / 时间三组选项取 filters。状态桶、状态文案、进度都由后端算好，这里只展示；
 * 封面只用 coverUrl（已脱敏 / 预签名）。有排队或生成中的任务时每 8 秒静默刷新一次。
 *
 * <p>收藏：每行星标（乐观切换，失败回滚），「收藏」筛选只列已收藏的任务（总览角标同口径）。
 * 做同款 / 参数回填：取 /tasks/{taskId}/params 的原始提交体，经 utils/refillHandoff 一次性交接给
 * 工作流页（/workflow 按模板回填）或工具页（/tools/:toolId）。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NConfigProvider, NDatePicker, NPagination, NSelect, useDialog, useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import { toolSchemas } from '@/views/tools/schemas'
import { workflowRouteOf, workflowSchemas } from '@/views/workflow/schemas'
import { stashRefill, type RefillMode } from '@/utils/refillHandoff'
import { llTheme } from '@/views/local-life/theme.ts'
import MediaFallback from '@/components/MediaFallback/index.vue'
import {
  taskCenterCollect,
  taskCenterDelete,
  taskCenterFilters,
  taskCenterOverview,
  taskCenterParams,
  taskCenterTasks,
  type ITaskCenterFilter,
  type ITaskCenterFilters,
  type ITaskCenterItem,
  type ITaskCenterOverview,
} from '@/api/taskCenter.ts'

defineOptions({ name: 'task-center' })

const message = useMessage()
const dialog = useDialog()
const router = useRouter()

const PAGE_SIZE = 20
const POLL_MS = 8000
/** 后端允许删除的状态桶（任务已结束）；在途任务不给删除入口 */
const DELETABLE = new Set(['success', 'failed', 'cancelled'])
const IN_FLIGHT = new Set(['queued', 'processing'])

const FOCUS = 'focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)'
const TAB_CLS =
  'inline-flex items-center gap-6px h-34px px-10px rounded-8px border border-solid text-13px font-500 cursor-pointer whitespace-nowrap ' +
  FOCUS
const TOOL_CLS =
  'inline-flex items-center gap-6px h-34px px-10px rounded-8px border border-solid border-line bg-white text-13px font-500 text-ink-2 cursor-pointer whitespace-nowrap hover:border-line-strong disabled:(opacity-60 cursor-not-allowed) ' +
  FOCUS

/** 状态徽标配色（只按后端给的 statusBucket 选样式，文案用 statusLabel） */
const CHIP_CLS: Record<string, string> = {
  queued: 'll-chip-warning',
  processing: 'll-chip-running',
  success: 'll-chip-success',
  failed: 'll-chip-error',
  cancelled: 'text-muted bg-surface3 border border-line',
}

// ---------------- 筛选 ----------------

const options = ref<ITaskCenterFilters>({ entryTypes: [], statuses: [], timeRanges: [] })
const filters = reactive({ entryCode: '', timeRange: '', statusBucket: '', collected: false })
const customRange = ref<[number, number] | null>(null)
const page = ref(1)

const entryOptions = computed(() => [
  { label: '全部入口', value: '' },
  ...options.value.entryTypes.map((e) => ({ label: e.name, value: e.entryCode })),
])
const timeOptions = computed(() => [
  { label: '不限时间', value: '' },
  ...options.value.timeRanges.map((t) => ({ label: t.label, value: t.value })),
])

const pad = (n: number) => String(n).padStart(2, '0')
const dayStr = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 总览与列表共用同一份筛选条件，角标数才对得上列表 */
const filterParams = computed<ITaskCenterFilter>(() => {
  const p: ITaskCenterFilter = {}
  if (filters.entryCode) p.entryCode = filters.entryCode
  if (filters.collected) p.collected = true
  if (filters.timeRange) {
    if (filters.timeRange !== 'custom') p.timeRange = filters.timeRange
    else if (customRange.value) {
      p.timeRange = 'custom'
      p.startTime = `${dayStr(customRange.value[0])} 00:00:00`
      p.endTime = `${dayStr(customRange.value[1])} 23:59:59`
    }
  }
  return p
})

// ---------------- 数据 ----------------

const overview = ref<ITaskCenterOverview | null>(null)
const items = ref<ITaskCenterItem[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref(false)
const deleting = ref('')

const tabs = computed(() => [
  { value: '', label: '全部', count: overview.value?.total ?? 0 },
  ...options.value.statuses.map((s) => ({
    value: s.value,
    label: s.label,
    count: (overview.value as unknown as Record<string, number> | null)?.[s.value] ?? 0,
  })),
])

let seq = 0
/** silent：轮询 / 删除后的静默刷新，不出加载态，失败也不替换现有列表 */
async function load(silent = false) {
  const my = ++seq
  if (!silent) {
    loading.value = true
    loadError.value = false
  }
  try {
    const [ov, list] = await Promise.all([
      taskCenterOverview(filterParams.value),
      taskCenterTasks({
        ...filterParams.value,
        ...(filters.statusBucket ? { statusBucket: filters.statusBucket } : {}),
        page: page.value,
        pageSize: PAGE_SIZE,
      }),
    ])
    if (my !== seq) return
    overview.value = ov.data
    items.value = list.data?.list ?? []
    total.value = list.data?.total ?? 0
    loadError.value = false
  } catch {
    if (my !== seq) return
    if (!silent) loadError.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}

async function loadFilters() {
  try {
    const res = await taskCenterFilters()
    options.value = {
      entryTypes: res.data?.entryTypes ?? [],
      statuses: res.data?.statuses ?? [],
      timeRanges: res.data?.timeRanges ?? [],
    }
  } catch {
    // 拦截器已提示；筛选项缺失时仍可看「全部」
  }
}

watch(
  () => [filters.entryCode, filters.timeRange, customRange.value, filters.statusBucket, filters.collected],
  () => {
    // 选了「自定义」但还没选日期：先不查，免得拿到不限时间的结果
    if (filters.timeRange === 'custom' && !customRange.value) return
    page.value = 1
    void load()
  },
)
watch(page, () => void load())

// ---------------- 轮询 ----------------

const hasInFlight = computed(() => items.value.some((i) => IN_FLIGHT.has(i.statusBucket)))
let timer: ReturnType<typeof setTimeout> | null = null
function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    if (hasInFlight.value && document.visibilityState === 'visible' && !loading.value) await load(true)
    schedule()
  }, POLL_MS)
}

onMounted(() => {
  void loadFilters()
  void load()
  schedule()
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  timer = null
})

// ---------------- 操作 ----------------

/** 同一任务的删除在途（含确认框打开中）：再点不再开第二个确认框，也不重复发请求 */
const deleteBusy = new Set<string>()

function confirmDelete(item: ITaskCenterItem) {
  if (deleteBusy.has(item.taskId)) return
  deleteBusy.add(item.taskId)
  let confirmed = false
  dialog.warning({
    title: '删除任务',
    content: '确定删除这条任务吗？已存入素材库的作品不受影响。',
    positiveText: '删除',
    negativeText: '取消',
    onNegativeClick: () => deleteBusy.delete(item.taskId),
    onClose: () => {
      // 确认框被关掉（遮罩、Esc）且没有确认时释放；确认后由删除流程的 finally 释放
      if (!confirmed) deleteBusy.delete(item.taskId)
    },
    onPositiveClick: async () => {
      confirmed = true
      deleting.value = item.taskId
      try {
        await taskCenterDelete(item.taskId)
        message.success('已删除')
        // 删掉本页最后一条时回上一页
        if (items.value.length === 1 && page.value > 1) page.value -= 1
        else await load(true)
      } catch (e) {
        // 任务已被删除（另一次点击或别的标签页先删掉了）：不报错，直接刷新到最新状态
        if (e instanceof Error && e.message.includes('不存在')) await load(true)
        // 其它后端拒绝原因（在途、未结清等）已由拦截器提示
      } finally {
        deleting.value = ''
        deleteBusy.delete(item.taskId)
      }
    },
  })
}

// ---------------- 收藏 ----------------

/** 拦截器已提示过的业务错误不再重复弹；网络 / HTTP 失败补一条 */
function reportError(err: unknown, fallback: string) {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  message.error(apiErr?.isNetwork ? '网络异常，请稍后重试' : fallback)
}

/** 同一任务的收藏请求在途：再点不重复发 */
const collectBusy = ref(new Set<string>())

async function toggleCollect(item: ITaskCenterItem) {
  if (collectBusy.value.has(item.taskId)) return
  const next = !item.collected
  collectBusy.value.add(item.taskId)
  item.collected = next // 乐观切换，失败回滚
  try {
    await taskCenterCollect(item.taskId, next)
    message.success(next ? '已收藏' : '已取消收藏')
    // 「收藏」筛选下取消收藏：这一行不再属于当前列表，静默刷新把它摘掉
    if (!next && filters.collected) {
      if (items.value.length === 1 && page.value > 1) page.value -= 1
      else await load(true)
    }
  } catch (e) {
    item.collected = !next
    reportError(e, '收藏失败')
  } finally {
    collectBusy.value.delete(item.taskId)
  }
}

// ---------------- 做同款 / 参数回填 ----------------

/** 在途的回填请求：`${taskId}:${mode}`，同一时间只处理一个，免得连点跳两次页 */
const refillBusy = ref('')

async function openWith(item: ITaskCenterItem, mode: RefillMode) {
  if (refillBusy.value) return
  refillBusy.value = `${item.taskId}:${mode}`
  try {
    const res = await taskCenterParams(item.taskId)
    const p = res.data
    const params = p?.requestParams
    if (!p?.refillable || !params) {
      message.warning(p?.reason || '该任务不支持参数回填')
      return
    }
    if (p.kind === 'workflow' && p.workflowTitle) {
      const target = workflowSchemas.find((x) => x.templateTitle === p.workflowTitle && x.status === 'mapped')
      const to = target ? workflowRouteOf(target.templateTitle) : undefined
      if (!to) {
        message.warning('该工作流暂不支持回填')
        return
      }
      stashRefill({ kind: 'workflow', key: target!.templateTitle, mode, taskId: item.taskId, params })
      await router.push(to)
      return
    }
    if (p.kind === 'tool' && p.toolTitle) {
      const tool = toolSchemas.find((x) => x.historyTitle === p.toolTitle)
      if (!tool) {
        message.warning('该工具暂不支持回填')
        return
      }
      stashRefill({ kind: 'tool', key: tool.historyTitle, mode, taskId: item.taskId, params })
      await router.push(`/tools/${encodeURIComponent(tool.homeId)}`)
      // 工具页暂未接入交接（views/tools 本次不改）：引导用户用记录上的「重新编辑」
      message.info(`已打开「${tool.title}」，在右侧记录里点「重新编辑」即可回填原参数`)
      return
    }
    message.warning(p.reason || '该任务不支持参数回填')
  } catch (e) {
    reportError(e, '参数读取失败，请重试')
  } finally {
    refillBusy.value = ''
  }
}

const brokenCovers = ref(new Set<string>())
const isVideo = (item: ITaskCenterItem) => item.resultType === 'video'
const showProgress = (item: ITaskCenterItem) => IN_FLIGHT.has(item.statusBucket) && item.progress != null

const emptyCopy = computed(() => {
  if (filters.collected && !filters.statusBucket && !filters.entryCode && !filters.timeRange)
    return { title: '还没有收藏的任务', desc: '点任务右侧的星标收藏，之后在这里快速找到' }
  return filters.statusBucket || filters.entryCode || filters.timeRange || filters.collected
    ? { title: '没有符合条件的任务', desc: '换个筛选条件试试' }
    : { title: '还没有创作任务', desc: '去 AI 图片、AI 视频或工具里提交一次，任务会出现在这里' }
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="min-h-100vh flex flex-col bg-page text-ink">
      <header
        class="flex flex-wrap items-center gap-8px shrink-0 px-20px py-14px bg-white border-b border-b-solid border-line"
      >
        <h1 class="m-0 text-20px font-600 leading-28px">任务中心</h1>
        <span class="ml-8px text-12px text-muted">查看提交过的创作任务和进度</span>
        <div class="ml-auto flex flex-wrap items-center gap-8px">
          <n-select
            v-model:value="filters.entryCode"
            :options="entryOptions"
            size="small"
            class="w-160px"
            aria-label="创作入口"
            filterable
          />
          <n-select
            v-model:value="filters.timeRange"
            :options="timeOptions"
            size="small"
            class="w-120px"
            aria-label="时间范围"
          />
          <n-date-picker
            v-if="filters.timeRange === 'custom'"
            v-model:value="customRange"
            type="daterange"
            size="small"
            clearable
            class="w-240px"
          />
          <button type="button" :class="TOOL_CLS" :disabled="loading" @click="load()">刷新</button>
        </div>
      </header>

      <div class="flex-1 px-20px pb-32px">
        <div class="flex flex-wrap items-center gap-8px pt-20px pb-16px" role="group" aria-label="任务状态">
          <button
            v-for="t in tabs"
            :key="t.value || '__all'"
            type="button"
            :aria-pressed="filters.statusBucket === t.value"
            :class="[
              TAB_CLS,
              filters.statusBucket === t.value
                ? 'bg-violet-soft border-violet-line text-violet-ink'
                : 'bg-white border-line text-ink-2 hover:border-line-strong',
            ]"
            @click="filters.statusBucket = t.value"
          >
            {{ t.label }}
            <span
              class="px-5px py-1px rounded-4px text-10px tabular-nums"
              :class="filters.statusBucket === t.value ? 'bg-white/70 text-violet-ink' : 'bg-surface3 text-muted'"
              >{{ t.count }}</span
            >
          </button>
          <span class="w-1px h-20px mx-2px bg-line" aria-hidden="true" />
          <button
            type="button"
            :aria-pressed="filters.collected"
            :class="[
              TAB_CLS,
              filters.collected
                ? 'bg-[#fffbeb] border-[#fcd34d] text-[#b45309]'
                : 'bg-white border-line text-ink-2 hover:border-line-strong',
            ]"
            @click="filters.collected = !filters.collected"
          >
            <svg
              class="w-14px h-14px"
              viewBox="0 0 24 24"
              :fill="filters.collected ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
            </svg>
            收藏
          </button>
          <span class="ml-auto text-12px text-muted whitespace-nowrap">共 {{ total }} 条</span>
        </div>

        <!-- 首次加载：骨架行 -->
        <ul v-if="loading && !items.length" class="m-0 p-0 list-none flex flex-col gap-8px" aria-busy="true">
          <li
            v-for="n in 4"
            :key="n"
            class="flex items-center gap-12px p-12px rounded-8px border border-solid border-line bg-white"
          >
            <span class="flex-none w-64px h-64px rounded-6px bg-sunken animate-pulse" />
            <span class="flex-1 flex flex-col gap-8px">
              <span class="block w-[40%] h-12px rounded-4px bg-sunken animate-pulse" />
              <span class="block w-[24%] h-10px rounded-4px bg-sunken animate-pulse" />
            </span>
          </li>
          <li class="sr-only" role="status">加载中…</li>
        </ul>

        <!-- 加载失败 -->
        <div
          v-else-if="loadError && !items.length"
          class="flex flex-col items-center justify-center gap-4px min-h-240px rounded-8px border border-dashed border-line-strong bg-white"
          role="alert"
        >
          <span
            class="grid place-items-center w-48px h-48px box-border rounded-full border-2 border-solid border-warning text-20px font-600 text-warning"
            aria-hidden="true"
            >!</span
          >
          <strong class="mt-12px text-14px font-500 text-ink">任务列表加载失败</strong>
          <span class="text-12px text-muted">请检查网络后重试</span>
          <button type="button" :class="[TOOL_CLS, 'mt-12px !h-28px']" @click="load()">重试</button>
        </div>

        <!-- 空态 -->
        <div
          v-else-if="!items.length"
          class="flex flex-col items-center justify-center gap-5px min-h-240px px-18px rounded-8px border border-dashed border-line-strong bg-white"
        >
          <span
            class="grid place-items-center w-40px h-40px box-border rounded-full border border-solid border-line bg-white text-violet-ink"
            aria-hidden="true"
          >
            <svg
              class="w-20px h-20px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <strong class="text-13px font-600 text-ink-2">{{ emptyCopy.title }}</strong>
          <span class="max-w-320px text-center text-11px leading-[1.65] text-muted">{{ emptyCopy.desc }}</span>
        </div>

        <!-- 列表 -->
        <template v-else>
          <ul class="m-0 p-0 list-none flex flex-col gap-8px" :aria-busy="loading">
            <li
              v-for="item in items"
              :key="item.taskId"
              class="flex items-center gap-12px p-12px rounded-8px border border-solid border-line bg-white [transition:border-color_110ms,box-shadow_110ms] hover:(border-#c9cfd6 shadow-[0_1px_2px_rgba(31,35,41,0.05)])"
            >
              <!-- 缩略 64 / r6：被屏蔽或加载失败走占位；文本产物显示正文首段 -->
              <span
                class="relative flex-none grid place-items-center w-64px h-64px box-border overflow-hidden rounded-6px border border-solid border-line bg-surface3 text-placeholder"
              >
                <MediaFallback
                  v-if="item.blocked"
                  :type="isVideo(item) ? 'video' : 'image'"
                  reason="blocked"
                  aria-label="内容已屏蔽"
                />
                <a
                  v-else-if="item.coverUrl && !brokenCovers.has(item.taskId)"
                  :href="item.coverUrl"
                  target="_blank"
                  rel="noopener"
                  class="block w-full h-full rounded-5px"
                  :class="FOCUS"
                  :aria-label="`查看${item.title}的${isVideo(item) ? '视频封面' : '作品'}`"
                >
                  <img
                    :src="item.coverUrl"
                    alt=""
                    loading="lazy"
                    class="block w-full h-full object-cover"
                    @error="brokenCovers.add(item.taskId)"
                  />
                  <span
                    v-if="isVideo(item)"
                    class="absolute left-4px bottom-4px px-4px rounded-3px bg-black/55 text-10px leading-14px text-white"
                    aria-hidden="true"
                    >视频</span
                  >
                </a>
                <MediaFallback
                  v-else-if="item.coverUrl"
                  :type="isVideo(item) ? 'video' : 'image'"
                  reason="loadFailed"
                />
                <span
                  v-else-if="item.resultText"
                  class="p-6px text-10px leading-14px text-ink-2 line-clamp-4 break-all"
                  :title="item.resultText"
                  >{{ item.resultText }}</span
                >
                <span v-else class="text-11px" aria-hidden="true">—</span>
              </span>

              <span class="min-w-0 flex-1 flex flex-col gap-6px">
                <span class="flex items-center gap-8px min-w-0">
                  <b class="truncate text-14px font-600 leading-20px text-ink" :title="item.title">{{ item.title }}</b>
                  <span class="ll-chip" :class="CHIP_CLS[item.statusBucket] ?? CHIP_CLS.cancelled">{{
                    item.statusLabel
                  }}</span>
                </span>
                <span class="flex flex-wrap items-center gap-x-12px gap-y-2px text-11px leading-16px text-muted">
                  <span>{{ item.typeName }}</span>
                  <span class="tabular-nums">{{ item.createTime }}</span>
                  <span class="tabular-nums select-all" :title="item.taskId">{{ item.taskId }}</span>
                </span>
                <span v-if="showProgress(item)" class="flex items-center gap-8px max-w-320px">
                  <span
                    class="relative flex-1 h-4px overflow-hidden rounded-full bg-sunken"
                    role="progressbar"
                    :aria-valuenow="item.progress ?? 0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="`${item.title}进度`"
                  >
                    <span
                      class="absolute inset-y-0 left-0 rounded-full sx-grad-progress transition-[width] duration-300"
                      :style="{ width: `${item.progress}%` }"
                    />
                  </span>
                  <span class="flex-none text-11px tabular-nums text-violet-ink">{{ item.progress }}%</span>
                </span>
                <span
                  v-if="item.failReason"
                  class="text-12px leading-18px text-alert-danger line-clamp-2"
                  :title="item.failReason"
                  >{{ item.failReason }}</span
                >
              </span>

              <span class="flex-none flex items-center gap-4px">
                <template v-if="item.canRefill">
                  <button
                    type="button"
                    class="sx-btn-ghost !h-28px !px-8px !text-12px"
                    :disabled="!!refillBusy"
                    :aria-label="`做同款：用 ${item.title} 的设置换素材再做一次`"
                    title="套用这次的设置，换上自己的素材"
                    @click="openWith(item, 'same')"
                  >
                    {{ refillBusy === `${item.taskId}:same` ? '打开中…' : '做同款' }}
                  </button>
                  <button
                    type="button"
                    class="sx-btn-ghost !h-28px !px-8px !text-12px"
                    :disabled="!!refillBusy"
                    :aria-label="`参数回填：把 ${item.title} 的原参数填回去再编辑`"
                    title="把原参数原样填回，改完再提交"
                    @click="openWith(item, 'refill')"
                  >
                    {{ refillBusy === `${item.taskId}:refill` ? '打开中…' : '参数回填' }}
                  </button>
                </template>
                <button
                  type="button"
                  class="grid place-items-center w-28px h-28px box-border rounded-6px border border-solid cursor-pointer disabled:cursor-wait"
                  :class="[
                    FOCUS,
                    item.collected
                      ? 'bg-[#fffbeb] border-[#fcd34d] text-[#d97706]'
                      : 'bg-white border-transparent text-muted hover:(border-line text-ink-2)',
                  ]"
                  :aria-pressed="!!item.collected"
                  :aria-label="item.collected ? `取消收藏 ${item.title}` : `收藏 ${item.title}`"
                  :title="item.collected ? '取消收藏' : '收藏'"
                  :disabled="collectBusy.has(item.taskId)"
                  @click="toggleCollect(item)"
                >
                  <svg
                    class="w-16px h-16px"
                    viewBox="0 0 24 24"
                    :fill="item.collected ? 'currentColor' : 'none'"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                  </svg>
                </button>
              </span>
              <button
                v-if="DELETABLE.has(item.statusBucket)"
                type="button"
                class="flex-none sx-btn-ghost !h-28px !px-8px !text-12px hover:!text-danger"
                :disabled="deleting === item.taskId"
                :aria-label="`删除任务 ${item.title}`"
                @click="confirmDelete(item)"
              >
                {{ deleting === item.taskId ? '删除中…' : '删除' }}
              </button>
            </li>
          </ul>

          <div v-if="total > PAGE_SIZE" class="flex justify-end pt-16px">
            <n-pagination v-model:page="page" :page-size="PAGE_SIZE" :item-count="total" />
          </div>
        </template>
      </div>
    </div>
  </n-config-provider>
</template>
