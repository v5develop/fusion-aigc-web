<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 生成卡控制台（原型 CanvasConsolePanel + canvas-v31 §3，2026-11-12 起只用于右侧停靠）。工具节点的表单已搬到卡片上（ToolParamFields / TryonSlots）。
 * 头部：类型 + 标题 + 执行钮；主体按节点类型 / catalog 能力出表单；底部：说明 + 「完成」。
 * 字段、校验、提交与运行 / 轮询行为与原右侧参数面板一致：节点参数直接写回节点 data（快照私有字段，camelCase 原样保存）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import EditorIcon from './EditorIcon.vue'
import RunErrorNotice from './RunErrorNotice.vue'
import LibraryStatusHint from './LibraryStatusHint.vue'
import { compareRefOrder, normalizeHandle } from './graph.ts'
import { editorMessage, rememberSettleMode, useCanvasEditor } from './useCanvasEditor.ts'
import { canvasEstimate, canvasUploadMedia, type ICanvasEstimateResp } from '@/api/canvas-home.ts'
import type { CanvasEditorNode, CanvasNodeData } from './types.ts'
import { FOCUS_RING, NODE_NOTICE, NODE_RUN_BTN, POP_SURFACE } from './ui.ts'
import { DROP_PASTE_HINT, useFileDropPaste } from '@/composables/useFileDropPaste'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'

const props = defineProps<{
  node: CanvasEditorNode
  /** 停靠在画布右侧（生成卡）：撑满高度、直角、只留左描边；默认浮层外观 */
  docked?: boolean
}>()

const emit = defineEmits<{ locate: [id: string] }>()

const store = useCanvasEditor()
const fileRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadKind = ref<'image' | 'video'>('image')

/** 控件标签（原型控制台无可见标签，这里保留 11px 小标签，便于识别也给读屏器名） */
const LABEL = 'block mb-4px text-muted text-11px leading-16px'
/** 控制台里的预览框（surface-3 底、r4、细描边） */
const PREVIEW =
  'grid place-items-center overflow-hidden border border-solid border-line-soft rounded-4px bg-surface3 [&_img]:block [&_img]:max-w-full [&_img]:object-contain [&_video]:block [&_video]:max-w-full [&_video]:object-contain'

const catalog = computed(() => store.catalog.value)

const typeLabel = computed(() => {
  const node = props.node
  if (node.type === 'text') return '提示词'
  if (node.type === 'image') return node.data.kind === 'result' ? '结果图' : '图片'
  if (node.type === 'video') return '视频'
  if (node.type === 'tool') return '工具'
  if (node.type === 'module') return '分组'
  return node.data.kind === 'video' ? '视频生成' : '图片生成'
})

const titleValue = computed({
  get: () => props.node.data.title ?? '',
  set: (value: string) => store.updateNodeData(props.node.id, { title: value }),
})

const textValue = computed({
  get: () => (props.node.data as { text?: string }).text ?? '',
  set: (value: string) => store.updateNodeData(props.node.id, { text: value }),
})

