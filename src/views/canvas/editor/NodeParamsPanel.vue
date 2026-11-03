<script setup lang="ts">
/**
 * 节点控制台（原型 CanvasConsolePanel + canvas-v31 §3）：约 520×360 的浮层，由画布页定位在选中节点下方（放不下翻到上方）。
 * 头部：类型 + 标题 + 执行钮；主体按节点类型 / catalog 能力出表单；底部：说明 + 「完成」。
 * 字段、校验、提交与运行 / 轮询行为与原右侧参数面板一致：节点参数直接写回节点 data（快照私有字段，camelCase 原样保存）。
 */
import { computed, h, ref } from 'vue'
import type { VNode } from 'vue'
import type { SelectOption } from 'naive-ui'
import EditorIcon from './EditorIcon.vue'
import RunErrorNotice from './RunErrorNotice.vue'
import { normalizeHandle, toolLabel } from './graph.ts'
import { editorMessage, useCanvasEditor } from './useCanvasEditor.ts'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import type { ICanvasCatalogTool } from '@/api/canvasHome.ts'
import type { CanvasEditorNode, CanvasToolKind, CanvasNodeData } from './types.ts'
import { FOCUS_RING, NODE_NOTICE, NODE_RUN_BTN, POP_SURFACE } from './ui.ts'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'

const props = defineProps<{ node: CanvasEditorNode }>()

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
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.image_models
  return (list ?? []).map((item) => ({
    label: item.ready ? item.model : `${item.model}（不可用）`,
    value: item.model_id,
    disabled: !item.ready,
  }))
})
const currentModel = computed(() => {
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.image_models
  return (
    list?.find((item) => item.model_id === modelNode.value?.modelId) ??
    list?.find((item) => item.model === modelNode.value?.model)
  )
})
const capabilities = computed(() => modelNode.value?.capabilities ?? {})
const ratioOptions = computed(() =>
  (currentModel.value?.ratios ?? ['1:1', '3:4', '4:3', '9:16', '16:9']).map((value) => ({ label: value, value })),
)
const sizeOptions = computed(() =>
  (currentModel.value?.sizes ?? (isVideoModel.value ? ['720p', '1080p'] : ['1K', '2K'])).map((value) => ({
    label: value,
    value,
  })),
)
const qualityOptions = computed(() => {
  const list = currentModel.value?.qualities?.length ? currentModel.value.qualities : ['low', 'medium', 'high']
  return list.map((value) => ({ label: { low: '低', medium: '中', high: '高' }[value] ?? value, value }))
})
const durationOptions = computed(() =>
  (currentModel.value?.durations ?? ['4s', '6s', '8s']).map((value) => ({ label: value, value })),
)
const countMax = computed(() => currentModel.value?.count_max ?? (isVideoModel.value ? 1 : 4))
const priceHint = computed(() => {
  const size = modelNode.value?.size
  const duration = modelNode.value?.duration
  const hit = currentModel.value?.prices?.find(
    (price) => (size ? price.size === size : true) && (duration ? price.duration === duration : true),
  )
  return hit ? `约 ${hit.points} 点/张` : ''
})
/** 参数格列数：视频 4 列（原型 .wf-console__controls.is-video），图片 3 列 */
const controlCols = computed(() => (isVideoModel.value ? 'grid-cols-4' : 'grid-cols-3'))

function onModelChange(modelId: string) {
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.image_models
  const model = list?.find((item) => item.model_id === modelId)
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
  return incoming
    .sort((a, b) => (a.edge.data?.order ?? 0) - (b.edge.data?.order ?? 0))
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
      return { id: edge.id, sourceId: source.id, name: data.title || source.id, label, badge, thumb }
    })
})

