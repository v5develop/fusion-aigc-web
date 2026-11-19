<script setup lang="ts">
/**
 * 画布右侧「生成历史」栏（2026-11-19 取代生成卡控制台）：本画布的执行记录，新的在前。
 *
 * <p>数据源：Go GET /api/v1/canvas/canvases/{id}/runs（canvasRuns，最近 50 条）。记录里有状态 / 模型 / 点数 / 候选 / 时间，
 * 没有画质等提交参数，所以只显示实际产物尺寸（候选宽高）而不显示画质。打开时拉一次；画布上有节点开始 / 结束运行
 * （runningCount 变化）时防抖重拉；列表里有在途记录时每 5 秒刷新一次；头部可手动刷新。
 *
 * <p>开合与画布助手同一套（顶栏按钮切换、在流内 360 宽、按账号记住），两者共用右侧一个位置、一次只开一个；
 * 打开后可以像左侧「画布资产」栏那样向右折叠成 48 宽的缩略轨。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { modelLabelOf } from '@/utils/model-label'
import { downloadImage } from '@/utils/download.ts'
import { canvasRuns, type ICanvasRunResult } from '@/api/canvas-home.ts'
import EditorIcon from './EditorIcon.vue'
import NodeLightbox from './nodes/NodeLightbox.vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import { FOCUS_RING } from './ui.ts'

const props = defineProps<{ canvasId: string }>()
const collapsed = defineModel<boolean>('collapsed', { default: false })
const emit = defineEmits<{ close: []; locate: [id: string] }>()

const store = useCanvasEditor()

const runs = ref<ICanvasRunResult[]>([])
const loading = ref(false)
const loaded = ref(false)
const failed = ref(false)

let seq = 0
async function load() {
  const id = props.canvasId
  if (!id) return
  const mine = ++seq
  loading.value = true
  try {
    const res = await canvasRuns(id, 50)
    if (mine !== seq) return
    runs.value = res.data?.items ?? []
    failed.value = false
  } catch {
    if (mine === seq) failed.value = true
  } finally {
    if (mine === seq) {
      loading.value = false
      loaded.value = true
    }
  }
}

watch(
  () => props.canvasId,
  () => {
    runs.value = []
    loaded.value = false
    void load()
  },
  { immediate: true },
)

// 节点开始 / 结束运行：稍等服务端落记录再拉
let reloadTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => store.runningCount.value,
  () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => void load(), 1200)
  },
)
const IN_FLIGHT = new Set(['submitting', 'queued', 'running'])
const hasInFlight = computed(() => runs.value.some((run) => IN_FLIGHT.has(run.status)))
let pollTimer: ReturnType<typeof setInterval> | undefined
watch(
  hasInFlight,
  (value) => {
    clearInterval(pollTimer)
    if (value) pollTimer = setInterval(() => document.visibilityState !== 'hidden' && void load(), 5000)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(reloadTimer)
  clearInterval(pollTimer)
})

// ---------------- 行展示 ----------------

const STATUS: Record<string, { label: string; cls: string }> = {
  submitting: { label: '运行中', cls: 'border-violet-line bg-violet-soft text-violet-ink' },
  queued: { label: '排队中', cls: 'border-violet-line bg-violet-soft text-violet-ink' },
  running: { label: '运行中', cls: 'border-violet-line bg-violet-soft text-violet-ink' },
  succeeded: { label: '成功', cls: 'border-success-line bg-success-soft text-success' },
  failed: { label: '失败', cls: 'border-danger-line bg-danger-soft text-danger' },
  cancelled: { label: '已取消', cls: 'border-line bg-surface2 text-muted' },
}
function statusOf(run: ICanvasRunResult) {
  return STATUS[run.status] ?? { label: run.status || '未知', cls: 'border-line bg-surface2 text-muted' }
}

/** 每个节点最近一次成功的 run：它的候选就是节点现在的候选，只有它能「设为输出」 */
const latestSucceeded = computed(() => {
  const map = new Map<string, string>()
  for (const run of runs.value) {
    if (run.status === 'succeeded' && !map.has(run.nodeId)) map.set(run.nodeId, run.requestId)
  }
  return map
})

