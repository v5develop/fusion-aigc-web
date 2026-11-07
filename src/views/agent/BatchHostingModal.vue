<script setup lang="ts">
/**
 * 一键铺货（批量托管，/api/v1/batch-hosting/*）：照原型 5183 AgentView.vue 的 .batch-modal——
 * 批次名称 + 共用设置（技能 / 画质与比例 / 输出语言 / 生图类型 / 生图数量）+ 任务卡 + 添加任务 / 提交。
 *
 * <p>技能与输出语言跟随对话页当前所选（原型里是只读展示）；画质与比例、生图类型取
 * GET /ecom-image/info（按技能下发）。每个任务 = 任务描述 + 参考图 + 一个模块（上面的共用设置）。
 *
 * <p>计费：子项数 = 任务数 × 生图数量，进入生成后逐子项冻结。提交带 Idempotency-Key：
 * 结果未知时沿用同一个键重发，表单一改即换新键。
 *
 * <p>「历史记录」页签：GET /list 分页 → GET /{id} 详情（未到终态时每 5 秒刷新），
 * 可删除整个批次（DELETE /{id}）或勾选已结束的子项删除（DELETE /{id}/items，执行中的子项服务端拒删）。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { NImage, NInputNumber, NModal, NSelect, NSpin, useMessage } from 'naive-ui'
import { toApiError } from '@/api'
import {
  batchDelete,
  batchDeleteItems,
  batchDetail,
  batchEcomImageInfo,
  batchList,
  batchSubmitEcomImage,
  isBatchTerminal,
} from '@/api/batchHosting.ts'
import type { IBatchDetail, IBatchInfo, IBatchItem, IBatchRow } from '@/api/batchHosting.ts'
import { useIdempotentSubmit } from '@/views/studio/hooks.ts'
import { useStudioUploader } from '@/views/studio/components/StudioImageUpload/useStudioUploader.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import { batchQuoteEcomImage } from '@/api/agent.ts'
import type { IBatchEcomQuote } from '@/api/agent.ts'
import { emitBillingBlock } from '@/utils/billingGuide'

const props = defineProps<{
  show: boolean
  /** 对话页当前所选技能（字符串 id，原样回传） */
  skillId: string
  skillTitle: string
  /** 输出语言的展示文案（同对话页语言胶囊） */
  languageLabel: string
  /** 下发给服务端的语言名；对话页选「无语言」时为空，批量托管要求非空，按服务端默认落「中文」 */
  languageName: string
}>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const message = useMessage()

// 与 index.vue 同一组原型按钮 / 弹窗原子类（.sx-btn--sm / 默认 / 主按钮、.agent-modal）
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const T_BTN =
  '[transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s,box-shadow_0.11s,color_0.11s] motion-reduce:transition-none'
const BTN_SM = `inline-flex h-28px flex-none items-center justify-center gap-6px rounded-14px border border-solid px-12px text-12px leading-none whitespace-nowrap cursor-pointer select-none ${T_BTN}`
const BTN_DEFAULT =
  'border-control bg-[linear-gradient(#fff,#fbfcfc)] font-500 text-ink-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] enabled:hover:(border-control-hover bg-[linear-gradient(#fff,#f7f8f9)] text-ink) enabled:active:(border-control-press bg-[linear-gradient(#f3f4f5,#f7f8f9)] shadow-press text-ink) disabled:(border-line bg-none bg-surface3 shadow-none text-placeholder cursor-default)'
const BTN_DANGER =
  'border-#f0c9c7 bg-white font-500 text-#c24545 enabled:hover:(bg-#fdf6f6 border-#e8b4b1) disabled:(opacity-50 cursor-default)'
const SOFT_CARD =
  'border border-solid border-#c9cdd0 bg-[linear-gradient(#fff,#f8f9fa)] shadow-[0_6px_16px_rgba(31,35,41,0.08),inset_0_1px_0_#fff]'
const BTN_PRIMARY =
  'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)] font-600 text-white shadow-btn enabled:hover:(border-violet-press bg-[linear-gradient(#9a6fae,#875c9a)]) enabled:active:(border-#5c3d6b bg-none bg-violet-press shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)]) disabled:(border-violet-line bg-none bg-violet-disabled shadow-none text-white/80 cursor-default)'
const MODAL =
  'flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-12px border border-solid border-line bg-white shadow-pop'
const MODAL_HEAD = 'flex h-52px flex-none items-center gap-8px border-b border-solid border-line pl-18px pr-10px'
const MODAL_X =
  'ml-auto grid h-26px w-26px place-items-center rounded-4px border-none bg-transparent p-0 text-#8a919c cursor-pointer hover:bg-surface3'