// ---- 生成节点 ----
const modelNode = computed(() => (props.node.type === 'model' ? (props.node.data as CanvasNodeData) : null))
const isVideoModel = computed(() => modelNode.value?.kind === 'video')
const modelOptions = computed(() => {
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.imageModels
  return (list ?? []).map((item) => ({
    label: item.ready ? item.label || modelLabelOf(item.model) : `${item.label || modelLabelOf(item.model)}（不可用）`,
    value: item.modelId,
    disabled: !item.ready,
  }))
})
const currentModel = computed(() => {
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.imageModels
  return (
    list?.find((item) => item.modelId === modelNode.value?.modelId) ??
    list?.find((item) => item.model === modelNode.value?.model)
  )
})
const priceHint = computed(() => {
  const size = modelNode.value?.size
  const duration = modelNode.value?.duration
  const hit = currentModel.value?.prices?.find(
    (price) => (size ? price.size === size : true) && (duration ? price.duration === duration : true),
  )
  return hit ? `约 ${hit.points} 点/张` : ''
})
/** 预计消耗（原型 .wf-console__estimate）：单价 × 张数（视频单价已按所选时长，1 条） */
const staticEstimatePoints = computed(() => {
  const size = modelNode.value?.size
  const duration = modelNode.value?.duration
  const hit = currentModel.value?.prices?.find(
    (price) =>
      (size ? price.size === size : true) && (isVideoModel.value && duration ? price.duration === duration : true),
  )
  if (!hit) return null
  // 旧快照的数量可能超过当前模型上限：只在估算时夹紧，不改写快照
  const countCap = Math.max(1, currentModel.value?.countMax ?? 4)
  const count = isVideoModel.value
    ? 1
    : Math.min(countCap, Math.max(1, Math.round(Number(modelNode.value?.count) || 1)))
  return hit.points * count
})
function onModelChange(modelId: string) {
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.imageModels
  const model = list?.find((item) => item.modelId === modelId)
  if (model) store.changeModel(props.node.id, model)
}

/** 提示词来源（原型「提示词来自 X」）：连到本节点 prompt 口的上游 */
const promptSource = computed(() => {
  const edge = store.edges.value.find(
    (item) => item.target === props.node.id && normalizeHandle(item.targetHandle) === 'prompt',
  )
  return edge ? store.findNode(edge.source) : undefined
})

/**
 * 上游参考（原型 .wf-console__assets）：本节点的非提示词入边，按口分组、组内按连线 order 编号；
 * 点缩略图定位上游，「×」断开这条连线（既有 removeEdgeById）。
 */
const references = computed(() => {
  const incoming = store.edges.value
    .filter((edge) => edge.target === props.node.id && normalizeHandle(edge.targetHandle) !== 'prompt')
    .map((edge) => ({ edge, source: store.findNode(edge.source) }))
    .filter((item): item is { edge: (typeof item)['edge']; source: CanvasEditorNode } => Boolean(item.source))
  const seq: Record<string, number> = {}
  return (
    incoming
      // 与 run 请求同一排序（首尾帧在前、普通参考按 order）：「图N」= 提交时 references[].index
      .sort((a, b) =>
        compareRefOrder(
          { handle: a.edge.targetHandle, order: a.edge.data?.order },
          { handle: b.edge.targetHandle, order: b.edge.data?.order },
        ),
      )
      .map(({ edge, source }) => {
        const handle = edge.targetHandle ?? ''
        const group = normalizeHandle(handle) ?? handle
        seq[group] = (seq[group] ?? 0) + 1
        const n = seq[group]
        const label =
          handle === 'image1'
            ? '首帧'
            : handle === 'image2'
              ? '尾帧'
              : group === 'video'
                ? `视频${n}`
                : group === 'garment'
                  ? '服装'
                  : group === 'models'
                    ? `模特${n}`
                    : `图${n}`
        const data = source.data
        const thumb = data.resultImage ?? data.candidates?.[data.selectedCandidate ?? 0] ?? data.image ?? ''
        const badge = handle === 'image1' ? '首' : handle === 'image2' ? '尾' : group === 'garment' ? '衣' : String(n)
        // 首尾帧各占一个固定口、服装只有 1 条：不参与拖拽排序
        const sortable = handle !== 'image1' && handle !== 'image2' && group !== 'garment'
        return { id: edge.id, sourceId: source.id, name: data.title || source.id, label, badge, thumb, group, sortable }
      })
  )
})

// ---- 远端估价（Go /canvas/estimate，与冻结同一公式）----
// 图片模型：模型 / 尺寸 / 张数 / 画质 / 参考图数 / 提示词长度变化后防抖 400ms 请求；失败退回静态表并标「约」。
// 视频仍用静态表。参数没变不重复请求（按请求体签名去重），新一轮变化会中止在途请求。
const remoteEstimate = ref<ICanvasEstimateResp | null>(null)
const estimateFailed = ref(false)
let estimateTimer: ReturnType<typeof setTimeout> | undefined
let estimateAbort: AbortController | undefined
let estimateSig = ''