// ---- 工具节点 ----
const toolNode = computed(() => (props.node.type === 'tool' ? (props.node.data as CanvasNodeData) : null))
const toolMetaList = computed<ICatalogToolMeta[]>(() =>
  (catalog.value?.tools ?? []).map((tool) => ({
    tool: tool.tool as CanvasToolKind,
    label: tool.label || toolLabel(tool.tool),
    meta: tool,
  })),
)
interface ICatalogToolMeta {
  tool: CanvasToolKind
  label: string
  meta?: ICanvasCatalogTool
}
const toolOptions = computed(() => {
  const list = toolMetaList.value.length
    ? toolMetaList.value
    : (['crop', 'upscale', 'outpaint', 'i2p', 'mask', 'tryon'] as CanvasToolKind[]).map((tool) => ({
        tool,
        label: toolLabel(tool),
        meta: undefined,
      }))
  return list.map((item) => {
    const closed = item.meta?.ready === false
    return { label: closed ? `${item.label}（暂未开放）` : item.label, value: item.tool, disabled: closed }
  })
})
/** 禁用项加原生 tooltip，说明灰显原因 */
function renderToolOption({ node, option }: { node: VNode; option: SelectOption }): VNode {
  return option.disabled ? h('div', { title: '该功能暂未开放' }, [node]) : node
}
const scaleOptions = computed(() =>
  (toolMetaList.value.find((item) => item.tool === 'upscale')?.meta?.scales ?? [2, 4]).map((value) => ({
    label: `${value}x`,
    value: String(value),
  })),
)
const outpaintRatioOptions = computed(() => {
  const ratios = toolMetaList.value.find((item) => item.tool === 'outpaint')?.meta?.ratios ?? [
    '1:1',
    '3:4',
    '4:3',
    '9:16',
    '16:9',
    '2:3',
    '3:2',
  ]
  return ratios.map((value) => ({ label: value, value }))
})
const outpaintResolutionOptions = ['1k', '2k', '4k'].map((value) => ({ label: value, value }))
const tryonResolutionOptions = outpaintResolutionOptions
const tryonModelOptions = ['通用', 'GPT', 'Banana', 'Seedream'].map((value) => ({ label: value, value }))
const TRYON_ITEMS = [
  { value: 'top', label: '上衣' },
  { value: 'bottom', label: '下装' },
  { value: 'dress', label: '连衣裙' },
  { value: 'outer', label: '外套' },
  { value: 'shoes', label: '鞋子' },
  { value: 'accessory', label: '配饰' },
  { value: 'bra', label: '文胸' },
  { value: 'panties', label: '内裤' },
]
/** 互斥（api-studio 2.1）：连衣裙与上衣 / 下装、文胸与上衣 / 连衣裙、内裤与下装 / 连衣裙 */
const TRYON_CONFLICTS: Record<string, string[]> = {
  dress: ['top', 'bottom', 'bra', 'panties'],
  top: ['dress', 'bra'],
  bottom: ['dress', 'panties'],
  bra: ['top', 'dress'],
  panties: ['bottom', 'dress'],
}
const tryonItems = computed(() => (toolNode.value?.tryonItems?.length ? toolNode.value.tryonItems : ['top']))
const tryonItemOptions = computed(() =>
  TRYON_ITEMS.map((item) => {
    const selected = tryonItems.value.includes(item.value)
    const conflict = tryonItems.value.some((s) => TRYON_CONFLICTS[item.value]?.includes(s))
    return {
      ...item,
      disabled: !selected && (conflict || tryonItems.value.length >= 3),
    }
  }),
)
function toggleTryonItem(value: string, checked: boolean) {
  const next = checked ? [...tryonItems.value, value] : tryonItems.value.filter((v) => v !== value)
  if (!next.length) return // 至少保留 1 件
  store.updateNodeData(props.node.id, { tryonItems: next })
}
/** 工具可选的上游图片来源（不含分组框与自身） */
const upstreamOptions = computed(() =>
  store.nodes.value
    .filter((item) => item.id !== props.node.id && item.type !== 'module' && item.type !== 'text')
    .map((item) => ({ label: item.data.title || item.id, value: item.id })),
)
const upstreamImage = computed(() => {
  const id = toolNode.value?.sourceNodeId
  if (!id) return ''
  const source = store.findNode(id)
  if (!source) return ''
  const media = source.data as { image?: string; video?: string }
  return media.image ?? media.video ?? ''
})
/** 扩图宽高须成对（执行前 toolParamsOf 同口径拦截） */
const outSizeUnpaired = computed(() => {
  const node = toolNode.value
  return Boolean(node && ((node.outWidth && !node.outHeight) || (!node.outWidth && node.outHeight)))
})