const ICON_X = 'M6 6l12 12M18 6L6 18'
const ICON_CHECK = 'M5 12l5 5 9-10'

const SKILL_REQUIRED = '请先选择技能'
const DEFAULT_LANGUAGE = '中文'
/** 每个任务的参考图上限（同对话页附图上限） */
const MAX_IMAGES = 4
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
const LIST_SIZE = 10
const POLL_MS = 5000

const visible = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

/** 业务失败（code≠0）请求层已 toast，这里只补传输层失败与非请求错误 */
function reportError(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  message.error(errorText(err, fallback))
}

function errorText(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr?.isNetwork) return '网络异常或请求超时，请稍后在历史记录里确认是否已提交'
  return err instanceof Error && err.message ? err.message : fallback
}

const STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '排队中', cls: 'll-chip-running' },
  RUNNING: { text: '生成中', cls: 'll-chip-running' },
  SUCCEED: { text: '已完成', cls: 'll-chip-success' },
  PARTIAL_SUCCEED: { text: '已完成', cls: 'll-chip-success' },
  FAILED: { text: '失败', cls: 'll-chip-error' },
  TIMEOUT: { text: '超时', cls: 'll-chip-error' },
  CANCELLED: { text: '已取消', cls: 'll-chip-warning' },
}
const statusOf = (s?: string | null) => STATUS[s ?? ''] ?? STATUS.PENDING!

function formatTime(v?: string | null) {
  return v ? String(v).replace('T', ' ').slice(0, 16) : ''
}

// ---------------- 页签 ----------------

const view = ref<'form' | 'records'>('form')

// ---------------- 表单 ----------------

const info = ref<IBatchInfo | null>(null)
const infoLoading = ref(false)
const infoError = ref('')
let infoSeq = 0

const title = ref('')
const resolution = ref('')
const aspectRatio = ref('')
const imageType = ref('')
const num = ref(1)

interface TaskDraft {
  key: number
  content: string
  images: string[]
}
let taskKey = 0
const tasks = ref<TaskDraft[]>([{ key: ++taskKey, content: '', images: [] }])

const resolutionOptions = computed(() =>
  (info.value?.resolutionConfigs ?? []).map((c) => ({ label: c.resolution, value: c.resolution })),
)
const ratioOptions = computed(() =>
  (info.value?.resolutionConfigs.find((c) => c.resolution === resolution.value)?.aspectRatios ?? []).map((r) => ({
    label: r,
    value: r,
  })),
)
const imageTypeOptions = computed(() => (info.value?.imageTypes ?? []).map((t) => ({ label: t, value: t })))

watch(resolution, () => {
  const ratios = ratioOptions.value.map((o) => o.value)
  if (!ratios.includes(aspectRatio.value)) aspectRatio.value = ratios.includes('1:1') ? '1:1' : (ratios[0] ?? '')
})

async function loadInfo() {
  const seq = ++infoSeq
  info.value = null
  infoError.value = ''
  if (!props.skillId) return
  infoLoading.value = true
  try {
    const res = await batchEcomImageInfo(props.skillId)
    if (seq !== infoSeq) return
    info.value = res.data ?? { imageTypes: [], resolutionConfigs: [] }
    const resolutions = info.value.resolutionConfigs.map((c) => c.resolution)
    if (!resolutions.includes(resolution.value)) resolution.value = resolutions[0] ?? ''
    const types = info.value.imageTypes
    if (!types.includes(imageType.value)) imageType.value = types[0] ?? ''
  } catch (err) {
    if (seq === infoSeq) infoError.value = errorText(err)
  } finally {
    if (seq === infoSeq) infoLoading.value = false
  }
}

const taskReady = (t: TaskDraft) => !!t.content.trim() && t.images.length > 0
const formReady = computed(
  () =>
    !!props.skillId &&
    !!resolution.value &&
    !!aspectRatio.value &&
    !!imageType.value &&
    num.value >= 1 &&
    tasks.value.length > 0 &&
    tasks.value.every(taskReady),
)

function addTask() {
  tasks.value.push({ key: ++taskKey, content: '', images: [] })
}

function removeTask(key: number) {
  if (tasks.value.length <= 1) return
  tasks.value = tasks.value.filter((t) => t.key !== key)
}

// 参考图：同一个隐藏 input，记下是哪张任务卡点的
const { uploading, uploadFiles } = useStudioUploader()
const fileInputEl = ref<HTMLInputElement | null>(null)
const uploadKey = ref(0)

