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
import IconButton from '@/components/IconButton/index.vue'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
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
const COLLECT_CLS =
  'sx-squircle inline-flex items-center gap-6px h-32px px-12px rounded-14px border border-solid text-13px font-500 cursor-pointer whitespace-nowrap ' +
  FOCUS

/** 状态徽标配色（只按后端给的 statusBucket 选样式，文案用 statusLabel） */
const CHIP_CLS: Record<string, string> = {
  queued: 'bg-warning-soft text-warning',
  processing: 'bg-info-soft text-violet-ink',
  success: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger',
  cancelled: 'text-muted bg-surface3',
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

/** 四段状态：全部 / 进行中（排队 + 生成中，后端 active）/ 已完成 / 失败；已取消只在「全部」里 */
const tabs = computed(() => {
  const ov = overview.value
  return [
    { value: '', label: '全部', count: ov?.total ?? 0 },
    { value: 'active', label: '进行中', count: (ov?.queued ?? 0) + (ov?.processing ?? 0) },
    { value: 'success', label: '已完成', count: ov?.success ?? 0 },
    { value: 'failed', label: '失败', count: ov?.failed ?? 0 },
  ]
})

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
  const narrowed = !!(filters.entryCode || filters.timeRange)
  if (filters.collected && !filters.statusBucket && !narrowed)
    return { title: '还没有收藏的任务', desc: '点任务右侧的星标收藏，之后在这里快速找到', goGenerate: false }
  if (narrowed || filters.collected) return { title: '没有符合条件的任务', desc: '换个筛选条件试试', goGenerate: false }
  switch (filters.statusBucket) {
    case 'active':
      return { title: '没有进行中的任务', desc: '正在排队或生成的任务会出现在这里', goGenerate: false }
    case 'success':
      return { title: '还没有已完成的任务', desc: '生成完成的任务会出现在这里', goGenerate: false }
    case 'failed':
      return { title: '没有失败的任务', desc: '', goGenerate: false }
    default:
      return { title: '还没有任务', desc: '提交一次生成，任务会出现在这里', goGenerate: true }
  }
})

