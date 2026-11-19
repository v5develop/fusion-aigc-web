<script setup lang="ts">
/**
 * 任务中心详情抽屉（右侧滑出；窄屏 ≤640px 全屏）。
 *
 * <p>数据：GET /tasks/{taskId}（状态、进度、ETA、封面、素材库产物、入口名、失败原因、产物类型 / 文案、尺寸、耗时、
 * 收藏 / 回填、子任务摘要）+ GET /tasks/{taskId}/params（原始提交体，供「提交内容」摘要）。
 * 详情字段优先；旧后端缺失时退回列表里同一行（`item`）/ params 补齐，仍取不到就不显示，不做前端推导。点数消耗未下发，不显示。
 * 子任务只展示状态 / 缩略图 / 失败原因（详情接口按父任务查，未确认支持子任务号，不做点击跳转）。
 *
 * <p>实时：订阅全站 taskWatcher 的 task 事件，命中本任务先就地改进度 / 状态，再防抖回查详情（产物、封面、canCancel）；
 * 推送要求 resync 时回查；推送不在线且任务在途时每 8 秒静默回查一次（页面隐藏不查）。
 *
 * <p>操作只发事件，由任务中心页复用列表已有的取消 / 去查看 / 做同款 / 参数回填流程。
 * 产物展示用水印副本（有则用），下载与「用于画布」用原件（同 utils/download 的口径）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NDrawer, NDrawerContent, useMessage } from 'naive-ui'
import { getQuiet, toApiError } from '@/api/index.ts'
import type { ITaskCenterItem, ITaskCenterParams, ITaskCenterTask } from '@/api/task-center.ts'
import IconButton from '@/components/IconButton/index.vue'
import SaveJpgButton from '@/components/SaveJpgButton/index.vue'
import MediaFallback from '@/components/MediaFallback/index.vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { downloadImage, downloadImagesAsZip } from '@/utils/download'
import { cardThumb, isVideoUrl, ossResize, thumbFallback } from '@/utils/oss'
import { useTaskEta } from '@/utils/task-eta'
import { onTaskEvent, onTaskResync, taskStreamLive, type TaskStreamEvent } from '@/utils/taskWatcher'
import { useAssetsInCanvas, type ICanvasAssetRef } from '@/views/asset-library/useInCanvas'
import { summarizeInput } from './input-summary'
import { CHIP_CLS, DOT_CLS, IN_FLIGHT } from './status'

/** 打开的任务号；空串 = 关闭 */
const taskId = defineModel<string>('taskId', { default: '' })

const props = defineProps<{
  /** 列表里同一任务的行（不在当前页时为 null） */
  item: ITaskCenterItem | null
  /** 能否「去查看」（来源页由任务中心按入口 / 回填能力解析，与列表同一函数） */
  canViewOf: (item: ITaskCenterItem) => boolean
  cancelling: boolean
  viewBusy: boolean
  /** 在途的回填：'same' / 'refill' / '' */
  refillBusy: string
}>()

const emit = defineEmits<{
  cancel: [item: ITaskCenterItem]
  view: [item: ITaskCenterItem]
  refill: [item: ITaskCenterItem, mode: 'same' | 'refill']
}>()

const router = useRouter()
const message = useMessage()
const { opening: canvasOpening, openAssetsInCanvas } = useAssetsInCanvas()

const POLL_MS = 8000
const REFETCH_DEBOUNCE_MS = 600
const FOCUS = 'sx-focus'

const open = computed(() => !!taskId.value)

// ---------------- 窄屏全屏 ----------------

const MOBILE_QUERY = '(max-width: 640px)'
const mobile = ref(false)
let mql: MediaQueryList | null = null
const onMql = (e: MediaQueryListEvent) => (mobile.value = e.matches)
onMounted(() => {
  mql = window.matchMedia?.(MOBILE_QUERY) ?? null
  mobile.value = !!mql?.matches
  mql?.addEventListener?.('change', onMql)
})

// ---------------- 数据 ----------------

const detail = ref<ITaskCenterTask | null>(null)
const params = ref<ITaskCenterParams | null>(null)
const loading = ref(false)
/** '' = 正常；notFound = 任务不存在 / 已删除；error = 其它失败（可重试） */
const loadState = ref<'' | 'notFound' | 'error'>('')
let seq = 0