function pickImages(t: TaskDraft) {
  if (uploading.value) return
  uploadKey.value = t.key
  fileInputEl.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const task = tasks.value.find((t) => t.key === uploadKey.value)
  if (!task || !files.length) return
  await addTaskImages(task, files)
}

/** 入组（上传 / 资产库共用）：不超上限、不重复 */
function pushTaskImage(task: TaskDraft, url: string) {
  if (task.images.length < MAX_IMAGES && !task.images.includes(url)) task.images.push(url)
}

/** 选文件 / 拖入 / 粘贴共用：余量、非图片提示与直传都在 useStudioUploader */
async function addTaskImages(task: TaskDraft, files: File[]) {
  await uploadFiles(files, MAX_IMAGES - task.images.length, MAX_IMAGES, (url) => pushTaskImage(task, url))
}

// 从资产库添加：记下是哪张任务卡点的；余量 / 去重 / 提示与上传同口径
const assetShow = ref(false)
const assetTaskKey = ref(0)
const assetRoom = computed(() => {
  const task = tasks.value.find((t) => t.key === assetTaskKey.value)
  return Math.max(1, MAX_IMAGES - (task?.images.length ?? 0))
})

function openAssets(t: TaskDraft) {
  if (uploading.value) return
  if (t.images.length >= MAX_IMAGES) {
    message.warning(`最多上传 ${MAX_IMAGES} 张`)
    return
  }
  assetTaskKey.value = t.key
  assetShow.value = true
}

function addTaskAssets(picked: string[]) {
  const task = tasks.value.find((t) => t.key === assetTaskKey.value)
  if (!task) return
  const room = MAX_IMAGES - task.images.length
  if (room <= 0) {
    message.warning(`最多上传 ${MAX_IMAGES} 张`)
    return
  }
  const fresh = picked.filter((u) => /^https?:\/\//i.test(u) && !task.images.includes(u))
  if (fresh.length < picked.length) message.warning('已跳过重复或不可用的图片')
  if (fresh.length > room) {
    message.warning(`最多还能添加 ${room} 张（上限 ${MAX_IMAGES} 张），多选的其余 ${fresh.length - room} 张未添加`)
  }
  fresh.slice(0, room).forEach((url) => pushTaskImage(task, url))
}

// 拖入 / 粘贴参考图：拖到哪张任务卡就进哪张；粘贴进悬停或聚焦的那张
const taskListEl = ref<HTMLElement | null>(null)
/** 悬停中的任务卡 */
const pointedTask = ref<number | null>(null)
const taskKeyOf = (el: Element | null) =>
  Number((el as HTMLElement | null)?.closest<HTMLElement>('[data-task-key]')?.dataset.taskKey)
/** 拖拽经过的任务卡（高亮用） */
const dragTask = ref<number | null>(null)
function taskOf(event: DragEvent | ClipboardEvent): TaskDraft | undefined {
  // 拖入看落点；粘贴看悬停的卡，没有就看焦点所在的卡
  const key =
    event instanceof DragEvent
      ? taskKeyOf(event.target as Element | null)
      : (pointedTask.value ?? taskKeyOf(document.activeElement))
  const task = tasks.value.find((t) => t.key === key)
  return task && task.images.length < MAX_IMAGES ? task : undefined
}
const { dragging } = useFileDropPaste(taskListEl, {
  accept: 'image',
  multiple: true,
  disabled: uploading,
  rejectMessage: () => '已跳过非图片文件',
  active: (event) => {
    const task = taskOf(event)
    if (event instanceof DragEvent) dragTask.value = task?.key ?? null
    return !!task
  },
  onFiles: (files, event) => {
    const task = taskOf(event)
    if (!task) return
    uploadKey.value = task.key
    void addTaskImages(task, files)
  },
})

function removeImage(t: TaskDraft, i: number) {
  t.images.splice(i, 1)
}

/** 提交 / 估价共用的请求体：每个任务 = 描述 + 参考图 + 一个模块（共用设置） */
function buildTasks() {
  const module = {
    imageType: imageType.value,
    resolution: resolution.value,
    aspectRatio: aspectRatio.value,
    agentSkillId: props.skillId,
    language: props.languageName || DEFAULT_LANGUAGE,
    num: num.value,
  }
  return tasks.value.map((t) => ({ content: t.content.trim(), imageUrls: [...t.images], modules: [module] }))
}

const idem = useIdempotentSubmit()
idem.bindForm(
  title,
  resolution,
  aspectRatio,
  imageType,
  num,
  tasks,
  () => props.skillId,
  () => props.languageName,
)
const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!props.skillId) {
    message.warning(SKILL_REQUIRED)
    return
  }
  if (!formReady.value) return
  submitting.value = true
  const key = idem.take()
  try {
    const res = await batchSubmitEcomImage(
      {
        // 批次名称原型标「可选」，服务端必填：留空时用技能名
        title: title.value.trim() || props.skillTitle,
        tasks: buildTasks(),
      },
      key,
    )
    title.value = ''
    tasks.value = [{ key: ++taskKey, content: '', images: [] }]
    idem.settle()
    view.value = 'records'
    void loadRecords(true)
    if (res.data?.batchHostingId != null) void openDetail(res.data.batchHostingId)
  } catch (err) {
    idem.fail(err)
    reportError(err)
  } finally {
    submitting.value = false
  }
}

