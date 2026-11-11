<script setup lang="ts">
/**
 * 任务中心：我的创作任务（只列父任务）。
 *
 * <p>数据全走 /api/v1/creation/task-center/*：状态 Tab 角标取 overview，列表取 tasks，
 * 入口 / 状态 / 时间三组选项取 filters。状态桶、状态文案、进度都由后端算好，这里只展示；
 * 封面只用 coverUrl（已脱敏 / 预签名）。有排队或生成中的任务时每 8 秒静默刷新一次；
 * 全站实时推送在线时（utils/taskWatcher 的 taskStreamLive）不再定时刷新，改为按推送的 task 事件就地更新该行：
 * 进度类变化直接改行，状态桶变化回查该行详情并稍后静默刷新一次（角标计数、排序、封面），推送要求 resync 时整体重拉。
 * 深链 /tasks?taskId=…（完成提醒的「查看」）：列表加载后滚动到该行并高亮；不在当前筛选 / 页时先回到「全部」第一页再找。
 * 进度条旁的预计剩余时间取后端 etaSeconds / progressSource，两次刷新之间本地倒计时（utils/task-eta）。
 *
 * <p>收藏：每行星标（乐观切换，失败回滚），「收藏」筛选只列已收藏的任务（总览角标同口径）。
 * 做同款 / 参数回填：取 /tasks/{taskId}/params 的原始提交体，经 utils/refillHandoff 一次性交接给
 * 工作流页（/workflow 按模板回填）或工具页（/tools/:toolId）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NDatePicker, NPagination, NSelect, useDialog, useMessage } from 'naive-ui'
import { getQuiet, toApiError } from '@/api/index.ts'
import { toolSchemas } from '@/views/tools/schemas'
import { workflowRouteOf, workflowSchemas } from '@/views/workflow/schemas'
import { ENTRY_ROUTE } from '@/utils/same-style'
import { stashRefill, type RefillMode } from '@/utils/refill-handoff'
import { llTheme } from '@/views/local-life/theme.ts'
import MediaFallback from '@/components/MediaFallback/index.vue'
import IconButton from '@/components/IconButton/index.vue'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { ossResize, thumbFallback } from '@/utils/oss'
import { useTaskEta } from '@/utils/task-eta'
import {
  desktopNotifyDenied,
  desktopNotifyEnabled,
  desktopNotifySupported,
  onTaskEvent,
  onTaskResync,
  setDesktopNotify,
  taskStreamLive,
  type TaskStreamEvent,
} from '@/utils/taskWatcher'
import {
  taskCenterCancel,
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
  type ITaskCenterTask,
} from '@/api/task-center.ts'

defineOptions({ name: 'task-center' })

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const route = useRoute()

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
/** 卸载后在途那一轮回来不再续排（否则离开页面后还会一直轮询） */
let unmounted = false
function schedule() {
  if (timer) clearTimeout(timer)
  if (unmounted) return
  timer = setTimeout(async () => {
    // 推送在线时由 task 事件驱动更新，不再定时拉
    if (hasInFlight.value && !taskStreamLive.value && document.visibilityState === 'visible' && !loading.value)
      await load(true)
    schedule()
  }, POLL_MS)
}

// 切回前台：有在途任务立即补一次（隐藏期间不刷新，回来不用干等下一个 8 秒）
function onVisibility() {
  if (document.visibilityState === 'visible' && hasInFlight.value && !loading.value) {
    void load(true)
    schedule()
  }
}

// ---------------- 实时推送（utils/taskWatcher） ----------------

const RELOAD_DEBOUNCE_MS = 1200
let reloadTimer: ReturnType<typeof setTimeout> | null = null
/** 攒一下再静默整页刷新（角标计数、筛选归属、排序都可能变了） */
function reloadSoon() {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    if (!unmounted && !loading.value) void load(true)
  }, RELOAD_DEBOUNCE_MS)
}

function patchRow(taskId: string, patch: Partial<ITaskCenterItem>) {
  // 整体替换数组：预计剩余时间的本地倒计时按数组变化重新打点（utils/task-eta）
  items.value = items.value.map((i) => (i.taskId === taskId ? { ...i, ...patch } : i))
}