/** 提示词长度：优先取连到 prompt 口的上游文本，其次节点自己的提示词（promptSource 在下方声明，运行时才取值） */
function promptLength(): number {
  const upstream = promptSource.value?.data as { text?: string } | undefined
  const text = upstream?.text ?? modelNode.value?.prompt ?? ''
  return [...text].length
}

const estimateReq = computed(() => {
  const node = modelNode.value
  const model = currentModel.value
  if (!node || isVideoModel.value || !model) return null
  const countCap = Math.max(1, model.countMax ?? 4)
  return {
    model_id: model.modelId || undefined,
    model: model.model || undefined,
    size: node.size || undefined,
    count: Math.min(countCap, Math.max(1, Math.round(Number(node.count) || 1))),
    // 模型没有画质能力时不传，避免估价按一个无效画质算
    quality: model.capabilities.quality ? node.quality || undefined : undefined,
    ref_images: references.value.filter((item) => item.group !== 'video').length,
    prompt_chars: promptLength(),
  }
})

function fetchEstimate() {
  const req = estimateReq.value
  if (!req) return
  const sig = JSON.stringify(req)
  if (sig === estimateSig) return
  estimateSig = sig
  estimateAbort?.abort()
  const abort = new AbortController()
  estimateAbort = abort
  void canvasEstimate(req, abort.signal)
    .then((res) => {
      if (abort.signal.aborted) return
      const data = res.data
      if (data?.available && Number(data.points) > 0) {
        remoteEstimate.value = data
        estimateFailed.value = false
        rememberSettleMode(req.model_id ?? req.model ?? '', data.settle_mode)
      } else {
        remoteEstimate.value = null
        estimateFailed.value = true
      }
    })
    .catch(() => {
      if (abort.signal.aborted) return
      remoteEstimate.value = null
      estimateFailed.value = true
    })
}

watch(
  estimateReq,
  (req) => {
    clearTimeout(estimateTimer)
    if (!req) {
      estimateAbort?.abort()
      estimateSig = ''
      remoteEstimate.value = null
      return
    }
    estimateTimer = setTimeout(fetchEstimate, 400)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(estimateTimer)
  estimateAbort?.abort()
})

/** 预计消耗文案：远端 > 静态兜底（约 X 点）；估价失败 / 不可用都不影响运行 */
const estimateText = computed(() => {
  const remote = remoteEstimate.value
  if (remote && !estimateFailed.value) {
    return remote.settle_mode === 'actual_cost'
      ? `预计最多 ${remote.points} 点 · 按实际用量结算，通常更少`
      : `${remote.points} 点`
  }
  if (staticEstimatePoints.value !== null) return `约 ${staticEstimatePoints.value} 点`
  return ''
})

// ---- 参考排序（拖动缩略图，同口内重排 → 写回连线 data.order）----
const dragRefId = ref('')
function onRefDragStart(event: DragEvent, item: { id: string; sortable: boolean }) {
  if (!item.sortable) {
    event.preventDefault()
    return
  }
  dragRefId.value = item.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }
}
function canDropOn(item: { id: string; group: string; sortable: boolean }): boolean {
  const from = references.value.find((ref) => ref.id === dragRefId.value)
  return Boolean(from && item.sortable && from.id !== item.id && from.group === item.group)
}
function onRefDragOver(event: DragEvent, item: { id: string; group: string; sortable: boolean }) {
  if (canDropOn(item)) event.preventDefault()
}
function onRefDrop(item: { id: string; group: string; sortable: boolean }) {
  if (canDropOn(item)) {
    const sameGroup = references.value.filter((ref) => ref.group === item.group && ref.sortable)
    store.reorderReference(
      props.node.id,
      dragRefId.value,
      sameGroup.findIndex((ref) => ref.id === item.id),
    )
  }
  dragRefId.value = ''
}