const rowItem = computed(() => (props.item && props.item.taskId === taskId.value ? props.item : null))

async function fetchDetail(silent: boolean) {
  const id = taskId.value
  if (!id) return
  const my = ++seq
  if (!silent) {
    loading.value = true
    loadState.value = ''
  }
  try {
    const res = await getQuiet<ITaskCenterTask>(`/api/v1/creation/task-center/tasks/${encodeURIComponent(id)}`)
    if (my !== seq || id !== taskId.value) return
    if (!res.data) {
      if (!silent) loadState.value = 'notFound'
      return
    }
    detail.value = res.data
    loadState.value = ''
  } catch (e) {
    if (my !== seq || id !== taskId.value) return
    const err = toApiError(e)
    const gone = err?.httpStatus === 404 || err?.code === 4001 || !!err?.message?.includes('不存在')
    if (gone) {
      // 任务被删了（含轮询 / 推送回查期间）：清掉旧详情、停掉轮询与待发的回查，转「任务不存在」态
      detail.value = null
      params.value = null
      if (refetchTimer) clearTimeout(refetchTimer)
      refetchTimer = null
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      loadState.value = 'notFound'
      return
    }
    if (silent && detail.value) return
    loadState.value = 'error'
  } finally {
    if (my === seq) loading.value = false
  }
}

async function fetchParams() {
  const id = taskId.value
  if (!id) return
  try {
    const res = await getQuiet<ITaskCenterParams>(
      `/api/v1/creation/task-center/tasks/${encodeURIComponent(id)}/params`,
    )
    if (id === taskId.value) params.value = res.data ?? null
  } catch {
    // 拿不到提交参数：「提交内容」不显示，其余照常
  }
}

/** 供任务中心在取消等操作后主动刷新 */
function refresh() {
  void fetchDetail(true)
}
defineExpose({ refresh })

let refetchTimer: ReturnType<typeof setTimeout> | null = null
function refetchSoon() {
  if (refetchTimer) clearTimeout(refetchTimer)
  refetchTimer = setTimeout(() => {
    refetchTimer = null
    if (open.value) void fetchDetail(true)
  }, REFETCH_DEBOUNCE_MS)
}


// 列表那一行的状态桶变了（任务中心整页刷新 / 推送）：回查详情对齐
watch(
  () => rowItem.value?.statusBucket,
  (bucket) => {
    if (bucket && detail.value && bucket !== detail.value.statusBucket) refetchSoon()
  },
)

// ---------------- 实时推送 ----------------

function onLive(ev: TaskStreamEvent) {
  if (!open.value || ev.taskId !== taskId.value) return
  const d = detail.value
  if (d) {
    detail.value = {
      ...d,
      statusBucket: ev.statusBucket,
      ...(ev.status != null ? { status: ev.status } : {}),
      ...(ev.statusLabel ? { statusLabel: ev.statusLabel } : {}),
      ...(ev.progress != null ? { progress: ev.progress } : {}),
      etaSeconds: ev.etaSeconds ?? null,
      ...(ev.progressSource ? { progressSource: ev.progressSource } : {}),
    }
  }
  refetchSoon()
}

const offTask = onTaskEvent(onLive)
const offResync = onTaskResync(() => {
  if (open.value) refetchSoon()
})

const inFlight = computed(() => !!detail.value && IN_FLIGHT.has(detail.value.statusBucket))
let pollTimer: ReturnType<typeof setInterval> | null = null
watch(
  [open, inFlight, taskStreamLive],
  ([o, f, live]) => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    if (o && f && !live)
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') void fetchDetail(true)
      }, POLL_MS)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  offTask()
  offResync()
  if (pollTimer) clearInterval(pollTimer)
  if (refetchTimer) clearTimeout(refetchTimer)
  mql?.removeEventListener?.('change', onMql)
})

// ---------------- 展示用合并视图 ----------------