/** 状态桶变了：回查这一行详情（封面 / 屏蔽等推送里没有的字段） */
async function refetchRow(taskId: string) {
  try {
    const res = await getQuiet<ITaskCenterTask>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(taskId)}`)
    const d = res.data
    if (!d || unmounted) return
    patchRow(taskId, {
      status: d.status,
      statusBucket: d.statusBucket,
      statusLabel: d.statusLabel,
      progress: d.progress,
      etaSeconds: d.etaSeconds ?? null,
      progressSource: d.progressSource ?? null,
      coverUrl: d.coverUrl || null,
      blocked: d.blocked,
    })
  } catch {
    // 已删除 / 网络抖动：交给随后的整页刷新
  }
}

/** 不在本页的任务上次推送的状态桶：只在桶变化（含新出现）时才刷新，纯进度推送不打扰 */
const offPageBuckets = new Map<string, string>()

function onLiveTask(ev: TaskStreamEvent) {
  const row = items.value.find((i) => i.taskId === ev.taskId)
  if (!row) {
    // 不在本页（新提交的任务、或在别的页 / 筛选里）：状态桶变了才刷新（新任务插入第一页、角标计数）
    if (offPageBuckets.get(ev.taskId) !== ev.statusBucket) {
      offPageBuckets.set(ev.taskId, ev.statusBucket)
      if (offPageBuckets.size > 500) offPageBuckets.clear()
      reloadSoon()
    }
    return
  }
  const bucketChanged = row.statusBucket !== ev.statusBucket
  patchRow(ev.taskId, {
    statusBucket: ev.statusBucket,
    ...(ev.status != null ? { status: ev.status } : {}),
    ...(ev.statusLabel ? { statusLabel: ev.statusLabel } : {}),
    ...(ev.progress != null ? { progress: ev.progress } : {}),
    etaSeconds: ev.etaSeconds ?? null,
    ...(ev.progressSource ? { progressSource: ev.progressSource } : {}),
  })
  if (bucketChanged) {
    void refetchRow(ev.taskId)
    reloadSoon()
  }
}

// ---------------- 深链高亮（/tasks?taskId=…） ----------------

const highlightId = ref('')
let highlightTimer: ReturnType<typeof setTimeout> | null = null
/** 待定位的任务号；找到（或确认找不到）后清空，并把 query 里的 taskId 去掉，刷新页面不再重复定位 */
let pendingFocus = ''
let focusWidened = false

function takeQueryTaskId() {
  const q = route.query.taskId
  const id = typeof q === 'string' ? q.trim() : ''
  if (!id) return
  pendingFocus = id
  focusWidened = false
}

function clearFocusQuery() {
  if (route.query.taskId === undefined) return
  const query = { ...route.query }
  delete query.taskId
  void router.replace({ query })
}

async function tryFocus() {
  if (!pendingFocus || loading.value) return
  const id = pendingFocus
  if (items.value.some((i) => i.taskId === id)) {
    pendingFocus = ''
    clearFocusQuery()
    highlightId.value = id
    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => (highlightId.value = ''), 4000)
    await nextTick()
    const el = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return
  }
  const narrowed =
    page.value !== 1 || !!filters.statusBucket || !!filters.entryCode || !!filters.timeRange || filters.collected
  if (!focusWidened && narrowed) {
    // 不在当前筛选 / 页：回到「全部」第一页再找一次（筛选 watch 会触发重载，加载完再进来）
    focusWidened = true
    filters.statusBucket = ''
    filters.entryCode = ''
    filters.timeRange = ''
    filters.collected = false
    customRange.value = null
    page.value = 1
    return
  }
  pendingFocus = ''
  clearFocusQuery()
  message.info('这条任务不在最近的列表里，可以按入口或时间筛选查找')
}

watch(loading, (v) => {
  if (!v) void tryFocus()
})
// 推送刚上线：首次建流不补发，「页面加载 → 建流」之间的变化会漏，静默重拉一次对齐
watch(taskStreamLive, (live) => {
  if (live && !unmounted && !loading.value) void load(true)
})
watch(
  () => route.query.taskId,
  () => {
    takeQueryTaskId()
    void tryFocus()
  },
)

let offTask: (() => void) | null = null
let offResync: (() => void) | null = null

onMounted(() => {
  takeQueryTaskId()
  void loadFilters()
  void load()
  schedule()
  document.addEventListener('visibilitychange', onVisibility)
  offTask = onTaskEvent(onLiveTask)
  offResync = onTaskResync(() => {
    if (!loading.value) void load(true)
  })
})
onBeforeUnmount(() => {
  unmounted = true
  if (timer) clearTimeout(timer)
  timer = null
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = null
  if (highlightTimer) clearTimeout(highlightTimer)
  offTask?.()
  offResync?.()
  document.removeEventListener('visibilitychange', onVisibility)
})

// ---------------- 桌面提醒开关（全站完成提醒 utils/taskWatcher 用） ----------------

const desktopSupported = desktopNotifySupported()
const desktopOn = ref(desktopNotifyEnabled())
const desktopTip = computed(() =>
  desktopOn.value
    ? '任务在后台完成时发浏览器通知，点击关闭'
    : desktopNotifyDenied()
      ? '浏览器已禁止通知，请在浏览器的网站设置里允许后再开启'
      : '任务在后台完成时发浏览器通知（需要浏览器授权）',
)
async function toggleDesktop() {
  if (desktopOn.value) {
    desktopOn.value = await setDesktopNotify(false)
    message.info('已关闭桌面提醒')
    return
  }
  if (desktopNotifyDenied()) {
    message.warning('浏览器已禁止通知，请在浏览器的网站设置里允许后再开启')
    return
  }
  desktopOn.value = await setDesktopNotify(true)
  if (desktopOn.value) message.success('已开启：任务在后台完成时会发桌面通知')
  else message.warning('没有获得通知授权，未开启')
}

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
    // 遮罩 / Esc 关闭不走 onClose，统一在离场动画结束后释放；确认后由删除流程的 finally 释放
    onAfterLeave: () => {
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

// ---------------- 去查看 / 取消 ----------------

/** 电商入口 entryCode → 页面（对照 docs/container-entry-links.md 附录） */
const ECOMMERCE_ROUTE: Record<string, string> = {
  productSetImages: '/e-commerce/product-kit',
  aPlusDetailPage: '/e-commerce/product-detail',
  hitReplication: '/e-commerce/product-clone',
  aiGestures: '/e-commerce/product-in-hand',
  hitVideo: '/e-commerce/video-hot',
  hitVideoReplication: '/e-commerce/video-clone',
  productReplacement: '/e-commerce/product-replace',
  personReplacement: '/e-commerce/model-replace',
  wearingProductSetImages: '/e-commerce/clothing-kit',
  aiClothExchange: '/e-commerce/clothing-try',
  removeWrinkles: '/e-commerce/clothing-remove-wrinkle',
  shoeSwapping: '/e-commerce/try-shoe',
  backgroundSwitching: '/e-commerce/change-background',
  mergeClothes: '/e-commerce/merge-image',
}
const VIDEO_ENTRIES = new Set(['actionTransfer', 'firstLastFrames'])

/** 同步可知的来源页；认不出返回空串 */
function staticRouteOf(item: ITaskCenterItem): string {
  const code = item.entryCode
  if (!code) return ''
  if (ENTRY_ROUTE[code]) return `${ENTRY_ROUTE[code]}?entryCode=${encodeURIComponent(code)}`
  if (VIDEO_ENTRIES.has(code)) return `/video?entryCode=${encodeURIComponent(code)}`
  return ECOMMERCE_ROUTE[code] ?? ''
}
/** 能显示「去查看」：静态表认得，或属于工具 / 工作流页的任务（点击时按 params 解析） */
const canView = (item: ITaskCenterItem) => !!staticRouteOf(item) || !!item.canRefill

const viewBusy = ref('')
async function goView(item: ITaskCenterItem) {
  const direct = staticRouteOf(item)
  if (direct) {
    await router.push(direct)
    return
  }
  if (viewBusy.value) return
  viewBusy.value = item.taskId
  try {
    const p = (await taskCenterParams(item.taskId)).data
    if (p?.kind === 'workflow' && p.workflowTitle) {
      const to = workflowRouteOf(p.workflowTitle)
      if (to) return void (await router.push(to))
    } else if (p?.kind === 'tool' && p.toolTitle) {
      const tool = toolSchemas.find((x) => x.historyTitle === p.toolTitle)
      if (tool) return void (await router.push(`/tools/${encodeURIComponent(tool.homeId)}`))
    }
    message.warning('暂时无法定位来源页面')
  } catch (e) {
    reportError(e, '打开失败，请重试')
  } finally {
    viewBusy.value = ''
  }
}

const cancelBusy = new Set<string>()
const cancelling = ref('')
/** 只认后端下发的 canCancel：已提交给模型供应商（成本已发生）的任务后端给 false，未下发也不显示 */
const canCancelRow = (item: ITaskCenterItem) => IN_FLIGHT.has(item.statusBucket) && item.canCancel === true

function confirmCancel(item: ITaskCenterItem) {
  if (cancelBusy.has(item.taskId)) return
  cancelBusy.add(item.taskId)
  let confirmed = false
  dialog.warning({
    title: '取消任务',
    content: '确定取消这个任务？未生成的部分会退回点数。',
    positiveText: '确定取消',
    negativeText: '再想想',
    onNegativeClick: () => cancelBusy.delete(item.taskId),
    onAfterLeave: () => {
      if (!confirmed) cancelBusy.delete(item.taskId)
    },
    onPositiveClick: async () => {
      confirmed = true
      cancelling.value = item.taskId
      try {
        await taskCenterCancel(item.taskId)
        message.success('已取消')
        await load(true)
      } catch (e) {
        // 后端拒绝（如「任务已提交到模型处理，无法取消」）的文案由拦截器弹出；随后刷新，让按钮按最新状态收起
        reportError(e, '取消失败，请重试')
        await load(true)
      } finally {
        cancelling.value = ''
        cancelBusy.delete(item.taskId)
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
      // 工具页进页自动消费交接
      message.info(`已打开「${tool.title}」并回填原参数`)
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
/** 预计剩余时间：只给在途任务；ESTIMATED（耗时外推）比 REAL 淡一档 */
const { etaOf } = useTaskEta(items, (item) => IN_FLIGHT.has(item.statusBucket))

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
          <!-- 桌面提醒：只在用户点这里时才请求浏览器授权；已拒绝时说明去浏览器设置里改 -->
          <button
            v-if="desktopSupported"
            type="button"
            class="sx-btn"
            :class="desktopOn && 'sx-btn-tint'"
            :aria-pressed="desktopOn"
            :title="desktopTip"
            @click="toggleDesktop"
          >
            {{ desktopOn ? '桌面提醒：开' : '完成时桌面提醒' }}
          </button>
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
              :data-task-id="item.taskId"
              class="sx-squircle flex items-center gap-12px p-12px rounded-18px border border-solid border-line bg-white [transition:border-color_110ms,box-shadow_110ms] hover:(border-#c9cfd6 shadow-[0_1px_2px_rgba(31,35,41,0.05)])"
              :class="highlightId === item.taskId && '!border-violet shadow-[0_0_0_3px_rgba(124,92,255,0.18)]'"
            >
              <div class="min-w-0 flex-1 flex items-center gap-12px rounded-12px">
                <!-- 缩略 44 / r6：被屏蔽或加载失败走占位；文本产物显示正文首段 -->
                <component
                  :is="previewable(item) ? 'a' : 'span'"
                  v-bind="
                    previewable(item)
                      ? {
                          href: item.coverUrl,
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          tabindex: -1,
                          'aria-hidden': true,
                        }
                      : {}
                  "
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
                      :src="ossResize(item.coverUrl, 44, 44)"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      class="block w-full h-full object-cover"
                      @error="(e: Event) => thumbFallback(e, item.coverUrl) || brokenCovers.add(item.taskId)"
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
                  <span
                    v-if="showProgress(item) || etaOf(item)"
                    class="flex flex-wrap items-center gap-x-8px gap-y-2px max-w-420px"
                  >
                    <span v-if="showProgress(item)" class="flex flex-1 items-center gap-8px min-w-160px max-w-320px">
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
                    <!-- 可见文案每秒倒计时，对读屏隐藏；读屏走粗分档的 srText，只在跨档时播报 -->
                    <span v-if="etaOf(item)" class="flex-none text-11px leading-16px tabular-nums">
                      <span
                        aria-hidden="true"
                        :class="etaOf(item)?.tone === 'real' ? 'text-violet-ink' : 'text-muted'"
                        :title="etaOf(item)?.tone === 'real' ? undefined : '按以往耗时估算，仅供参考'"
                        >{{ etaOf(item)?.text }}</span
                      >
                      <span class="sr-only" aria-live="polite" aria-atomic="true">{{ etaOf(item)?.srText }}</span>
                    </span>
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
                <button
                  v-if="canView(item)"
                  type="button"
                  class="sx-btn-tint !min-h-32px !px-12px !text-13px"
                  :disabled="viewBusy === item.taskId"
                  :aria-label="`去查看：${item.title}`"
                  @click="goView(item)"
                >
                  {{ viewBusy === item.taskId ? '打开中…' : '去查看' }}
                </button>
                <button
                  v-if="canCancelRow(item)"
                  type="button"
                  class="sx-btn-ghost !min-h-32px !px-12px !text-13px hover:!text-danger"
                  :disabled="cancelling === item.taskId"
                  :aria-label="`取消任务 ${item.title}`"
                  @click="confirmCancel(item)"
                >
                  {{ cancelling === item.taskId ? '取消中…' : '取消' }}
                </button>
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