/** 提示词下的引用片：「图1 / 视频1」，点一下插到光标处（提示词里按序号指代参考） */
const refTokens = computed(() =>
  references.value
    .filter((item) => /^(图|视频)\d+$/.test(item.label))
    .map((item) => ({ id: item.id, token: item.label })),
)
const promptInputRef = ref<{ textareaElRef?: HTMLTextAreaElement | null } | null>(null)
function insertToken(token: string) {
  const node = modelNode.value
  if (!node) return
  const current = node.prompt ?? ''
  const el = promptInputRef.value?.textareaElRef ?? null
  const start = el && document.activeElement === el ? el.selectionStart : current.length
  const end = el && document.activeElement === el ? el.selectionEnd : current.length
  const before = current.slice(0, start)
  const after = current.slice(end)
  const pad = before && !/\s$/.test(before) ? ' ' : ''
  const next = `${before}${pad}${token}${after}`.slice(0, 3000)
  store.updateNodeData(props.node.id, { prompt: next })
}

/** 「+」从画布选参考：可以喂图的节点（不含自身、分组框、文字、已连上的） */
const pickableRefs = computed(() => {
  const linked = new Set(store.edges.value.filter((edge) => edge.target === props.node.id).map((edge) => edge.source))
  return store.nodes.value
    .filter(
      (item) =>
        item.id !== props.node.id &&
        item.type !== 'module' &&
        item.type !== 'text' &&
        !linked.has(item.id) &&
        !(item.type === 'tool' && item.data.tool === 'i2p'),
    )
    .map((item) => ({ label: item.data.title || item.id, key: item.id }))
})
function onPickRef(key: string | number) {
  store.addReferenceFrom(props.node.id, String(key))
}

// ---- 输入节点上传 ----
const isImageInput = computed(() => props.node.type === 'image' && props.node.data.kind === 'input')
const isVideoInput = computed(() => props.node.type === 'video')
const inputImageUrl = computed(() => (props.node.data as { image?: string }).image ?? '')
const inputVideoUrl = computed(() => (props.node.data as { video?: string }).video ?? '')
const hasInputMedia = computed(() => Boolean(inputImageUrl.value || inputVideoUrl.value))

function pickFile(kind: 'image' | 'video') {
  uploadKind.value = kind
  fileRef.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await uploadFile(file)
}

/** 上传 / 资产库共用：快照里只存 http(s) 地址 */
function applyMedia(kind: 'image' | 'video', url: string) {
  store.updateNodeData(props.node.id, kind === 'video' ? { video: url } : { image: url })
}