/** 行主区域可预览：有可用封面且未屏蔽；沿用原来的「新标签打开封面/大图」预览行为 */
const previewable = (item: ITaskCenterItem) => !!item.coverUrl && !item.blocked && !brokenCovers.value.has(item.taskId)
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
          <button type="button" class="sx-btn" :disabled="loading" @click="load()">刷新</button>
        </div>
      </header>

      <div class="flex-1 px-20px pb-32px">
        <div class="flex flex-wrap items-center gap-8px pt-20px pb-16px">
          <div class="sx-seg" role="group" aria-label="任务状态">
            <button
              v-for="t in tabs"
              :key="t.value || '__all'"
              type="button"
              :aria-pressed="filters.statusBucket === t.value"
              class="sx-seg-item !h-30px !px-12px !text-13px"
              :class="[FOCUS, filters.statusBucket === t.value ? 'sx-seg-on' : 'hover:text-ink']"
              @click="filters.statusBucket = t.value"
            >
              {{ t.label }}
              <span class="ml-4px text-12px tabular-nums text-muted">{{ t.count }}</span>
            </button>
          </div>
          <span class="w-1px h-20px mx-2px bg-line" aria-hidden="true" />
          <button
            type="button"
            :aria-pressed="filters.collected"
            :class="[
              COLLECT_CLS,
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
            class="sx-squircle flex items-center gap-12px p-12px rounded-18px border border-solid border-line bg-white"
          >
            <span class="flex-none w-44px h-44px rounded-6px bg-sunken animate-pulse" />
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
          class="sx-squircle min-h-240px rounded-18px border border-dashed border-line-strong bg-white"
        >
          <PageLoadError title="任务列表加载失败" subtitle="请检查网络后重试" retryable @retry="load()" />
        </div>

        <!-- 空态 -->
        <div
          v-else-if="!items.length"
          class="sx-squircle min-h-240px rounded-18px border border-dashed border-line-strong bg-white"
        >
          <PageEmpty :text="emptyCopy.title" :description="emptyCopy.desc">
            <button v-if="emptyCopy.goGenerate" type="button" class="sx-btn-primary" @click="router.push('/image')">
              去生成
            </button>
          </PageEmpty>
        </div>

        <!-- 列表 -->
        <template v-else>
          <ul class="m-0 p-0 list-none flex flex-col gap-8px" :aria-busy="loading">
            <li
              v-for="item in items"
              :key="item.taskId"
              class="sx-squircle flex items-center gap-12px p-12px rounded-18px border border-solid border-line bg-white [transition:border-color_110ms,box-shadow_110ms] hover:(border-#c9cfd6 shadow-[0_1px_2px_rgba(31,35,41,0.05)])"
            >
              <div class="min-w-0 flex-1 flex items-center gap-12px rounded-12px">
                <!-- 缩略 44 / r6：被屏蔽或加载失败走占位；文本产物显示正文首段 -->
                <component
                  :is="previewable(item) ? 'a' : 'span'"
                  v-bind="previewable(item) ? { href: item.coverUrl, target: '_blank', rel: 'noopener noreferrer', tabindex: -1, 'aria-hidden': true } : {}"
                  class="relative flex-none grid place-items-center w-44px h-44px box-border overflow-hidden rounded-6px border border-solid border-line bg-surface3 text-placeholder"
                >
                  <MediaFallback
                    v-if="item.blocked"
                    :type="isVideo(item) ? 'video' : 'image'"
                    reason="blocked"
                    aria-label="内容已屏蔽"
                  />
                  <span
                    v-else-if="item.coverUrl && !brokenCovers.has(item.taskId)"
                    class="block w-full h-full rounded-5px"
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
                  </span>
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
                </component>

                <span class="min-w-0 flex-1 flex flex-col gap-6px">
                  <span class="flex items-center gap-8px min-w-0">
                    <b class="truncate text-14px font-600 leading-20px text-ink" :title="item.title">
                      <a
                        v-if="previewable(item)"
                        :href="item.coverUrl ?? undefined"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-inherit no-underline rounded-4px hover:underline"
                        :class="FOCUS"
                        :aria-label="`预览：${item.title}`"
                        >{{ item.title }}</a
                      >
                      <template v-else>{{ item.title }}</template>
                    </b>
                    <!-- 状态胶囊（原型 .task-row status capsule）：999px + 5px 状态点，语义 soft 底深字 -->
                    <span
                      class="inline-flex flex-none items-center h-18px px-7px rounded-full text-11px leading-16px whitespace-nowrap"
                      :class="CHIP_CLS[item.statusBucket] ?? CHIP_CLS.cancelled"
                    >
                      <i
                        class="w-5px h-5px rounded-full mr-4px"
                        :class="
                          {
                            queued: 'bg-warning',
                            processing: 'bg-violet',
                            success: 'bg-success',
                            failed: 'bg-danger',
                            cancelled: 'bg-placeholder',
                          }[item.statusBucket] ?? 'bg-placeholder'
                        "
                        aria-hidden="true"
                      ></i>
                      {{ item.statusLabel }}
                    </span>
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
              </div>

              <span class="flex-none flex items-center gap-8px">
                <!-- 列表接口只给封面：视频任务的封面不是作品本身，不放「查看大图」（点缩略图有预览） -->
                <a
                  v-if="!isVideo(item) && item.coverUrl && !item.blocked && !brokenCovers.has(item.taskId)"
                  :href="item.coverUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="sx-btn-tint !px-12px !text-13px no-underline"
                  :aria-label="`查看大图：${item.title}`"
                  >查看大图</a
                >
                <template v-if="item.canRefill">
                  <button
                    type="button"
                    class="sx-btn-ghost !px-12px !text-13px"
                    :disabled="!!refillBusy"
                    :aria-label="`做同款：用 ${item.title} 的设置换素材再做一次`"
                    title="套用这次的设置，换上自己的素材"
                    @click="openWith(item, 'same')"
                  >
                    {{ refillBusy === `${item.taskId}:same` ? '打开中…' : '做同款' }}
                  </button>
                  <button
                    type="button"
                    class="sx-btn-ghost !px-12px !text-13px"
                    :disabled="!!refillBusy"
                    :aria-label="`参数回填：把 ${item.title} 的原参数填回去再编辑`"
                    title="把原参数原样填回，改完再提交"
                    @click="openWith(item, 'refill')"
                  >
                    {{ refillBusy === `${item.taskId}:refill` ? '打开中…' : '参数回填' }}
                  </button>
                </template>
                <IconButton
                  variant="quiet"
                  :label="item.collected ? `取消收藏 ${item.title}` : `收藏 ${item.title}`"
                  :pressed="!!item.collected"
                  :disabled="collectBusy.has(item.taskId)"
                  @click="toggleCollect(item)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    :fill="item.collected ? 'currentColor' : 'none'"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  >
                    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                  </svg>
                </IconButton>
              </span>
              <button
                v-if="DELETABLE.has(item.statusBucket)"
                type="button"
                class="flex-none sx-btn-ghost !px-12px !text-13px hover:!text-danger"
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