// ---------------- 历史记录 ----------------

const rows = ref<IBatchRow[]>([])
const page = ref(0)
const pages = ref(0)
const listLoading = ref(false)

async function loadRecords(reset = false) {
  if (listLoading.value) return
  listLoading.value = true
  const next = reset ? 1 : page.value + 1
  try {
    const res = await batchList({ page: next, size: LIST_SIZE })
    const data = res.data?.data ?? []
    if (reset) rows.value = data
    else {
      const seen = new Set(rows.value.map((r) => String(r.batchHostingId)))
      rows.value.push(...data.filter((r) => !seen.has(String(r.batchHostingId))))
    }
    page.value = next
    pages.value = res.data?.pages ?? 0
  } catch (err) {
    reportError(err)
  } finally {
    listLoading.value = false
  }
}

const detail = ref<IBatchDetail | null>(null)
const detailId = ref<number | string | null>(null)
const detailLoading = ref(false)
const selectedItems = ref<string[]>([])
const confirming = ref<'' | 'batch' | 'items'>('')
const deleting = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let detailSeq = 0

function stopPoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

const detailItems = computed(() =>
  (detail.value?.tasks ?? []).map((t) => ({
    index: t.index,
    items: t.groups.flatMap((g) => g.items),
  })),
)

const itemId = (i: IBatchItem) => String(i.batchHostingItemId)
const itemDeletable = (i: IBatchItem) => isBatchTerminal(i.status)
const itemImage = (i: IBatchItem) => (i.status === 'SUCCEED' ? i.task?.result?.url || '' : '')

async function fetchDetail(id: number | string, quiet = false) {
  const seq = ++detailSeq
  stopPoll()
  if (!quiet) detailLoading.value = true
  try {
    const res = await batchDetail(id)
    if (seq !== detailSeq || detailId.value !== id) return
    detail.value = res.data
    // 刷新后已不存在 / 不可删的子项从勾选里去掉
    const alive = new Set(
      (res.data?.tasks ?? []).flatMap((t) => t.groups.flatMap((g) => g.items.filter(itemDeletable).map(itemId))),
    )
    selectedItems.value = selectedItems.value.filter((x) => alive.has(x))
    const row = rows.value.find((r) => String(r.batchHostingId) === String(id))
    if (row && res.data) row.status = res.data.status
    if (res.data && !isBatchTerminal(res.data.status) && visible.value) {
      pollTimer = setTimeout(() => void fetchDetail(id, true), POLL_MS)
    }
  } catch (err) {
    if (seq === detailSeq && !quiet) reportError(err)
  } finally {
    if (seq === detailSeq) detailLoading.value = false
  }
}

async function openDetail(id: number | string) {
  detailId.value = id
  detail.value = null
  selectedItems.value = []
  confirming.value = ''
  await fetchDetail(id)
}

function closeDetail() {
  stopPoll()
  detailSeq++
  detailId.value = null
  detail.value = null
  selectedItems.value = []
  confirming.value = ''
}

function toggleItem(i: IBatchItem) {
  if (!itemDeletable(i)) return
  const id = itemId(i)
  const at = selectedItems.value.indexOf(id)
  if (at >= 0) selectedItems.value.splice(at, 1)
  else selectedItems.value.push(id)
}