// 从资产库添加：与「上传 / 更换」同一格，选回地址直接落节点（单张，换一张）
const assetShow = ref(false)
const assetKind = ref<'image' | 'video'>('image')
function openAssets(kind: 'image' | 'video') {
  if (uploading.value) return
  assetKind.value = kind
  assetShow.value = true
}
function onAssets(picked: string[]) {
  const url = picked.find((u) => /^https?:\/\//i.test(u))
  if (url) applyMedia(assetKind.value, url)
}

/** 选文件 / 拖入 / 粘贴共用的校验 + 上传 */
async function uploadFile(file: File) {
  if (uploading.value) return
  if (uploadKind.value === 'video' && !file.type.startsWith('video/')) {
    editorMessage.warning('请选择视频文件')
    return
  }
  if (uploadKind.value === 'image' && !file.type.startsWith('image/')) {
    editorMessage.warning('请选择图片文件')
    return
  }
  uploading.value = true
  try {
    applyMedia(uploadKind.value, await canvasUploadMedia(file))
  } catch (error) {
    editorMessage.error(error instanceof Error ? error.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

// 拖入 / 粘贴到预览框：等同点「上传 / 更换」后选了这个文件
const mediaDropRef = ref<HTMLElement | null>(null)
const dropKind = computed<'image' | 'video'>(() =>
  isVideoInput.value || modelNode.value?.inputOnly ? 'video' : 'image',
)
const { dragging: mediaDragging } = useFileDropPaste(mediaDropRef, {
  accept: dropKind,
  disabled: uploading,
  rejectMessage: () => (dropKind.value === 'video' ? '请选择视频文件' : '请选择图片文件'),
  onFiles: ([file]) => {
    if (!file) return
    uploadKind.value = dropKind.value
    uploadFile(file)
  },
})

// ---- 运行 ----
const isRunning = computed(() => props.node.data.status === 'running' || props.node.data.status === 'queued')
const canRun = computed(() => props.node.type === 'model')
const candidates = computed(() => props.node.data.candidates ?? [])
const selectedIdx = computed(() => props.node.data.selectedCandidate ?? 0)
/** 节点上「×」移除的候选（下标不重排），控制台同样不显示 */
const hiddenSet = computed(() => store.hiddenCandidatesOf(props.node.data))

function onSelectCandidate(index: number) {
  void store.selectCandidate(props.node.id, index)
}

function run() {
  void store.runNode(props.node.id)
}

function cancel() {
  void store.cancelRun(props.node.id)
}

/** 底部说明：生成节点给参考图上限 + 单价；其余节点给操作提示 */
const footHint = computed(() => {
  if (modelNode.value) {
    const refs = `参考图上限 ${modelNode.value.maxImageRefs ?? 5} 张 · 参考视频 ${currentModel.value?.maxReferenceVideos ?? 0} 个`
    return priceHint.value && estimateText.value === '' ? `${refs} · ${priceHint.value}` : refs
  }
  if (props.node.type === 'module') return '分组框仅作视觉分组，不参与连线'
  return ''
})
</script>

<template>
  <section
    :class="docked ? 'border-0 border-l border-solid border-line bg-overlay' : POP_SURFACE"
    class="flex flex-col w-full h-full p-12px text-ink-2"
    role="dialog"
    :aria-label="`节点控制台：${node.data.title || typeLabel}`"
    data-canvas-console
    @pointerdown.stop
    @wheel.stop
  >
    <!-- 头部（原型 .wf-console__head）：类型 + 标题 + 执行钮 -->
    <header class="flex shrink-0 items-center gap-8px pb-8px">
      <span
        class="shrink-0 px-6px py-1px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-11px font-600 leading-16px"
        >{{ typeLabel }}</span
      >
      <n-input
        v-model:value="titleValue"
        size="small"
        placeholder="节点标题"
        maxlength="50"
        class="!max-w-200px"
        :input-props="{ 'aria-label': '节点标题' }"
      />
      <small v-if="modelNode" class="min-w-0 overflow-hidden text-violet-ink text-11px text-ellipsis whitespace-nowrap">
        {{ promptSource ? `提示词来自 ${promptSource.data.title || promptSource.id}` : '节点内输入' }}
      </small>
      <button
        v-if="canRun"
        type="button"
        :class="NODE_RUN_BTN"
        class="ml-auto"
        :title="isRunning ? '取消执行' : '执行此节点'"
        :aria-label="isRunning ? `取消执行 ${node.data.title}` : `执行 ${node.data.title}`"
        @click="isRunning ? cancel() : run()"
      >
        <EditorIcon :name="isRunning ? 'stop' : 'play'" :size="13" />
      </button>
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto -mx-4px px-4px">
      <!-- 提示词文本节点 -->
      <template v-if="node.type === 'text'">
        <label :class="LABEL" for="canvas-console-text">提示词正文</label>
        <n-input
          v-model:value="textValue"
          type="textarea"
          class="nodrag nowheel"
          placeholder="输入提示词，或连到生成节点的提示词口"
          :maxlength="3000"
          show-count
          :autosize="{ minRows: 8, maxRows: 14 }"
          :input-props="{ id: 'canvas-console-text' }"
        />
      </template>

      <!-- 图片 / 视频输入节点 -->
      <template v-else-if="isImageInput || isVideoInput">
        <span :class="LABEL">{{ isVideoInput ? '视频' : '图片' }}</span>
        <div
          ref="mediaDropRef"
          :class="[PREVIEW, mediaDragging && 'sx-drop']"
          class="mb-8px min-h-120px [&_img]:max-h-200px [&_video]:max-h-200px"
        >
          <video v-if="isVideoInput && inputVideoUrl" :src="inputVideoUrl" controls preload="metadata" />
          <n-image v-else-if="inputImageUrl" :src="inputImageUrl" object-fit="contain" />
          <div v-else class="py-30px text-placeholder text-12px">
            还没有{{ isVideoInput ? '视频' : '图片' }}，{{ DROP_PASTE_HINT }}
          </div>
        </div>
        <div class="flex items-center gap-8px">
          <n-button size="small" :loading="uploading" @click="pickFile(isVideoInput ? 'video' : 'image')">
            {{ hasInputMedia ? '更换' : '上传' }}
          </n-button>
          <n-button size="small" :disabled="uploading" @click="openAssets(isVideoInput ? 'video' : 'image')">
            从资产库添加
          </n-button>
        </div>
        <input
          ref="fileRef"
          type="file"
          :accept="
            isVideoInput
              ? '.mp4,.mov,video/mp4,video/quicktime'
              : '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
          "
          hidden
          @change="onFile"
        />
      </template>

      <!-- 生成节点 -->
      <template v-else-if="modelNode">
        <!-- 上游参考（原型 .wf-console__assets）：44px 缩略图 + 藤紫序号；点击定位、× 断开（视觉 16、::after 外扩 8 → 命中 32；间距 14 / 上内边距 14 免得命中区被裁或压到邻居）-->
        <div
          class="flex items-start gap-14px mb-8px pt-14px pl-5px pr-14px overflow-x-auto"
          role="list"
          aria-label="上游参考"
        >
          <div
            v-for="item in references"
            :key="item.id"
            class="relative shrink-0 w-44px"
            :class="{ 'opacity-50': dragRefId === item.id, 'cursor-grab': item.sortable }"
            role="listitem"
            :draggable="item.sortable"
            :title="item.sortable ? `${item.label} · ${item.name}（拖动可调整序号）` : `${item.label} · ${item.name}`"
            @dragstart="onRefDragStart($event, item)"
            @dragover="onRefDragOver($event, item)"
            @drop.prevent="onRefDrop(item)"
            @dragend="dragRefId = ''"
          >
            <button
              type="button"
              class="block w-44px p-0 border-none bg-transparent text-left cursor-pointer"
              :class="FOCUS_RING"
              :aria-label="`${item.label}：${item.name}，点击定位`"
              @click="emit('locate', item.sourceId)"
            >
              <span
                class="absolute -top-5px -left-5px z-2 grid min-w-16px h-16px px-3px place-items-center border border-solid border-violet-line rounded-full bg-violet-soft text-violet-ink text-11px font-600 leading-none"
                aria-hidden="true"
                >{{ item.badge }}</span
              >
              <img
                v-if="item.thumb"
                :src="item.thumb"
                alt=""
                draggable="false"
                class="block w-44px h-44px border border-solid border-line rounded-4px bg-surface3 object-cover"
                @error="store.refreshNodeMedia(item.sourceId)"
              />
              <span
                v-else
                class="grid w-44px h-44px place-items-center border border-solid border-line rounded-4px bg-surface3 text-muted"
              >
                <EditorIcon name="video" :size="16" />
              </span>
              <span
                class="block mt-3px overflow-hidden text-muted text-11px leading-14px text-ellipsis whitespace-nowrap"
                >{{ item.label }}</span
              >
            </button>
            <button
              type="button"
              class="absolute -top-6px -right-6px z-3 grid w-16px h-16px p-0 place-items-center border border-solid border-line-strong rounded-full bg-white text-muted text-11px leading-none cursor-pointer hover:border-danger-line hover:text-danger after:content-empty after:absolute after:-inset-8px"
              :class="FOCUS_RING"
              :aria-label="`断开参考 ${item.label}`"
              title="断开这个参考"
              @click="store.removeEdgeById(item.id)"
            >
              ×
            </button>
          </div>
          <!-- 虚线「+」：从画布上的节点里选一个连到参考口（连线校验同拖线） -->
          <n-dropdown
            v-if="!modelNode.inputOnly && pickableRefs.length"
            trigger="click"
            :options="pickableRefs"
            scrollable
            :menu-props="() => ({ style: 'max-height: 260px' })"
            @select="onPickRef"
          >
            <button
              type="button"
              class="grid shrink-0 w-44px h-44px p-0 place-items-center border border-dashed border-line-strong rounded-4px bg-white text-muted cursor-pointer hover:border-violet hover:bg-violet-soft hover:text-violet-ink"
              :class="FOCUS_RING"
              title="从画布选一个节点作为参考"
              aria-label="从画布选一个节点作为参考"
              aria-haspopup="menu"
            >
              <EditorIcon name="plus" :size="16" />
            </button>
          </n-dropdown>
          <span v-if="!references.length" class="self-center text-muted text-11px leading-[1.5]"
            >还没有上游参考：把图片 / 生成节点连到左侧参考口，点「+」从画布选，或直接写提示词</span
          >
          <span
            v-else-if="references.some((item) => item.sortable)"
            class="self-center text-muted text-11px leading-[1.5]"
            >拖动缩略图可调整序号</span
          >
        </div>

        <!-- 参考视频素材（inputOnly，不执行）：视频由用户上传，下游从 video 口引用（契约 4.2 元素替换） -->
        <div v-if="modelNode.inputOnly" class="mb-8px">
          <span :class="LABEL">参考视频</span>
          <div
            ref="mediaDropRef"
            :class="[PREVIEW, mediaDragging && 'sx-drop']"
            class="mb-8px min-h-100px [&_video]:max-h-180px"
          >
            <video v-if="modelNode.video" :src="modelNode.video" controls preload="metadata" />
            <div v-else class="py-24px text-placeholder text-12px">还没有视频，{{ DROP_PASTE_HINT }}</div>
          </div>
          <div class="flex items-center gap-8px">
            <n-button size="small" :loading="uploading" @click="pickFile('video')">
              {{ modelNode.video ? '更换' : '上传' }}
            </n-button>
            <n-button size="small" :disabled="uploading" @click="openAssets('video')">从资产库添加</n-button>
          </div>
          <input ref="fileRef" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" hidden @change="onFile" />
        </div>

        <label :class="LABEL" for="canvas-console-prompt">提示词</label>
        <n-input
          ref="promptInputRef"
          v-model:value="modelNode.prompt"
          type="textarea"
          class="nodrag nowheel"
          placeholder="留空则使用连线文字节点的文本"
          :maxlength="3000"
          show-count
          :autosize="{ minRows: 3, maxRows: 8 }"
          :input-props="{ id: 'canvas-console-prompt' }"
        />
        <!-- 引用片：点一下把「图1 / 视频1」插到提示词光标处 -->
        <div v-if="refTokens.length" class="flex flex-wrap gap-6px mt-6px" aria-label="插入参考引用">
          <button
            v-for="chip in refTokens"
            :key="chip.id"
            type="button"
            class="h-28px px-10px border border-solid border-violet-line rounded-14px bg-violet-soft text-violet-ink text-12px leading-none cursor-pointer hover:border-violet hover:bg-violet-soft-2"
            :class="FOCUS_RING"
            :title="`在提示词里插入「${chip.token}」`"
            @mousedown.prevent
            @click="insertToken(chip.token)"
          >
            {{ chip.token }}
          </button>
        </div>

        <!-- 模型行（原型 .wf-console__model） -->
        <div class="flex items-center gap-8px mt-8px">
          <span class="shrink-0 text-muted text-11px">模型</span>
          <n-select
            :value="modelNode.modelId || modelNode.model || ''"
            size="small"
            :options="modelOptions"
            :placeholder="modelOptions.length ? '选择模型' : '目录加载中…'"
            @update:value="onModelChange"
          />
        </div>

        <!-- 比例 / 分辨率 / 数量 / 时长 / 声音已上卡（ModelParamFields），控制台不再重复，卡上是唯一入口 -->
        <!-- 预计消耗（单独一行）：服务端以实际扣点为准 -->
        <div v-if="estimateText" class="flex items-baseline gap-6px mt-8px text-muted text-11px" data-estimate>
          <span>预计消耗</span>
          <b class="text-ink text-12px font-600 tabular-nums">{{ estimateText }}</b>
        </div>
      </template>

      <!-- 运行态：进度 / 失败 / 候选 / 反推结果 -->
      <template v-if="canRun">
        <div
          v-if="isRunning"
          :class="NODE_NOTICE"
          class="!mt-10px border border-solid border-line-soft bg-surface2 text-muted"
          role="status"
        >
          <span
            class="shrink-0 w-12px h-12px border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-800"
          />
          {{ node.data.status === 'queued' ? '排队中…' : `生成中 ${node.data.progress ?? 0}%` }}
        </div>
        <RunErrorNotice
          v-else-if="node.data.status === 'error'"
          :node-id="node.id"
          :data="node.data"
          class="!mt-10px"
        />
        <div v-if="candidates.length" class="mt-10px">
          <span :class="LABEL">候选（点击设为输出）</span>
          <div class="flex flex-wrap gap-8px">
            <button
              v-for="(url, index) in candidates"
              v-show="!hiddenSet.has(index)"
              :key="url + index"
              type="button"
              class="relative shrink-0 w-48px h-48px p-0 overflow-hidden border border-solid border-line rounded-4px bg-surface2 cursor-pointer hover:border-violet-line"
              :class="[
                FOCUS_RING,
                { '!border-violet shadow-[0_0_0_2px_rgb(var(--xq-violet-rgb)/0.18)]': selectedIdx === index },
              ]"
              :aria-pressed="selectedIdx === index"
              :aria-label="`候选 ${index + 1}，设为输出`"
              @click="onSelectCandidate(index)"
            >
              <img
                :src="url"
                :alt="`候选 ${index + 1}`"
                draggable="false"
                class="block w-full h-full object-cover"
                @error="store.refreshNodeMedia(node.id)"
              />
            </button>
          </div>
          <LibraryStatusHint
            v-if="node.data.status !== 'running' && node.data.status !== 'queued'"
            :status="node.data.libraryStatus"
            :retry="() => store.retryLibrary(node.id)"
          />
        </div>
        <div v-if="(node.data as { resultText?: string }).resultText" class="mt-10px">
          <span :class="LABEL">反推结果</span>
          <div
            class="px-10px py-8px border border-solid border-line-soft rounded-4px bg-surface2 text-ink text-12px leading-18px whitespace-pre-wrap break-all max-h-150px overflow-auto"
          >
            {{ (node.data as { resultText?: string }).resultText }}
          </div>
        </div>
      </template>
    </div>

    <!-- 底部（原型 .wf-console__foot）：说明 + 完成 -->
    <footer class="flex shrink-0 items-center gap-8px pt-8px text-muted text-11px">
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" :title="footHint">{{ footHint }}</span>
      <button
        type="button"
        class="shrink-0 h-28px ml-auto px-12px border border-solid border-control rounded-4px bg-gradient-to-b from-white to-plate-bottom text-ink-2 text-13px cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(31,35,41,0.05)] hover:border-control-hover hover:text-ink"
        :class="FOCUS_RING"
        title="收起控制台"
        @click="store.selectNode('')"
      >
        完成
      </button>
    </footer>

    <AssetPickerModal v-model:show="assetShow" :media="assetKind" :limit="1" @select="onAssets" />
  </section>
</template>