// ---- 局部重绘：在输入图预览上拖拽框选（比例坐标，不存 dataURL） ----
const maskSourceImage = computed(() => {
  const node = toolNode.value
  if (!node || node.tool !== 'mask') return ''
  const edge = store.edges.value.find(
    (item) => item.target === props.node.id && (item.targetHandle ?? 'image') === 'image',
  )
  const source = store.findNode(edge?.source ?? node.sourceNodeId ?? '')
  const media = source?.data as { resultImage?: string; image?: string } | undefined
  return media?.resultImage ?? media?.image ?? ''
})
const maskDraft = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let maskStart: { x: number; y: number } | null = null
const maskShown = computed(() => maskDraft.value ?? toolNode.value?.maskBox ?? null)

function maskPoint(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
}
function onMaskDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  maskStart = maskPoint(event)
  maskDraft.value = { ...maskStart, w: 0, h: 0 }
}
function onMaskMove(event: PointerEvent) {
  if (!maskStart) return
  const p = maskPoint(event)
  maskDraft.value = {
    x: Math.min(maskStart.x, p.x),
    y: Math.min(maskStart.y, p.y),
    w: Math.abs(p.x - maskStart.x),
    h: Math.abs(p.y - maskStart.y),
  }
}
function onMaskUp() {
  const box = maskDraft.value
  maskStart = null
  maskDraft.value = null
  if (box && box.w >= 0.02 && box.h >= 0.02) store.updateNodeData(props.node.id, { maskBox: box })
}
function clearMaskBox() {
  store.updateNodeData(props.node.id, { maskBox: undefined })
}

function onToolChange(tool: CanvasToolKind) {
  store.updateNodeData(props.node.id, {
    tool,
    title: toolLabel(tool),
    crop: tool === 'crop' ? { shape: 'rect', x: 0.1, y: 0.1, w: 0.6, h: 0.6 } : undefined,
    scale: tool === 'upscale' ? 2 : undefined,
    language: tool === 'i2p' ? 'zh' : undefined,
    ratio: tool === 'outpaint' ? '16:9' : undefined,
    maskPrompt: tool === 'mask' ? '' : undefined,
    resolution: undefined,
    outWidth: undefined,
    outHeight: undefined,
    maskBox: undefined,
  })
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
const canRun = computed(() => props.node.type === 'model' || props.node.type === 'tool')
const candidates = computed(() => props.node.data.candidates ?? [])
const selectedIdx = computed(() => props.node.data.selectedCandidate ?? 0)

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
    const refs = `参考图上限 ${modelNode.value.maxImageRefs ?? 5} 张 · 参考视频 ${currentModel.value?.max_reference_videos ?? 0} 个`
    return priceHint.value ? `${refs} · ${priceHint.value}` : refs
  }
  if (toolNode.value) return '工具产出可继续连到生成节点'
  if (props.node.type === 'module') return '分组框仅作视觉分组，不参与连线'
  return ''
})
</script>