async function confirmDelete() {
  const id = detailId.value
  if (id == null || deleting.value) return
  deleting.value = true
  try {
    if (confirming.value === 'batch') {
      await batchDelete(id)
      rows.value = rows.value.filter((r) => String(r.batchHostingId) !== String(id))
      closeDetail()
    } else if (confirming.value === 'items' && selectedItems.value.length) {
      await batchDeleteItems(id, [...selectedItems.value])
      selectedItems.value = []
      confirming.value = ''
      await fetchDetail(id, true)
    }
  } catch (err) {
    // 子项删除走裸 fetch，业务失败不经拦截器 toast；整批删除走 axios（业务失败已 toast）
    if (confirming.value === 'items') message.error(errorText(err, '删除失败，请重试'))
    else reportError(err, '删除失败，请重试')
  } finally {
    deleting.value = false
  }
}

function switchView(v: 'form' | 'records') {
  view.value = v
  if (v === 'records') {
    closeDetail()
    void loadRecords(true)
  }
}

watch(
  () => props.show,
  (open) => {
    if (open) {
      void loadInfo()
      if (view.value === 'records') {
        void loadRecords(true)
        if (detailId.value != null) void fetchDetail(detailId.value)
      }
    } else stopPoll()
  },
  { immediate: true },
)

watch(
  () => props.skillId,
  () => {
    if (props.show) void loadInfo()
  },
)

onUnmounted(stopPoll)

const fieldLabel = 'text-10px leading-14px text-placeholder'
const CELL = `flex min-w-0 flex-col gap-4px rounded-12px px-11px py-9px ${SOFT_CARD}`

const totalImages = computed(() => tasks.value.length * (Number(num.value) || 1))

// ---------------- 提交前估价（POST /batch-hosting/ecom-image/quote） ----------------
// 表单齐了才估（服务端走与提交同一套校验，缺图 / 缺描述必然被拒）；防抖 400ms，只认最后一次响应；
// 失败静默（SILENT_ERROR_URLS），底栏退回本地的「任务数 × 张数」。
const quote = ref<IBatchEcomQuote | null>(null)
let quoteTimer: ReturnType<typeof setTimeout> | null = null
let quoteSeq = 0
const quoteSig = computed(() =>
  visible.value && view.value === 'form' && formReady.value ? JSON.stringify(buildTasks()) : '',
)
watch(quoteSig, (sig) => {
  if (quoteTimer) clearTimeout(quoteTimer)
  quoteTimer = null
  const id = ++quoteSeq
  if (!sig) {
    quote.value = null
    return
  }
  quoteTimer = setTimeout(async () => {
    quoteTimer = null
    try {
      const res = await batchQuoteEcomImage({ tasks: buildTasks() })
      if (id === quoteSeq) quote.value = res.data ?? null
    } catch {
      if (id === quoteSeq) quote.value = null
    }
  }, 400)
})
onUnmounted(() => {
  if (quoteTimer) clearTimeout(quoteTimer)
  quoteSeq++
})
</script>