interface IRow {
  run: ICanvasRunResult
  key: string
  title: string
  exists: boolean
  isVideo: boolean
  status: { label: string; cls: string }
  meta: string
  points: string
  time: string
  /** 可设为输出（节点现存、是它最近一次成功 run、候选数对得上、多于 1 张） */
  selectable: boolean
  selectedIndex: number
  hidden: Set<number>
}

const rows = computed<IRow[]>(() =>
  runs.value.map((run) => {
    const node = store.findNode(run.nodeId)
    const isVideo = run.kind === 'video' || Boolean(run.videoUrl)
    const first = run.candidates?.[0]
    const size = first?.width && first?.height ? `${first.width}×${first.height}` : ''
    const count =
      run.status === 'succeeded' && run.requestedCount > 1
        ? `${run.candidates.length}/${run.requestedCount} 张`
        : run.requestedCount > 1
          ? `${run.requestedCount} 张`
          : ''
    const isLatest = latestSucceeded.value.get(run.nodeId) === run.requestId
    const selectable =
      Boolean(node) &&
      !isVideo &&
      isLatest &&
      run.candidates.length > 1 &&
      (node?.data.candidates?.length ?? 0) === run.candidates.length
    return {
      run,
      key: run.requestId || run.runId,
      title: node?.data.title || (node ? '生成节点' : '已删除的节点'),
      exists: Boolean(node),
      isVideo,
      status: statusOf(run),
      meta: [modelLabelOf(run.model) || run.kind || '', size, count].filter(Boolean).join(' · '),
      points: run.credits > 0 ? `${run.credits} 点` : '',
      time: formatTime(run.createdAt),
      selectable,
      selectedIndex: selectable ? (node?.data.selectedCandidate ?? 0) : run.selectedIndex,
      hidden: selectable && node ? store.hiddenCandidatesOf(node.data) : new Set<number>(),
    }
  }),
)

function formatTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return hm
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function locate(row: IRow) {
  if (row.exists) emit('locate', row.run.nodeId)
}

function setOutput(row: IRow, index: number) {
  if (row.selectable) void store.selectCandidate(row.run.nodeId, index)
}

// ---------------- 预览 / 下载 ----------------

const lightboxShow = ref(false)
const lightboxIndex = ref(0)
const lightboxRow = ref<IRow | null>(null)
const lightboxItems = computed(() => {
  const row = lightboxRow.value
  if (!row) return []
  if (row.isVideo && row.run.videoUrl) return [{ url: row.run.videoUrl, type: 'video' as const, name: row.title }]
  return row.run.candidates.map((item, i) => ({ url: item.url, type: 'image' as const, name: `${row.title}-${i + 1}` }))
})
function preview(row: IRow, index: number) {
  lightboxRow.value = row
  lightboxIndex.value = row.isVideo ? 0 : index
  lightboxShow.value = true
}
function download(row: IRow, index: number) {
  const url = row.isVideo && row.run.videoUrl ? row.run.videoUrl : row.run.candidates[index]?.url
  if (url) void downloadImage(url, undefined)
}

/** 缩略轨：每条记录一个 32px 缩略（第一张候选），没有产物显示状态图标 */
const railThumb = (row: IRow) => row.run.candidates?.[row.selectedIndex]?.url || row.run.candidates?.[0]?.url || ''

/** 结果缩略上的操作钮（同卡片候选的 主 / 大 / ↓）：视觉 22，::after 外扩 5 → 命中 32 */
const THUMB_ACTION =
  'relative grid w-22px h-22px p-0 place-items-center border border-solid border-white/50 rounded-4px bg-white/90 text-ink text-11px font-600 leading-none cursor-pointer hover:bg-white hover:text-violet-ink after:content-empty after:absolute after:-inset-5px disabled:opacity-40 disabled:cursor-not-allowed'
const ICON_BTN =
  'relative grid w-28px h-28px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink after:content-empty after:absolute after:-inset-2px'
</script>