/** 详情 + 列表行 + params 合成的一行（操作沿用列表的处理函数） */
const view = computed<ITaskCenterItem | null>(() => {
  const d = detail.value
  const row = rowItem.value
  if (!d) return null
  const p = params.value
  const entryName = d.typeName || row?.typeName || p?.entryName || ''
  return {
    taskId: d.taskId,
    entryCode: d.entryCode || row?.entryCode || p?.entryCode || '',
    typeName: entryName,
    title: d.title || row?.title || [entryName || '创作任务', d.taskId.slice(-10)].join(' '),
    status: d.status,
    statusBucket: d.statusBucket,
    statusLabel: d.statusLabel,
    createTime: d.createTime,
    progress: d.progress ?? null,
    etaSeconds: d.etaSeconds ?? null,
    progressSource: d.progressSource ?? null,
    resultType: d.resultType ?? row?.resultType ?? null,
    coverUrl: d.coverUrl || null,
    coverThumbnailUrl: d.coverThumbnailUrl || null,
    resultText: d.resultText ?? row?.resultText ?? null,
    width: d.width ?? row?.width ?? null,
    height: d.height ?? row?.height ?? null,
    failReason: d.statusBucket === 'failed' ? (d.failReason ?? row?.failReason ?? null) : null,
    canCancel: d.canCancel ?? row?.canCancel ?? null,
    assetGroupId: d.assetGroupId,
    blocked: d.blocked,
    collected: d.collected ?? row?.collected ?? null,
    canRefill: d.canRefill ?? row?.canRefill ?? (p ? p.refillable : null),
  }
})