<template>
  <n-modal v-model:show="visible">
    <div role="dialog" aria-modal="true" aria-labelledby="agent-batch-dialog-title" :class="[MODAL, 'h-660px w-880px']">
      <div :class="MODAL_HEAD">
        <strong id="agent-batch-dialog-title" class="text-15px font-600 leading-20px text-ink">一键铺货</strong>
        <span class="text-11px leading-16px text-muted">批量提交 AGENT 生成任务</span>
        <button type="button" aria-label="关闭" :class="[MODAL_X, FOCUS]" @click="visible = false">
          <svg
            class="h-16px w-16px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path :d="ICON_X" />
          </svg>
        </button>
      </div>

      <div role="group" aria-label="一键铺货" class="flex flex-none gap-4px px-20px pb-4px pt-12px">
        <button
          v-for="t in [
            { key: 'form', label: '一键铺货' },
            { key: 'records', label: '历史记录' },
          ] as const"
          :key="t.key"
          type="button"
          :aria-pressed="view === t.key"
          :class="[
            'h-28px rounded-full border border-solid px-12px text-12px cursor-pointer',
            view === t.key
              ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
              : 'border-line bg-white text-ink-2 hover:(border-control bg-surface2)',
            FOCUS,
          ]"
          @click="switchView(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 表单：照原型 .batch-body -->
      <form v-if="view === 'form'" class="flex min-h-0 flex-1 flex-col" @submit.prevent="submit">
        <div ref="taskListEl" class="flex min-h-0 flex-1 flex-col gap-10px overflow-y-auto px-20px py-10px">
          <input
            v-model="title"
            maxlength="100"
            placeholder="批次名称（可选）"
            aria-label="批次名称（可选）"
            class="box-border h-36px w-full flex-none rounded-12px border border-solid border-control bg-white px-12px text-12px text-ink shadow-inset-input outline-none placeholder:text-placeholder hover:border-control-hover focus:border-violet"
          />
          <div class="grid flex-none grid-cols-2 gap-8px sm:grid-cols-5">
            <div :class="CELL">
              <span :class="fieldLabel">技能</span>
              <b class="truncate text-12px font-600 leading-28px text-ink-2">{{ skillTitle || '—' }}</b>
            </div>
            <div :class="CELL">
              <span :class="fieldLabel">画质</span>
              <n-select
                v-model:value="resolution"
                :options="resolutionOptions"
                :loading="infoLoading"
                :disabled="!info"
                size="small"
                aria-label="画质"
              />
            </div>
            <div :class="CELL">
              <span :class="fieldLabel">比例</span>
              <n-select
                v-model:value="aspectRatio"
                :options="ratioOptions"
                :loading="infoLoading"
                :disabled="!info"
                size="small"
                aria-label="比例"
              />
            </div>
            <div :class="CELL">
              <span :class="fieldLabel">输出语言</span>
              <b class="truncate text-12px font-600 leading-28px text-ink-2">{{ languageLabel }}</b>
            </div>
            <div :class="CELL">
              <span :class="fieldLabel">生图类型</span>
              <n-select
                v-model:value="imageType"
                :options="imageTypeOptions"
                :loading="infoLoading"
                :disabled="!info"
                size="small"
                aria-label="生图类型"
              />
            </div>
            <div :class="[CELL, 'col-span-2 sm:col-span-5 sm:!flex-row sm:!items-center sm:!gap-10px']">
              <span :class="fieldLabel">生图数量</span>
              <n-input-number v-model:value="num" :min="1" :max="9" :precision="0" size="small" aria-label="生图数量" class="sm:!w-140px" />
            </div>
          </div>
          <p v-if="infoError" class="m-0 flex-none text-11px leading-16px text-danger" role="alert">{{ infoError }}</p>

          <div
            v-for="(t, i) in tasks"
            :key="t.key"
            :class="[
              'flex flex-none gap-12px rounded-14px px-14px py-12px',
              SOFT_CARD,
              dragging && dragTask === t.key && 'sx-drop',
            ]"
            :data-task-key="t.key"
            @mouseenter="pointedTask = t.key"
            @mouseleave="pointedTask = null"
          >
            <span
              class="grid h-22px w-22px flex-none place-items-center rounded-full border border-solid border-#e2d3ee bg-white text-11px font-600 text-violet-ink tabular-nums"
              aria-hidden="true"
              >{{ i + 1 }}</span
            >
            <div class="flex min-w-0 flex-1 flex-col gap-6px">
              <div class="flex items-center gap-8px">
                <b class="text-13px font-600 leading-18px text-ink">任务 {{ i + 1 }}</b>
                <span v-if="!taskReady(t)" class="ll-chip ll-chip-warning">待完善</span>
                <button
                  v-if="tasks.length > 1"
                  type="button"
                  :aria-label="`删除任务 ${i + 1}`"
                  :class="[MODAL_X, '!ml-auto !h-32px !w-32px !rounded-full hover:(!bg-#fdf6f6 !text-#c24545)', FOCUS]"
                  @click="removeTask(t.key)"
                >
                  <svg
                    class="h-12px w-12px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path :d="ICON_X" />
                  </svg>
                </button>
              </div>
              <p v-if="!taskReady(t)" class="m-0 text-11px leading-16px text-muted">
                填写任务描述并上传参考图后即可提交
              </p>
              <textarea
                v-model="t.content"
                rows="2"
                maxlength="2000"
                :aria-label="`任务 ${i + 1} 任务描述`"
                class="box-border w-full resize-none rounded-12px border border-solid border-control bg-white px-10px py-6px text-12px leading-18px text-ink outline-none hover:border-control-hover focus:border-violet"
              />
              <div class="flex flex-wrap items-center gap-6px">
                <span v-for="(url, j) in t.images" :key="url" class="relative inline-flex">
                  <n-image
                    :src="url"
                    :width="44"
                    :height="44"
                    object-fit="cover"
                    class="overflow-hidden rounded-4px border border-solid border-line"
                  />
                  <button
                    type="button"
                    :aria-label="`删除参考图 ${j + 1}`"
                    class="absolute right-[-8px] top-[-8px] grid h-22px w-22px place-items-center rounded-full border-none bg-ink/70 p-0 text-white cursor-pointer sx-hit after:-inset-6px [@media(pointer:coarse)]:after:-inset-10px sx-focus"
                    @click="removeImage(t, j)"
                  >
                    <svg
                      class="h-9px w-9px"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      aria-hidden="true"
                    >
                      <path :d="ICON_X" />
                    </svg>
                  </button>
                </span>
                <button
                  v-if="t.images.length < MAX_IMAGES"
                  type="button"
                  :disabled="uploading"
                  :aria-busy="uploading && uploadKey === t.key"
                  :class="[BTN_SM, BTN_DEFAULT, FOCUS]"
                  @click="pickImages(t)"
                >
                  <n-spin v-if="uploading && uploadKey === t.key" :size="12" />
                  上传参考图
                </button>
                <button
                  v-if="t.images.length < MAX_IMAGES"
                  type="button"
                  :disabled="uploading"
                  :aria-label="`任务 ${i + 1} 从资产库添加参考图`"
                  :class="[BTN_SM, BTN_DEFAULT, FOCUS]"
                  @click="openAssets(t)"
                >
                  从资产库添加
                </button>
              </div>
            </div>
          </div>
          <input
            ref="fileInputEl"
            type="file"
            multiple
            :accept="IMAGE_ACCEPT"
            class="hidden"
            tabindex="-1"
            aria-hidden="true"
            @change="onFileChange"
          />
          <button
            type="button"
            :class="[
              'flex h-36px flex-none items-center justify-center gap-6px rounded-14px border border-dashed border-#d7c9e2 bg-[rgba(248,243,252,0.5)] text-12px text-violet-ink cursor-pointer hover:(border-violet-line bg-#faf5fd)',
              FOCUS,
            ]"
            @click="addTask"
          >
            <svg class="h-12px w-12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加任务
          </button>
          <AssetPickerModal v-model:show="assetShow" :limit="assetRoom" @select="addTaskAssets" />
        </div>
        <div class="flex flex-none items-center gap-8px border-t border-solid border-line-soft px-20px py-10px">
          <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-8px text-12px leading-16px text-placeholder tabular-nums" role="status">
            <template v-if="quote">
              <span
                >共 {{ quote.taskCount }} 个任务 · {{ quote.imageCount }} 张 · 约 {{ quote.totalPoints }} 点数{{
                  quote.complete ? '' : ' 起'
                }}</span
              >
              <span v-if="!quote.complete" class="text-11px">（部分规格未报价，实际以扣除为准）</span>
              <span v-if="quote.sufficient">余额 {{ quote.balance }} 点数</span>
              <template v-else>
                <span class="text-#c24545">点数不足（余额 {{ quote.balance }} 点数）</span>
                <button
                  type="button"
                  class="h-28px cursor-pointer border-none bg-transparent px-4px text-12px text-violet-ink underline underline-offset-2"
                  @click="emitBillingBlock(3003)"
                >
                  去充值
                </button>
              </template>
            </template>
            <template v-else>共 {{ tasks.length }} 个任务 · {{ totalImages }} 张</template>
          </span>
          <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="visible = false">取消</button>
          <button
            type="submit"
            :disabled="!formReady || submitting"
            :aria-busy="submitting"
            :class="[BTN_SM, BTN_PRIMARY, FOCUS]"
          >
            <n-spin v-if="submitting" :size="12" />
            提交（{{ tasks.length }} 个任务）
          </button>
        </div>
      </form>

      <!-- 历史记录：列表 → 详情 -->
      <div v-else class="flex min-h-0 flex-1 flex-col">
        <div v-if="detailId == null" class="flex min-h-0 flex-1 flex-col gap-8px overflow-y-auto px-20px py-10px">
          <div v-if="listLoading && !rows.length" class="flex flex-1 items-center justify-center">
            <n-spin size="small" />
          </div>
          <button
            v-for="r in rows"
            :key="String(r.batchHostingId)"
            type="button"
            :class="[
              'flex w-full flex-none items-center gap-10px rounded-8px border border-solid border-line bg-white px-12px py-10px text-left cursor-pointer hover:border-control-hover',
              FOCUS,
            ]"
            @click="openDetail(r.batchHostingId)"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-2px">
              <b class="truncate text-13px font-500 leading-18px text-ink">{{ r.title }}</b>
              <span class="text-11px leading-16px text-placeholder tabular-nums">{{ formatTime(r.createdAt) }}</span>
            </span>
            <span :class="['ll-chip', statusOf(r.status).cls]">{{ statusOf(r.status).text }}</span>
          </button>
          <div v-if="page < pages" class="text-center">
            <button
              type="button"
              :disabled="listLoading"
              :class="['ll-link border-none bg-transparent text-11px', FOCUS]"
              @click="loadRecords()"
            >
              加载更多
            </button>
          </div>
        </div>

        <template v-else>
          <div class="flex min-h-0 flex-1 flex-col gap-10px overflow-y-auto px-20px py-10px">
            <div v-if="detailLoading && !detail" class="flex flex-1 items-center justify-center">
              <n-spin size="small" />
            </div>
            <template v-else-if="detail">
              <div class="flex flex-none items-center gap-8px">
                <b class="min-w-0 truncate text-14px font-600 leading-20px text-ink">{{ detail.title }}</b>
                <span :class="['ll-chip', statusOf(detail.status).cls]">{{ statusOf(detail.status).text }}</span>
                <span class="ml-auto text-11px leading-16px text-placeholder tabular-nums">{{
                  formatTime(detail.createdAt)
                }}</span>
              </div>
              <section v-for="t in detailItems" :key="t.index" class="flex flex-none flex-col gap-6px">
                <b class="text-12px font-600 leading-18px text-ink-2">任务 {{ t.index + 1 }}</b>
                <div class="grid grid-cols-4 gap-8px">
                  <div
                    v-for="it in t.items"
                    :key="itemId(it)"
                    :class="[
                      'relative flex min-w-0 flex-col gap-4px rounded-6px border border-solid p-6px',
                      selectedItems.includes(itemId(it)) ? 'border-violet bg-violet-soft' : 'border-line bg-white',
                    ]"
                  >
                    <div class="grid aspect-square place-items-center overflow-hidden rounded-4px bg-surface3">
                      <n-image
                        v-if="itemImage(it)"
                        :src="itemImage(it)"
                        object-fit="cover"
                        class="h-full w-full"
                        :img-props="{ class: 'h-full w-full object-cover' }"
                      />
                      <n-spin v-else-if="!isBatchTerminal(it.status)" size="small" />
                    </div>
                    <div class="flex min-w-0 items-center gap-4px">
                      <span class="min-w-0 flex-1 truncate text-11px leading-16px text-ink-2">{{ it.imageType }}</span>
                      <span :class="['ll-chip', statusOf(it.status).cls]">{{ statusOf(it.status).text }}</span>
                    </div>
                    <p
                      v-if="it.errorMessage && it.status !== 'SUCCEED'"
                      :title="it.errorMessage"
                      class="m-0 truncate text-11px leading-16px text-danger"
                    >
                      {{ it.errorMessage }}
                    </p>
                    <button
                      v-if="itemDeletable(it)"
                      type="button"
                      role="checkbox"
                      :aria-checked="selectedItems.includes(itemId(it))"
                      :aria-label="`任务 ${t.index + 1} ${it.imageType ?? ''}`"
                      :class="[
                        'absolute left-10px top-10px grid h-20px w-20px place-items-center rounded-4px border border-solid p-0 cursor-pointer sx-hit after:-inset-6px [@media(pointer:coarse)]:after:-inset-10px',
                        selectedItems.includes(itemId(it))
                          ? 'border-violet bg-violet text-white'
                          : 'border-control bg-white/90',
                        FOCUS,
                      ]"
                      @click="toggleItem(it)"
                    >
                      <svg
                        v-if="selectedItems.includes(itemId(it))"
                        class="h-10px w-10px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                        aria-hidden="true"
                      >
                        <path :d="ICON_CHECK" />
                      </svg>
                    </button>
                  </div>
                </div>
              </section>
            </template>
          </div>
          <div class="flex flex-none flex-col gap-8px border-t border-solid border-line-soft px-20px py-10px">
            <div v-if="confirming" class="flex items-center gap-8px text-11px leading-16px text-muted">
              <span class="flex-1">删除后不可撤销，请谨慎操作。</span>
              <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="confirming = ''">取消</button>
              <button
                type="button"
                :disabled="deleting"
                :aria-busy="deleting"
                :class="[BTN_SM, BTN_DANGER, FOCUS]"
                @click="confirmDelete"
              >
                删除
              </button>
            </div>
            <div v-else class="flex items-center gap-8px">
              <button
                type="button"
                :disabled="!selectedItems.length"
                :class="[BTN_SM, BTN_DANGER, FOCUS]"
                @click="confirming = 'items'"
              >
                删除（{{ selectedItems.length }}）
              </button>
              <span class="flex-1" />
              <button
                type="button"
                :disabled="!detail"
                :class="[BTN_SM, BTN_DANGER, FOCUS]"
                @click="confirming = 'batch'"
              >
                删除
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </n-modal>
</template>
