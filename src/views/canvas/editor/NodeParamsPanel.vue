<script setup lang="ts">
/**
 * 右侧参数面板（360 宽）：按节点类型 / catalog 能力动态出表单。
 * 节点参数直接写回节点 data（快照私有字段，camelCase 原样保存）。
 */
import { computed, h, ref } from 'vue'
import type { VNode } from 'vue'
import type { SelectOption } from 'naive-ui'
import EditorIcon from './EditorIcon.vue'
import RunErrorNotice from './RunErrorNotice.vue'
import { toolLabel } from './graph.ts'
import { editorMessage, useCanvasEditor } from './useCanvasEditor.ts'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import type { ICanvasCatalogTool } from '@/api/canvasHome.ts'
import type { CanvasEditorNode, CanvasToolKind, CanvasNodeData } from './types.ts'

const props = defineProps<{ node: CanvasEditorNode }>()

const store = useCanvasEditor()
const fileRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadKind = ref<'image' | 'video'>('image')

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

function onModelChange(modelId: string) {
  const list = isVideoModel.value ? catalog.value?.video_models : catalog.value?.image_models
  const model = list?.find((item) => item.model_id === modelId)
  if (model) store.changeModel(props.node.id, model)
}

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
  if (!file || uploading.value) return
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
    const url = await canvasUploadMedia(file)
    store.updateNodeData(props.node.id, uploadKind.value === 'video' ? { video: url } : { image: url })
  } catch (error) {
    editorMessage.error(error instanceof Error ? error.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

// ---- 运行 ----
const isRunning = computed(() => props.node.data.status === 'running' || props.node.data.status === 'queued')
const canRun = computed(() => props.node.type === 'model' || props.node.type === 'tool')
const candidates = computed(() => props.node.data.candidates ?? [])

function onSelectCandidate(index: number) {
  void store.selectCandidate(props.node.id, index)
}

function run() {
  void store.runNode(props.node.id)
}

function cancel() {
  void store.cancelRun(props.node.id)
}
</script>

<template>
  <aside class="flex flex-col shrink-0 w-360px border-l border-line bg-white">
    <div class="flex items-center gap-10px px-16px py-12px border-b border-line-soft">
      <span class="shrink-0 px-10px py-3px rounded-999px bg-violet-soft text-violet-ink text-12px font-600">{{
        typeLabel
      }}</span>
      <n-input v-model:value="titleValue" size="small" placeholder="节点标题" maxlength="50" />
    </div>

    <div class="flex-1 overflow-auto px-16px pt-14px pb-24px">
      <!-- 提示词文本节点 -->
      <template v-if="node.type === 'text'">
        <div class="mb-14px">
          <div class="ll-label">提示词正文</div>
          <n-input
            v-model:value="textValue"
            type="textarea"
            class="nodrag nowheel"
            placeholder="输入提示词，或连到生成节点的提示词口"
            :maxlength="3000"
            show-count
            :autosize="{ minRows: 8, maxRows: 18 }"
          />
        </div>
      </template>

      <!-- 图片 / 视频输入节点 -->
      <template v-else-if="isImageInput || isVideoInput">
        <div class="mb-14px">
          <div class="ll-label">{{ isVideoInput ? '视频' : '图片' }}</div>
          <div
            class="grid place-items-center mb-8px overflow-hidden border border-line-soft rounded-8px bg-surface2 min-h-120px empty:hidden [&_img]:block [&_img]:max-w-full [&_img]:max-h-220px [&_img]:object-contain [&_video]:block [&_video]:max-w-full [&_video]:max-h-220px [&_video]:object-contain"
          >
            <video v-if="isVideoInput && inputVideoUrl" :src="inputVideoUrl" controls preload="metadata" />
            <n-image v-else-if="inputImageUrl" :src="inputImageUrl" object-fit="contain" />
            <div v-else class="py-30px text-placeholder text-12px">还没有{{ isVideoInput ? '视频' : '图片' }}</div>
          </div>
          <n-button size="small" :loading="uploading" @click="pickFile(isVideoInput ? 'video' : 'image')">
            {{ hasInputMedia ? '更换' : '上传' }}
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
        <div class="mb-14px">
          <div class="ll-label">模型</div>
          <n-select
            :value="modelNode.modelId || modelNode.model || ''"
            size="small"
            :options="modelOptions"
            :placeholder="modelOptions.length ? '选择模型' : '目录加载中…'"
            @update:value="onModelChange"
          />
        </div>
        <div class="grid grid-cols-2 gap-10px">
          <div class="mb-14px">
            <div class="ll-label">比例</div>
            <n-select v-model:value="modelNode.ratio" size="small" :options="ratioOptions" />
          </div>
          <div class="mb-14px">
            <div class="ll-label">分辨率</div>
            <n-select v-model:value="modelNode.size" size="small" :options="sizeOptions" />
          </div>
        </div>
        <div v-if="capabilities.quality" class="mb-14px">
          <div class="ll-label">质量</div>
          <n-select v-model:value="modelNode.quality" size="small" :options="qualityOptions" />
        </div>
        <div class="grid grid-cols-2 gap-10px">
          <div v-if="capabilities.count" class="mb-14px">
            <div class="ll-label">张数（≤{{ countMax }}）</div>
            <n-input-number v-model:value="modelNode.count" size="small" :min="1" :max="countMax" style="width: 100%" />
          </div>
          <div v-if="capabilities.duration" class="mb-14px">
            <div class="ll-label">时长</div>
            <n-select v-model:value="modelNode.duration" size="small" :options="durationOptions" />
          </div>
        </div>
        <div v-if="capabilities.sound" class="mb-14px">
          <div class="ll-label">声音</div>
          <n-switch v-model:value="modelNode.sound" size="small" />
        </div>
        <div class="mb-14px">
          <div class="ll-label">
            提示词
            <span v-if="priceHint" class="text-warning text-11px font-400">{{ priceHint }}</span>
          </div>
          <n-input
            v-model:value="modelNode.prompt"
            type="textarea"
            class="nodrag nowheel"
            placeholder="留空则使用连线文字节点的文本"
            :maxlength="3000"
            show-count
            :autosize="{ minRows: 4, maxRows: 12 }"
          />
        </div>
        <div class="mb-14px">
          <div class="ll-label">参考图上限</div>
          <div class="text-ink-2 text-12px">
            {{ modelNode.maxImageRefs ?? 5 }} 张 · 参考视频 {{ currentModel?.max_reference_videos ?? 0 }} 个
          </div>
        </div>
      </template>

      <!-- 工具节点 -->
      <template v-else-if="toolNode">
        <div class="mb-14px">
          <div class="ll-label">工具</div>
          <n-select
            :value="toolNode.tool ?? 'crop'"
            size="small"
            :options="toolOptions"
            :render-option="renderToolOption"
            @update:value="onToolChange"
          />
        </div>
        <div v-if="toolNode.tool !== 'tryon'" class="mb-14px">
          <div class="ll-label">上游图片（不连线时指定）</div>
          <n-select
            v-model:value="toolNode.sourceNodeId"
            size="small"
            clearable
            :options="upstreamOptions"
            placeholder="连线优先；也可在这里选"
          />
          <div
            v-if="upstreamImage"
            class="grid place-items-center mt-8px mb-8px overflow-hidden border border-line-soft rounded-8px bg-surface2 empty:hidden [&_img]:block [&_img]:max-w-full [&_img]:max-h-120px [&_img]:object-contain"
          >
            <img :src="upstreamImage" alt="" />
          </div>
        </div>
        <template v-if="toolNode.tool === 'crop'">
          <div class="mb-14px">
            <div class="ll-label">形状</div>
            <n-select
              v-model:value="toolNode.crop!.shape"
              size="small"
              :options="[
                { label: '矩形', value: 'rect' },
                { label: '圆形（外接矩形）', value: 'circle' },
              ]"
            />
          </div>
          <div class="grid grid-cols-2 gap-10px">
            <div class="mb-14px">
              <div class="ll-label">X</div>
              <n-input-number
                v-model:value="toolNode.crop!.x"
                size="small"
                :min="0"
                :max="1"
                :step="0.05"
                style="width: 100%"
              />
            </div>
            <div class="mb-14px">
              <div class="ll-label">Y</div>
              <n-input-number
                v-model:value="toolNode.crop!.y"
                size="small"
                :min="0"
                :max="1"
                :step="0.05"
                style="width: 100%"
              />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-10px">
            <div class="mb-14px">
              <div class="ll-label">宽</div>
              <n-input-number
                v-model:value="toolNode.crop!.w"
                size="small"
                :min="0.05"
                :max="1"
                :step="0.05"
                style="width: 100%"
              />
            </div>
            <div class="mb-14px">
              <div class="ll-label">高</div>
              <n-input-number
                v-model:value="toolNode.crop!.h"
                size="small"
                :min="0.05"
                :max="1"
                :step="0.05"
                style="width: 100%"
              />
            </div>
          </div>
        </template>
        <div v-if="toolNode.tool === 'upscale'" class="mb-14px">
          <div class="ll-label">放大倍数</div>
          <n-select
            :value="String(toolNode.scale ?? 2)"
            size="small"
            :options="scaleOptions"
            @update:value="(v: string) => store.updateNodeData(node.id, { scale: Number(v) })"
          />
        </div>
        <div v-if="toolNode.tool === 'outpaint'" class="mb-14px">
          <div class="ll-label">目标比例</div>
          <n-select v-model:value="toolNode.ratio" size="small" :options="outpaintRatioOptions" />
          <div class="ll-label mt-10px">分辨率</div>
          <n-select
            :value="toolNode.resolution || '2k'"
            size="small"
            :options="outpaintResolutionOptions"
            @update:value="(v: string) => store.updateNodeData(node.id, { resolution: v })"
          />
          <div class="ll-label mt-10px">或指定宽高（像素，须同时填写；填写后忽略比例）</div>
          <div class="flex items-center gap-8px">
            <n-input-number
              :value="toolNode.outWidth ?? null"
              size="small"
              clearable
              :min="1"
              :precision="0"
              placeholder="宽"
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
              @update:value="(v: number | null) => store.updateNodeData(node.id, { outHeight: v ?? undefined })"
            />
          </div>
          <div
            v-if="(toolNode.outWidth && !toolNode.outHeight) || (!toolNode.outWidth && toolNode.outHeight)"
            class="mt-4px text-danger text-11px"
          >
            宽高须成对填写
          </div>
        </div>
        <template v-if="toolNode.tool === 'tryon'">
          <div class="mb-14px">
            <div class="ll-label">单品（1–3 件）</div>
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
          <div class="mb-14px">
            <div class="ll-label">服装名称（可选）</div>
            <n-input
              :value="toolNode.garmentName ?? ''"
              size="small"
              maxlength="50"
              @update:value="(v: string) => store.updateNodeData(node.id, { garmentName: v })"
            />
          </div>
          <div class="mb-14px">
            <div class="ll-label">面料（可选）</div>
            <n-input
              :value="toolNode.fabric ?? ''"
              size="small"
              maxlength="50"
              @update:value="(v: string) => store.updateNodeData(node.id, { fabric: v })"
            />
          </div>
          <div class="grid grid-cols-3 gap-10px mb-14px">
            <div>
              <div class="ll-label">模型</div>
              <n-select
                :value="toolNode.tryonModel || '通用'"
                size="small"
                :options="tryonModelOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { tryonModel: v })"
              />
            </div>
            <div>
              <div class="ll-label">分辨率</div>
              <n-select
                :value="toolNode.tryonResolution || '1k'"
                size="small"
                :options="tryonResolutionOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { tryonResolution: v })"
              />
            </div>
            <div>
              <div class="ll-label">比例</div>
              <n-select
                :value="toolNode.tryonAspectRatio || '3:4'"
                size="small"
                :options="outpaintRatioOptions"
                @update:value="(v: string) => store.updateNodeData(node.id, { tryonAspectRatio: v })"
              />
            </div>
          </div>
        </template>
        <div v-if="toolNode.tool === 'i2p'" class="mb-14px">
          <div class="ll-label">输出语言</div>
          <n-select
            v-model:value="toolNode.language"
            size="small"
            :options="[
              { label: '中文', value: 'zh' },
              { label: '英文', value: 'en' },
            ]"
          />
        </div>
        <div v-if="toolNode.tool === 'mask'" class="mb-14px">
          <div class="ll-label flex items-center justify-between">
            <span>重绘区域（在图上拖拽框选）</span>
            <button
              v-if="toolNode.maskBox"
              type="button"
              class="p-0 border-0 bg-transparent text-violet-ink text-11px cursor-pointer"
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
              class="block max-w-full max-h-240px pointer-events-none"
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
          <div v-else class="px-8px py-6px rounded-6px bg-surface2 text-placeholder text-11px">
            请先连一张输入图片（或在上方指定上游图片），再框选区域
          </div>
        </div>
        <div v-if="toolNode.tool === 'mask'" class="mb-14px">
          <div class="ll-label">重绘要求</div>
          <n-input
            v-model:value="toolNode.maskPrompt"
            type="textarea"
            class="nodrag nowheel"
            placeholder="要修改什么，例如：把背景换成海边"
            :maxlength="3000"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </div>
      </template>

      <!-- 运行区 -->
      <template v-if="canRun">
        <div class="mb-14px">
          <div class="ll-label">执行</div>
          <div class="flex gap-8px">
            <button v-if="!isRunning" type="button" class="ll-btn-primary flex-1 px-0 py-8px !text-13px" @click="run">
              <EditorIcon name="play" :size="14" />
              执行此节点
            </button>
            <n-button v-else size="small" @click="cancel">取消执行</n-button>
          </div>
          <div v-if="isRunning" class="mt-8px px-8px py-5px rounded-6px bg-violet-soft text-violet-ink text-11px">
            {{ node.data.status === 'queued' ? '排队中…' : `生成中 ${node.data.progress ?? 0}%` }}
          </div>
          <RunErrorNotice v-else-if="node.data.status === 'error'" :node-id="node.id" :data="node.data" />
        </div>
        <div v-if="candidates.length" class="mb-14px">
          <div class="ll-label">候选（点击设为输出）</div>
          <div class="flex flex-wrap gap-8px">
            <button
              v-for="(url, index) in candidates"
              :key="url + index"
              type="button"
              class="w-56px h-56px"
              @click="onSelectCandidate(index)"
            >
              <img :src="url" :alt="`候选 ${index + 1}`" />
            </button>
          </div>
        </div>
        <div v-if="(node.data as { resultText?: string }).resultText" class="mb-14px">
          <div class="ll-label">反推结果</div>
          <div
            class="px-10px py-8px border border-line-soft rounded-8px bg-surface2 text-ink text-12px leading-18px whitespace-pre-wrap break-all max-h-180px overflow-auto"
          >
            {{ (node.data as { resultText?: string }).resultText }}
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>