/** 头部元信息：尺寸 / 耗时 / 完成时间（缺失即不显示） */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`
}
const sizeText = computed(() => {
  const v = view.value
  return v?.width && v?.height ? `${v.width} × ${v.height}` : ''
})
const durationText = computed(() => {
  const sec = detail.value?.durationSeconds
  return sec != null && sec >= 0 ? `耗时 ${formatDuration(sec)}` : ''
})
const finishedAt = computed(() => detail.value?.finishedAt || '')

// ---------------- 子任务 ----------------

const children = computed(() => detail.value?.children ?? [])
const brokenChildren = ref(new Set<string>())

const etaList = computed(() => (detail.value ? [detail.value] : []))
const { etaOf } = useTaskEta(etaList, (d) => IN_FLIGHT.has(d.statusBucket))
const eta = computed(() => (detail.value ? etaOf(detail.value) : null))
const showProgress = computed(() => inFlight.value && detail.value?.progress != null)

const canCancel = computed(() => !!view.value && IN_FLIGHT.has(view.value.statusBucket) && view.value.canCancel === true)
const canRefill = computed(() => !!view.value?.canRefill)
const canView = computed(() => !!view.value && props.canViewOf(view.value))

// ---------------- 产物 ----------------

interface ResultMedia {
  key: string
  /** 原件：下载 / 用于画布 */
  original: string
  /** 展示：有水印副本用副本 */
  display: string
  thumb: string
  thumbOriginal: string
  video: boolean
  /** 只有封面（视频任务未拿到素材库产物）：不给下载 / 用于画布 */
  coverOnly: boolean
}

const brokenThumbs = ref(new Set<string>())

const results = computed<ResultMedia[]>(() => {
  const d = detail.value
  if (!d || d.blocked) return []
  const typeVideo = view.value?.resultType === 'video'
  const list = (d.assets ?? [])
    .filter((a) => !!a.image)
    .map<ResultMedia>((a) => {
      const video = a.mediaType
        ? a.mediaType === 'video'
        : isVideoUrl(a.image) || typeVideo
      const cover = a.cover || (video ? '' : a.watermark || a.image)
      return {
        key: String(a.id ?? a.image),
        original: a.image,
        display: video ? a.image : a.watermark || a.image,
        thumb: cover ? cardThumb(cover, a.coverThumbnailUrl, 240, 240) : '',
        thumbOriginal: cover,
        video,
        coverOnly: false,
      }
    })
  if (list.length) return list
  // 素材库暂无产物引用：成功任务退回封面
  if (d.statusBucket === 'success' && d.coverUrl) {
    return [
      {
        key: 'cover',
        original: d.coverUrl,
        display: d.coverUrl,
        thumb: cardThumb(d.coverUrl, d.coverThumbnailUrl, 240, 240),
        thumbOriginal: d.coverUrl,
        video: false,
        coverOnly: typeVideo,
      },
    ]
  }
  return []
})

const libraryCount = computed(() => detail.value?.assets?.filter((a) => !!a.image).length ?? 0)
const downloadable = computed(() => results.value.filter((r) => !r.coverOnly))

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const lightboxItems = computed<LightboxItem[]>(() =>
  results.value.map((r, i) => ({
    url: r.display,
    type: r.video ? 'video' : 'image',
    original: r.original,
    name: `${view.value?.typeName || '作品'}_${i + 1}`,
  })),
)
function preview(i: number) {
  lightboxIndex.value = i
  lightboxOpen.value = true
}

const downloading = ref('')
async function download(r: ResultMedia) {
  if (downloading.value) return
  downloading.value = r.key
  try {
    await downloadImage(r.original)
  } finally {
    downloading.value = ''
  }
}
async function downloadAll() {
  if (downloading.value) return
  downloading.value = '__all'
  try {
    await downloadImagesAsZip(downloadable.value.map((r) => r.original))
  } catch {
    message.error('打包下载失败，请逐个下载')
  } finally {
    downloading.value = ''
  }
}

function toCanvasRefs(list: ResultMedia[]): ICanvasAssetRef[] {
  const title = view.value?.typeName || null
  return list.map((r) =>
    r.video ? { media: 'video', video_url: r.original, title } : { media: 'image', image: r.original, title },
  )
}
function useInCanvas(list: ResultMedia[]) {
  void openAssetsInCanvas(toCanvasRefs(list))
}

// ---------------- 提交内容 ----------------

const input = computed(() => summarizeInput(params.value?.requestParams ?? null))
const brokenRefs = ref(new Set<string>())

// ---------------- 切换任务（放在所有状态声明之后：immediate 首轮会重置它们） ----------------

watch(
  taskId,
  (id) => {
    detail.value = null
    params.value = null
    loadState.value = ''
    brokenThumbs.value = new Set()
    brokenRefs.value = new Set()
    brokenChildren.value = new Set()
    lightboxOpen.value = false
    seq++
    if (!id) return
    void fetchDetail(false)
    void fetchParams()
  },
  { immediate: true },
)

// ---------------- 杂项 ----------------

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(ok)
  } catch {
    message.warning('浏览器不允许复制，请手动选中后复制')
  }
}

function close() {
  taskId.value = ''
}

function goLibrary() {
  void router.push('/assets')
}
</script>

<template>
  <n-drawer
    :show="open"
    placement="right"
    :width="mobile ? '100%' : 560"
    :trap-focus="!lightboxOpen"
    :close-on-esc="!lightboxOpen"
    :auto-focus="true"
    aria-labelledby="tcd-title"
    @update:show="(v: boolean) => !v && close()"
  >
    <n-drawer-content :native-scrollbar="true" :body-content-style="{ padding: 0 }">
      <div class="min-h-full flex flex-col bg-surface text-ink">
        <!-- 头部：入口名 / 状态 / 时间 / 编号 -->
        <header
          class="sticky top-0 z-2 flex items-start gap-12px px-20px pt-16px pb-14px bg-surface border-b border-b-solid border-line"
        >
          <div class="min-w-0 flex-1 flex flex-col gap-6px">
            <div class="flex items-center gap-8px min-w-0">
              <h2 id="tcd-title" class="m-0 truncate text-17px font-600 leading-24px">
                {{ view?.typeName || '任务详情' }}
              </h2>
              <span
                v-if="view"
                class="inline-flex flex-none items-center h-20px px-8px rounded-full text-12px leading-18px whitespace-nowrap"
                :class="CHIP_CLS[view.statusBucket] ?? CHIP_CLS.cancelled"
              >
                <i
                  class="w-5px h-5px rounded-full mr-4px"
                  :class="DOT_CLS[view.statusBucket] ?? 'bg-placeholder'"
                  aria-hidden="true"
                ></i>
                {{ view.statusLabel }}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-x-12px gap-y-4px text-12px leading-18px text-muted">
              <span v-if="view?.createTime" class="tabular-nums">提交于 {{ view.createTime }}</span>
              <span v-if="finishedAt" class="tabular-nums">完成于 {{ finishedAt }}</span>
              <span v-if="durationText" class="tabular-nums">{{ durationText }}</span>
              <span v-if="sizeText" class="tabular-nums">{{ sizeText }}</span>
              <span class="inline-flex items-center gap-4px min-w-0">
                <span class="tabular-nums select-all break-all">{{ taskId }}</span>
                <IconButton size="sm" variant="quiet" label="复制任务编号" @click="copy(taskId, '任务编号已复制')">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
                  </svg>
                </IconButton>
              </span>
            </div>
          </div>
          <IconButton variant="quiet" label="关闭详情" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </header>

        <!-- 首次加载 -->
        <div v-if="loading && !detail" class="flex flex-col gap-12px p-20px" aria-busy="true">
          <span class="block w-[60%] h-14px rounded-4px bg-sunken animate-pulse" />
          <span class="block w-full h-180px rounded-12px bg-sunken animate-pulse" />
          <span class="block w-[40%] h-12px rounded-4px bg-sunken animate-pulse" />
          <span class="sr-only" role="status">正在加载任务详情…</span>
        </div>

        <div v-else-if="loadState === 'notFound'" class="p-20px">
          <PageLoadError title="任务不存在或已删除" subtitle="可以回到列表查看其它任务" />
        </div>

        <div v-else-if="loadState === 'error' && !detail" class="p-20px">
          <PageLoadError title="任务详情加载失败" subtitle="请检查网络后重试" retryable @retry="fetchDetail(false)" />
        </div>

        <div v-else-if="view" class="flex-1 flex flex-col gap-20px px-20px py-18px">
          <!-- 进度 -->
          <section v-if="showProgress || eta" aria-labelledby="tcd-progress" class="flex flex-col gap-8px">
            <h3 id="tcd-progress" class="m-0 text-13px font-600 text-ink-2">生成进度</h3>
            <div v-if="showProgress" class="flex items-center gap-10px">
              <span
                class="relative flex-1 h-6px overflow-hidden rounded-full bg-sunken"
                role="progressbar"
                :aria-valuenow="view.progress ?? 0"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="生成进度"
              >
                <span
                  class="absolute inset-y-0 left-0 rounded-full sx-grad-progress transition-[width] duration-300"
                  :style="{ width: `${view.progress}%` }"
                />
              </span>
              <span class="flex-none text-13px tabular-nums text-violet-ink">{{ view.progress }}%</span>
            </div>
            <p v-if="eta" class="m-0 text-12px leading-18px tabular-nums">
              <span
                aria-hidden="true"
                :class="eta.tone === 'real' ? 'text-violet-ink' : 'text-muted'"
                :title="eta.tone === 'real' ? undefined : '按以往耗时估算，仅供参考'"
                >{{ eta.text }}{{ eta.tone === 'real' ? '' : '（估算）' }}</span
              >
              <span class="sr-only" aria-live="polite" aria-atomic="true">{{ eta.srText }}</span>
            </p>
          </section>

          <!-- 失败原因 -->
          <section
            v-if="view.statusBucket === 'failed'"
            aria-labelledby="tcd-fail"
            class="sx-squircle flex flex-col gap-6px p-14px rounded-14px border border-solid border-danger-line bg-danger-soft"
          >
            <h3 id="tcd-fail" class="m-0 text-13px font-600 text-danger">生成未成功</h3>
            <p class="m-0 text-13px leading-20px text-ink-2 break-words">
              {{ view.failReason || '这次没有生成出结果，可以调整参数后重新提交。' }}
            </p>
            <p v-if="canRefill" class="m-0 text-12px leading-18px text-muted">
              点下方「参数回填」把原参数填回去，修改后再提交。
            </p>
          </section>

          <p
            v-if="view.statusBucket === 'cancelled'"
            class="m-0 p-12px rounded-12px bg-surface3 text-13px leading-20px text-ink-2"
          >
            任务已取消，未生成的部分已按规则退回点数。
          </p>

          <!-- 结果 -->
          <section v-if="view.blocked" aria-labelledby="tcd-result" class="flex flex-col gap-10px">
            <h3 id="tcd-result" class="m-0 text-13px font-600 text-ink-2">生成结果</h3>
            <div class="w-160px h-160px rounded-12px overflow-hidden border border-solid border-line">
              <MediaFallback :type="view.resultType === 'video' ? 'video' : 'image'" reason="blocked" />
            </div>
            <p class="m-0 text-12px leading-18px text-muted">内容未通过审核或已被屏蔽，无法查看与下载。</p>
          </section>

          <section v-else-if="results.length || view.resultText" aria-labelledby="tcd-result" class="flex flex-col gap-10px">
            <div class="flex flex-wrap items-center gap-8px">
              <h3 id="tcd-result" class="m-0 text-13px font-600 text-ink-2">
                生成结果<span v-if="results.length > 1" class="ml-4px text-muted font-400">{{ results.length }}</span>
              </h3>
              <span class="ml-auto flex flex-wrap items-center gap-8px">
                <button
                  v-if="downloadable.length > 1"
                  type="button"
                  class="sx-btn-ghost !min-h-32px !px-10px !text-13px"
                  :disabled="!!downloading"
                  @click="downloadAll"
                >
                  {{ downloading === '__all' ? '打包中…' : '全部下载' }}
                </button>
                <button
                  v-if="downloadable.length > 1"
                  type="button"
                  class="sx-btn-tint !min-h-32px !px-10px !text-13px"
                  :disabled="canvasOpening"
                  @click="useInCanvas(downloadable)"
                >
                  全部用于画布
                </button>
              </span>
            </div>

            <ul
              v-if="results.length"
              class="m-0 p-0 list-none grid gap-10px"
              :class="results.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'"
            >
              <li
                v-for="(r, i) in results"
                :key="r.key"
                class="group relative flex flex-col overflow-hidden rounded-12px border border-solid border-line bg-surface3"
              >
                <button
                  type="button"
                  class="relative block w-full p-0 border-0 bg-transparent cursor-zoom-in"
                  :class="[FOCUS, results.length === 1 ? 'aspect-[4/3]' : 'aspect-square']"
                  :aria-label="`预览第 ${i + 1} 个结果${r.video ? '（视频）' : ''}`"
                  @click="preview(i)"
                >
                  <img
                    v-if="r.thumb && !brokenThumbs.has(r.key)"
                    :src="r.thumb"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="block w-full h-full"
                    :class="results.length === 1 ? 'object-contain' : 'object-cover'"
                    @error="(e: Event) => thumbFallback(e, r.thumbOriginal) || brokenThumbs.add(r.key)"
                  />
                  <video
                    v-else-if="r.video && !brokenThumbs.has(r.key)"
                    :src="r.display"
                    preload="metadata"
                    muted
                    playsinline
                    class="block w-full h-full object-cover pointer-events-none"
                    @error="brokenThumbs.add(r.key)"
                  />
                  <MediaFallback v-else :type="r.video ? 'video' : 'image'" reason="loadFailed" />
                  <span
                    v-if="r.video"
                    class="absolute left-6px bottom-6px px-6px rounded-4px bg-black/55 text-11px leading-16px text-white"
                    aria-hidden="true"
                    >{{ r.coverOnly ? '视频封面' : '视频' }}</span
                  >
                </button>
                <div v-if="!r.coverOnly" class="flex items-center justify-end gap-8px px-6px py-4px bg-surface">
                  <IconButton
                    size="sm"
                    variant="quiet"
                    :label="`下载第 ${i + 1} 个结果`"
                    :loading="downloading === r.key"
                    :disabled="!!downloading"
                    @click="download(r)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                    </svg>
                  </IconButton>
                  <SaveJpgButton v-if="!r.video" :url="r.original" :name="`${view?.typeName || '作品'}_${i + 1}`" size="sm" variant="quiet" :disabled="!!downloading" />
                  <IconButton
                    size="sm"
                    variant="quiet"
                    :label="`第 ${i + 1} 个结果用于画布`"
                    :disabled="canvasOpening"
                    @click="useInCanvas([r])"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                  </IconButton>
                </div>
              </li>
            </ul>

            <div
              v-if="view.resultText"
              class="relative p-12px pr-44px rounded-12px border border-solid border-line bg-surface2 text-13px leading-21px text-ink whitespace-pre-wrap break-words"
            >
              {{ view.resultText }}
              <span class="absolute right-6px top-6px">
                <IconButton size="sm" variant="quiet" label="复制文案" @click="copy(view.resultText!, '文案已复制')">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
                  </svg>
                </IconButton>
              </span>
            </div>

            <!-- 素材库收录状态：详情的 assets 就是素材库里该任务的产物 -->
            <p
              v-if="view.statusBucket === 'success' && results.length"
              class="m-0 flex flex-wrap items-center gap-8px text-12px leading-18px text-muted"
            >
              <template v-if="libraryCount">
                <span class="inline-flex items-center gap-4px text-success">
                  <svg
                    class="w-14px h-14px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  已存入素材库 {{ libraryCount }} 件
                </span>
                <button
                  type="button"
                  class="p-0 border-0 bg-transparent text-12px text-violet-ink underline cursor-pointer rounded-4px"
                  :class="FOCUS"
                  @click="goLibrary"
                >
                  去素材库
                </button>
              </template>
              <span v-else>素材库还在收录中，稍后可在素材库查看</span>
            </p>
          </section>

          <p
            v-else-if="view.statusBucket === 'success'"
            class="m-0 text-13px leading-20px text-muted"
          >
            暂无可预览的结果，可以到素材库查看。
          </p>

          <!-- 子任务 -->
          <section v-if="children.length" aria-labelledby="tcd-children" class="flex flex-col gap-10px">
            <h3 id="tcd-children" class="m-0 text-13px font-600 text-ink-2">
              子任务<span class="ml-4px text-muted font-400">{{ children.length }}</span>
            </h3>
            <ul class="m-0 p-0 list-none flex flex-col gap-8px">
              <li
                v-for="(c, i) in children"
                :key="c.taskId"
                class="flex items-start gap-10px p-8px rounded-12px border border-solid border-line bg-surface2"
              >
                <span
                  class="grid place-items-center flex-none w-44px h-44px overflow-hidden rounded-8px bg-surface3 text-11px text-muted"
                >
                  <img
                    v-if="c.coverThumbnailUrl && !brokenChildren.has(c.taskId)"
                    :src="c.coverThumbnailUrl"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="block w-full h-full object-cover"
                    @error="brokenChildren.add(c.taskId)"
                  />
                  <span v-else aria-hidden="true">{{ i + 1 }}</span>
                </span>
                <div class="min-w-0 flex-1 flex flex-col gap-4px">
                  <span
                    class="inline-flex w-fit items-center h-20px px-8px rounded-full text-12px leading-18px whitespace-nowrap"
                    :class="CHIP_CLS[c.statusBucket] ?? CHIP_CLS.cancelled"
                  >
                    <i
                      class="w-5px h-5px rounded-full mr-4px"
                      :class="DOT_CLS[c.statusBucket] ?? 'bg-placeholder'"
                      aria-hidden="true"
                    ></i>
                    {{ c.statusLabel }}
                  </span>
                  <p v-if="c.failReason" class="m-0 text-12px leading-18px text-danger break-words">
                    {{ c.failReason }}
                  </p>
                </div>
              </li>
            </ul>
          </section>

          <!-- 提交内容 -->
          <section v-if="input" aria-labelledby="tcd-input" class="flex flex-col gap-10px">
            <h3 id="tcd-input" class="m-0 text-13px font-600 text-ink-2">提交内容</h3>
            <div v-if="input.prompt" class="flex flex-col gap-4px">
              <span class="text-12px text-muted">提示词</span>
              <div class="relative p-12px pr-44px rounded-12px bg-surface2 border border-solid border-line">
                <p class="m-0 text-13px leading-21px text-ink whitespace-pre-wrap break-words line-clamp-8">
                  {{ input.prompt }}
                </p>
                <span class="absolute right-6px top-6px">
                  <IconButton size="sm" variant="quiet" label="复制提示词" @click="copy(input.prompt, '提示词已复制')">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
                    </svg>
                  </IconButton>
                </span>
              </div>
            </div>
            <div v-if="input.negativePrompt" class="flex flex-col gap-4px">
              <span class="text-12px text-muted">不希望出现</span>
              <p class="m-0 text-13px leading-20px text-ink-2 whitespace-pre-wrap break-words">
                {{ input.negativePrompt }}
              </p>
            </div>
            <div v-if="input.refs.length" class="flex flex-col gap-6px">
              <span class="text-12px text-muted">参考素材 {{ input.refs.length }}</span>
              <ul class="m-0 p-0 list-none flex flex-wrap gap-8px">
                <li v-for="(ref, i) in input.refs" :key="ref.url">
                  <a
                    :href="ref.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="relative grid place-items-center w-56px h-56px overflow-hidden rounded-8px border border-solid border-line bg-surface3 text-11px text-muted no-underline"
                    :class="FOCUS"
                    :aria-label="`在新标签页打开参考素材 ${i + 1}${ref.video ? '（视频）' : ''}`"
                  >
                    <span v-if="ref.video" aria-hidden="true">视频</span>
                    <img
                      v-else-if="!brokenRefs.has(ref.url)"
                      :src="ossResize(ref.url, 112)"
                      alt=""
                      loading="lazy"
                      class="block w-full h-full object-cover"
                      @error="(e: Event) => thumbFallback(e, ref.url) || brokenRefs.add(ref.url)"
                    />
                    <span v-else aria-hidden="true">素材</span>
                  </a>
                </li>
              </ul>
            </div>
            <dl
              v-if="input.model || input.params.length"
              class="m-0 grid grid-cols-[auto_1fr] gap-x-16px gap-y-6px text-13px leading-20px"
            >
              <template v-if="input.model">
                <dt class="text-muted">模型</dt>
                <dd class="m-0 text-ink break-words">{{ input.model }}</dd>
              </template>
              <template v-for="p in input.params" :key="p.label">
                <dt class="text-muted">{{ p.label }}</dt>
                <dd class="m-0 text-ink break-words">{{ p.value }}</dd>
              </template>
            </dl>
            <details v-if="input.extra.length" class="text-12px leading-18px">
              <summary class="w-fit cursor-pointer text-muted rounded-4px" :class="FOCUS">
                更多参数（{{ input.extra.length }}）
              </summary>
              <dl class="m-0 mt-6px grid grid-cols-[auto_1fr] gap-x-16px gap-y-4px">
                <template v-for="p in input.extra" :key="p.label">
                  <dt class="text-muted font-mono">{{ p.label }}</dt>
                  <dd class="m-0 text-ink-2 break-all">{{ p.value }}</dd>
                </template>
              </dl>
            </details>
          </section>
        </div>
      </div>

      <template v-if="view && (canCancel || canView || canRefill)" #footer>
        <div class="w-full flex flex-wrap items-center justify-end gap-8px">
          <button
            v-if="canCancel"
            type="button"
            class="sx-btn-ghost !min-h-36px !px-14px !text-13px hover:!text-danger mr-auto"
            :disabled="cancelling"
            @click="emit('cancel', view)"
          >
            {{ cancelling ? '取消中…' : '取消任务' }}
          </button>
          <button
            v-if="canView"
            type="button"
            class="sx-btn-tint !min-h-36px !px-14px !text-13px"
            :disabled="viewBusy"
            @click="emit('view', view)"
          >
            {{ viewBusy ? '打开中…' : '去查看' }}
          </button>
          <template v-if="canRefill">
            <button
              type="button"
              class="sx-btn-ghost !min-h-36px !px-14px !text-13px"
              :disabled="!!refillBusy"
              title="套用这次的设置，换上自己的素材"
              @click="emit('refill', view, 'same')"
            >
              {{ refillBusy === 'same' ? '打开中…' : '做同款' }}
            </button>
            <button
              type="button"
              :class="view.statusBucket === 'failed' ? 'sx-btn-primary' : 'sx-btn-ghost'"
              class="!min-h-36px !px-14px !text-13px"
              :disabled="!!refillBusy"
              title="把原参数原样填回，改完再提交"
              @click="emit('refill', view, 'refill')"
            >
              {{ refillBusy === 'refill' ? '打开中…' : '参数回填' }}
            </button>
          </template>
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>

  <MediaLightbox v-model:show="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems" pannable />
</template>