<template>
  <section
    class="flex flex-col h-full min-h-0 overflow-hidden bg-surface"
    aria-label="生成历史"
    data-canvas-popover
    @wheel.stop
  >
    <header
      class="flex shrink-0 items-center gap-6px border-b border-b-solid border-line text-ink-2"
      :class="collapsed ? 'flex-col py-8px px-8px' : 'h-44px px-12px'"
    >
      <button
        v-if="collapsed"
        type="button"
        :class="[ICON_BTN, FOCUS_RING]"
        title="展开生成历史"
        aria-label="展开生成历史"
        aria-expanded="false"
        @click="collapsed = false"
      >
        <EditorIcon name="chevronLeft" :size="14" />
      </button>
      <template v-else>
        <EditorIcon name="history" :size="16" />
        <h2 class="m-0 text-14px font-600 text-ink">生成历史</h2>
        <span
          v-if="runs.length"
          class="px-6px border border-solid border-line rounded-999px bg-surface2 text-muted text-11px leading-18px tabular-nums"
          >{{ runs.length }}</span
        >
        <button
          type="button"
          class="ml-auto"
          :class="[ICON_BTN, FOCUS_RING]"
          :disabled="loading"
          title="刷新"
          aria-label="刷新生成历史"
          @click="load"
        >
          <EditorIcon name="refresh" :size="14" :class="loading && 'animate-spin'" />
        </button>
        <button
          type="button"
          :class="[ICON_BTN, FOCUS_RING]"
          title="向右折叠"
          aria-label="折叠生成历史"
          aria-expanded="true"
          @click="collapsed = true"
        >
          <EditorIcon name="chevronRight" :size="14" />
        </button>
        <button
          type="button"
          :class="[ICON_BTN, FOCUS_RING]"
          title="关闭"
          aria-label="关闭生成历史"
          @click="emit('close')"
        >
          <EditorIcon name="close" :size="14" />
        </button>
      </template>
    </header>

    <!-- 折叠轨：每条记录一个缩略，点击定位节点 -->
    <div v-if="collapsed" class="flex flex-1 min-h-0 flex-col items-center gap-6px overflow-y-auto py-8px" role="list">
      <button
        v-for="row in rows"
        :key="row.key"
        type="button"
        role="listitem"
        class="relative grid shrink-0 w-32px h-32px place-items-center overflow-hidden border border-solid border-line rounded-4px bg-surface3 p-0 text-muted cursor-pointer hover:border-violet-line"
        :class="[FOCUS_RING, row.run.status === 'failed' && '!border-danger-line text-danger']"
        :data-tip="`${row.title} · ${row.status.label} · ${row.time}`"
        data-tip-side="left"
        :aria-label="`${row.title}，${row.status.label}，${row.time}，在画布中定位`"
        @click="locate(row)"
      >
        <img v-if="railThumb(row)" :src="railThumb(row)" alt="" class="w-full h-full object-cover" />
        <span
          v-else-if="IN_FLIGHT.has(row.run.status)"
          class="w-12px h-12px border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-800"
        />
        <EditorIcon v-else :name="row.run.status === 'failed' ? 'close' : 'image'" :size="14" />
      </button>
    </div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto px-8px py-8px">
      <p v-if="!loaded" class="m-0 py-32px text-center text-placeholder text-12px">加载中…</p>
      <div v-else-if="!rows.length" class="flex flex-col items-center gap-8px px-16px py-48px text-center">
        <span class="grid w-40px h-40px place-items-center border border-solid border-line rounded-full text-muted">
          <EditorIcon name="history" :size="18" />
        </span>
        <strong class="text-ink-2 text-13px font-500">{{ failed ? '生成历史加载失败' : '还没有生成记录' }}</strong>
        <span class="text-muted text-12px leading-18px">{{
          failed ? '点右上角刷新再试一次' : '运行图片 / 视频生成节点后，每次结果都会按时间出现在这里'
        }}</span>
      </div>

      <article
        v-for="row in rows"
        :key="row.key"
        class="mb-6px px-10px py-8px border border-solid border-transparent rounded-6px hover:border-line-soft hover:bg-surface2"
      >
        <div class="flex items-center gap-6px min-w-0">
          <span
            class="shrink-0 px-6px border border-solid rounded-4px text-11px font-500 leading-18px"
            :class="row.status.cls"
            >{{ row.status.label
            }}{{ IN_FLIGHT.has(row.run.status) && row.run.progress ? ` ${row.run.progress}%` : '' }}</span
          >
          <button
            type="button"
            class="min-w-0 p-0 border-none bg-transparent text-left text-ink text-13px font-500 leading-18px overflow-hidden text-ellipsis whitespace-nowrap"
            :class="[FOCUS_RING, row.exists ? 'cursor-pointer hover:text-violet-ink' : 'cursor-default !text-muted']"
            :title="row.exists ? '在画布中定位' : '节点已从画布删除'"
            :disabled="!row.exists"
            @click="locate(row)"
          >
            {{ row.title }}
          </button>
          <time class="ml-auto shrink-0 text-muted text-11px tabular-nums">{{ row.time }}</time>
        </div>
        <div class="flex items-center gap-6px mt-2px text-muted text-11px leading-16px">
          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ row.meta }}</span>
          <span
            v-if="row.points"
            class="ml-auto shrink-0 tabular-nums"
            :title="
              row.run.status === 'failed' || row.run.status === 'cancelled' ? '失败或取消的点数会退回' : '本次扣点'
            "
            >{{ row.points }}</span
          >
        </div>
        <p
          v-if="row.run.status === 'failed' && row.run.error"
          class="m-0 mt-4px text-danger text-11px leading-16px line-clamp-2 break-all"
        >
          {{ row.run.error }}
        </p>

        <!-- 结果缩略：悬停出 主（设为输出）/ 大（预览）/ ↓（下载），与卡片候选同款 -->
        <div v-if="row.run.candidates?.length" class="flex flex-wrap gap-6px mt-6px" role="list" aria-label="生成结果">
          <template v-for="(item, index) in row.run.candidates" :key="item.url + index">
            <div
              v-if="!row.hidden.has(index)"
              class="hist-thumb relative shrink-0 w-56px h-56px overflow-hidden border border-solid border-line rounded-4px bg-surface3"
              :class="{
                '!border-violet shadow-[0_0_0_1px_var(--xq-violet)]': row.selectable && row.selectedIndex === index,
              }"
              role="listitem"
            >
              <img
                :src="item.url"
                :alt="`${row.title} 结果 ${index + 1}`"
                draggable="false"
                class="block w-full h-full object-cover"
              />
              <span
                v-if="row.isVideo"
                class="absolute left-3px bottom-3px grid w-16px h-16px place-items-center rounded-full bg-black/55 text-white"
                aria-hidden="true"
                ><EditorIcon name="play" :size="10"
              /></span>
              <div
                class="absolute inset-0 flex items-center justify-center gap-6px bg-[rgba(31,35,41,0.5)] opacity-0 transition-opacity duration-120 [.hist-thumb:hover_&]:opacity-100 [.hist-thumb:focus-within_&]:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <button
                  v-if="row.selectable"
                  type="button"
                  :class="[THUMB_ACTION, FOCUS_RING]"
                  :title="row.selectedIndex === index ? '当前输出' : '设为输出'"
                  :aria-label="`结果 ${index + 1} 设为输出`"
                  @click="setOutput(row, index)"
                >
                  主
                </button>
                <button
                  type="button"
                  :class="[THUMB_ACTION, FOCUS_RING]"
                  title="预览"
                  :aria-label="`预览结果 ${index + 1}`"
                  @click="preview(row, index)"
                >
                  大
                </button>
                <button
                  type="button"
                  :class="[THUMB_ACTION, FOCUS_RING]"
                  title="下载"
                  :aria-label="`下载结果 ${index + 1}`"
                  @click="download(row, index)"
                >
                  ↓
                </button>
              </div>
            </div>
          </template>
        </div>
      </article>
      <p v-if="rows.length" class="m-0 py-8px text-center text-placeholder text-11px">
        显示最近 {{ rows.length }} 条 · 点击标题定位节点
      </p>
    </div>

    <NodeLightbox v-model:show="lightboxShow" v-model:index="lightboxIndex" :items="lightboxItems" />
  </section>
</template>