<template>
  <section
    :class="POP_SURFACE"
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
          <div v-else class="py-30px text-placeholder text-12px">还没有{{ isVideoInput ? '视频' : '图片' }}</div>
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
              ? '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm'
              : '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
          "
          hidden
          @change="onFile"
        />
      </template>

      <!-- 生成节点 -->
      <template v-else-if="modelNode">
        <!-- 上游参考（原型 .wf-console__assets）：44px 缩略图 + 藤紫序号；点击定位、× 断开 -->
        <div class="flex items-start gap-8px mb-8px pt-6px pl-5px overflow-x-auto" role="list" aria-label="上游参考">
          <div
            v-for="item in references"
            :key="item.id"
            class="relative shrink-0 w-44px"
            role="listitem"
            :title="`${item.label} · ${item.name}`"
          >
            <button
              type="button"
              class="block w-44px p-0 border-none bg-transparent text-left cursor-pointer"
              :class="FOCUS_RING"
              :aria-label="`${item.label}：${item.name}，点击定位`"
              @click="emit('locate', item.sourceId)"
            >
              <span
                class="absolute -top-5px -left-5px z-2 grid min-w-16px h-16px px-3px place-items-center border border-solid border-violet-line rounded-full bg-violet-soft text-violet-ink text-10px font-600 leading-none"
                aria-hidden="true"
                >{{ item.badge }}</span
              >
              <img
                v-if="item.thumb"
                :src="item.thumb"
                alt=""
                draggable="false"
                class="block w-44px h-44px border border-solid border-line rounded-4px bg-surface3 object-cover"
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
              class="absolute -top-6px -right-6px grid w-16px h-16px p-0 place-items-center border border-solid border-line-strong rounded-full bg-white text-muted text-11px leading-none cursor-pointer hover:border-[#e4b7b4] hover:text-danger after:content-empty after:absolute after:-inset-6px"
              :class="FOCUS_RING"
              :aria-label="`断开参考 ${item.label}`"
              title="断开这个参考"
              @click="store.removeEdgeById(item.id)"
            >
              ×
            </button>
          </div>
          <span v-if="!references.length" class="self-center text-muted text-11px leading-[1.5]"
            >还没有上游参考：把图片 / 生成节点连到左侧参考口，或直接写提示词</span
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
            <div v-else class="py-24px text-placeholder text-12px">还没有视频</div>
          </div>
          <div class="flex items-center gap-8px">
            <n-button size="small" :loading="uploading" @click="pickFile('video')">
              {{ modelNode.video ? '更换' : '上传' }}
            </n-button>
            <n-button size="small" :disabled="uploading" @click="openAssets('video')">从资产库添加</n-button>
          </div>
          <input
            ref="fileRef"
            type="file"
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            hidden
            @change="onFile"
          />
        </div>

        <label :class="LABEL" for="canvas-console-prompt">提示词</label>
        <n-input
          v-model:value="modelNode.prompt"
          type="textarea"
          class="nodrag nowheel"
          placeholder="留空则使用连线文字节点的文本"
          :maxlength="3000"
          show-count
          :autosize="{ minRows: 3, maxRows: 8 }"
          :input-props="{ id: 'canvas-console-prompt' }"
        />

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

        <!-- 参数格（原型 .wf-console__controls：图片 3 列 / 视频 4 列） -->
        <div class="grid gap-6px mt-8px" :class="controlCols">
          <div>
            <span :class="LABEL">比例</span>
            <n-select v-model:value="modelNode.ratio" size="small" :options="ratioOptions" />
          </div>
          <div>
            <span :class="LABEL">分辨率</span>
            <n-select v-model:value="modelNode.size" size="small" :options="sizeOptions" />
          </div>
          <div v-if="capabilities.quality">
            <span :class="LABEL">质量</span>
            <n-select v-model:value="modelNode.quality" size="small" :options="qualityOptions" />
          </div>
          <div v-if="capabilities.count">
            <span :class="LABEL">张数（≤{{ countMax }}）</span>
            <n-input-number v-model:value="modelNode.count" size="small" :min="1" :max="countMax" class="w-full" />
          </div>
          <div v-if="capabilities.duration">
            <span :class="LABEL">时长</span>
            <n-select v-model:value="modelNode.duration" size="small" :options="durationOptions" />
          </div>
          <div v-if="capabilities.sound">
            <span :class="LABEL">声音</span>
            <div class="flex h-28px items-center">
              <n-switch v-model:value="modelNode.sound" size="small" aria-label="声音" />
            </div>
          </div>
        </div>
      </template>

      <!-- 工具节点 -->
      <template v-else-if="toolNode">
        <div class="grid gap-8px" :class="toolNode.tool !== 'tryon' ? 'grid-cols-2' : 'grid-cols-1'">
          <div>
            <span :class="LABEL">工具</span>
            <n-select
              :value="toolNode.tool ?? 'crop'"
              size="small"
              :options="toolOptions"
              :render-option="renderToolOption"
              @update:value="onToolChange"
            />
          </div>
          <div v-if="toolNode.tool !== 'tryon'">
            <span :class="LABEL">上游图片（不连线时指定）</span>
            <n-select
              v-model:value="toolNode.sourceNodeId"
              size="small"
              clearable
              :options="upstreamOptions"
              placeholder="连线优先；也可在这里选"
            />
          </div>
        </div>
        <div v-if="toolNode.tool !== 'tryon' && upstreamImage" :class="PREVIEW" class="mt-8px [&_img]:max-h-110px">
          <img :src="upstreamImage" alt="" />
        </div>

        <template v-if="toolNode.tool === 'crop'">
          <div class="grid grid-cols-3 gap-6px mt-8px">
            <div>
              <span :class="LABEL">形状</span>
              <n-select
                v-model:value="toolNode.crop!.shape"
                size="small"
                :options="[
                  { label: '矩形', value: 'rect' },
                  { label: '圆形（外接矩形）', value: 'circle' },
                ]"
              />
            </div>
            <div>
              <span :class="LABEL">X</span>
              <n-input-number
                v-model:value="toolNode.crop!.x"
                class="w-full"
                size="small"
                :min="0"
                :max="1"
                :step="0.05"
              />
            </div>
            <div>
              <span :class="LABEL">Y</span>
              <n-input-number
                v-model:value="toolNode.crop!.y"
                class="w-full"
                size="small"
                :min="0"
                :max="1"
                :step="0.05"
              />
            </div>
            <div>
              <span :class="LABEL">宽</span>
              <n-input-number
                v-model:value="toolNode.crop!.w"
                class="w-full"
                size="small"
                :min="0.05"
                :max="1"
                :step="0.05"
              />
            </div>
            <div>
              <span :class="LABEL">高</span>
              <n-input-number
                v-model:value="toolNode.crop!.h"
                class="w-full"
                size="small"
                :min="0.05"
                :max="1"
                :step="0.05"
              />
            </div>
          </div>
        </template>

        <div v-if="toolNode.tool === 'upscale'" class="grid grid-cols-2 gap-8px mt-8px">
          <div>
            <span :class="LABEL">放大倍数</span>
            <n-select
              :value="String(toolNode.scale ?? 2)"
              size="small"
              :options="scaleOptions"
              @update:value="(v: string) => store.updateNodeData(node.id, { scale: Number(v) })"
            />
          </div>
        </div>

        <template v-if="toolNode.tool === 'outpaint'">
          <div class="grid grid-cols-2 gap-8px mt-8px">
            <div>
              <span :class="LABEL">目标比例</span>
              <n-select v-model:value="toolNode.ratio" size="small" :options="outpaintRatioOptions" />
            </div>
            <div>
              <span :class="LABEL">分辨率</span>
              <n-select
                :value="toolNode.resolution || '2k'"
                size="small"
                :options="outpaintResolutionOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { resolution: v })"
              />
            </div>
          </div>
          <span :class="LABEL" class="mt-8px">或指定宽高（像素，须同时填写；填写后忽略比例）</span>
          <div class="flex items-center gap-8px">
            <n-input-number
              :value="toolNode.outWidth ?? null"
              size="small"
              clearable
              :min="1"
              :precision="0"
              placeholder="宽"
              :input-props="{ 'aria-label': '扩图宽度' }"
              @update:value="(v: number | null) => store.updateNodeData(node.id, { outWidth: v ?? undefined })"
            />
            <span class="text-muted">×</span>
            <n-input-number
              :value="toolNode.outHeight ?? null"
              size="small"
              clearable
              :min="1"
              :precision="0"
              placeholder="高"
              :input-props="{ 'aria-label': '扩图高度' }"
              @update:value="(v: number | null) => store.updateNodeData(node.id, { outHeight: v ?? undefined })"
            />
          </div>
          <div v-if="outSizeUnpaired" class="mt-4px text-danger text-11px" role="alert">宽高须成对填写</div>
        </template>

        <template v-if="toolNode.tool === 'tryon'">
          <div class="mt-8px">
            <span :class="LABEL">单品（1–3 件）</span>
            <div class="flex flex-wrap gap-x-12px gap-y-6px">
              <n-checkbox
                v-for="opt in tryonItemOptions"
                :key="opt.value"
                :checked="tryonItems.includes(opt.value)"
                :disabled="opt.disabled"
                @update:checked="(v: boolean) => toggleTryonItem(opt.value, v)"
              >
                {{ opt.label }}
              </n-checkbox>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-8px mt-8px">
            <div>
              <span :class="LABEL">服装名称（可选）</span>
              <n-input
                :value="toolNode.garmentName ?? ''"
                size="small"
                maxlength="50"
                :input-props="{ 'aria-label': '服装名称' }"
                @update:value="(v: string) => store.updateNodeData(node.id, { garmentName: v })"
              />
            </div>
            <div>
              <span :class="LABEL">面料（可选）</span>
              <n-input
                :value="toolNode.fabric ?? ''"
                size="small"
                maxlength="50"
                :input-props="{ 'aria-label': '面料' }"
                @update:value="(v: string) => store.updateNodeData(node.id, { fabric: v })"
              />
            </div>
          </div>
          <div class="grid grid-cols-3 gap-8px mt-8px">
            <div>
              <span :class="LABEL">模型</span>
              <n-select
                :value="toolNode.tryonModel || '通用'"
                size="small"
                :options="tryonModelOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { tryonModel: v })"
              />
            </div>
            <div>
              <span :class="LABEL">分辨率</span>
              <n-select
                :value="toolNode.tryonResolution || '1k'"
                size="small"
                :options="tryonResolutionOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { tryonResolution: v })"
              />
            </div>
            <div>
              <span :class="LABEL">比例</span>
              <n-select
                :value="toolNode.tryonAspectRatio || '3:4'"
                size="small"
                :options="outpaintRatioOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { tryonAspectRatio: v })"
              />
            </div>
          </div>
        </template>

        <div v-if="toolNode.tool === 'i2p'" class="grid grid-cols-2 gap-8px mt-8px">
          <div>
            <span :class="LABEL">输出语言</span>
            <n-select
              v-model:value="toolNode.language"
              size="small"
              :options="[
                { label: '中文', value: 'zh' },
                { label: '英文', value: 'en' },
              ]"
            />
          </div>
        </div>

        <template v-if="toolNode.tool === 'mask'">
          <div class="flex items-center justify-between mt-8px">
            <span :class="LABEL">重绘区域（在图上拖拽框选）</span>
            <button
              v-if="toolNode.maskBox"
              type="button"
              class="p-0 border-0 bg-transparent text-violet-ink text-11px cursor-pointer hover:text-violet-press"
              :class="FOCUS_RING"
              @click="clearMaskBox"
            >
              清除
            </button>
          </div>
          <div
            v-if="maskSourceImage"
            class="nodrag relative inline-block max-w-full cursor-crosshair select-none touch-none"
            @pointerdown="onMaskDown"
            @pointermove="onMaskMove"
            @pointerup="onMaskUp"
            @pointercancel="onMaskUp"
          >
            <img
              :src="maskSourceImage"
              alt=""
              draggable="false"
              class="block max-w-full max-h-200px pointer-events-none"
            />
            <div
              v-if="maskShown"
              class="absolute border-2 border-violet border-solid bg-[rgba(135,95,154,0.2)] pointer-events-none"
              :style="{
                left: `${maskShown.x * 100}%`,
                top: `${maskShown.y * 100}%`,
                width: `${maskShown.w * 100}%`,
                height: `${maskShown.h * 100}%`,
              }"
            />
          </div>
          <div v-else class="px-8px py-6px rounded-4px bg-surface2 text-placeholder text-11px">
            请先连一张输入图片（或在上方指定上游图片），再框选区域
          </div>
          <label :class="LABEL" class="mt-8px" for="canvas-console-mask">重绘要求</label>
          <n-input
            v-model:value="toolNode.maskPrompt"
            type="textarea"
            class="nodrag nowheel"
            placeholder="要修改什么，例如：把背景换成海边"
            :maxlength="3000"
            :autosize="{ minRows: 3, maxRows: 6 }"
            :input-props="{ id: 'canvas-console-mask' }"
          />
        </template>
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
              :key="url + index"
              type="button"
              class="relative shrink-0 w-48px h-48px p-0 overflow-hidden border border-solid border-line rounded-4px bg-surface2 cursor-pointer hover:border-violet-line"
              :class="[
                FOCUS_RING,
                { '!border-violet shadow-[0_0_0_2px_rgba(135,95,154,0.18)]': selectedIdx === index },
              ]"
              :aria-pressed="selectedIdx === index"
              :aria-label="`候选 ${index + 1}，设为输出`"
              @click="onSelectCandidate(index)"
            >
              <img :src="url" :alt="`候选 ${index + 1}`" draggable="false" class="block w-full h-full object-cover" />
            </button>
          </div>
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
        class="shrink-0 h-28px ml-auto px-12px border border-solid border-control rounded-4px bg-gradient-to-b from-white to-#fbfcfc text-ink-2 text-13px cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(31,35,41,0.05)] hover:border-control-hover hover:text-ink"
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
