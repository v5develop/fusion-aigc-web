<script setup lang="ts">
/**
 * 工具节点参数（2026-11-12 原型「表单上卡」：工具卡自带表单，不再有浮动控制台）。
 * 由 EditorToolNode 渲染在卡片里：上游图片 → 各工具自己的参数（裁剪 / 放大 / 扩图 / 反推 / 局部重绘 / 试穿）。
 * 所有字段写回原有的节点 data 字段（crop / scale / ratio / resolution / outWidth / outHeight / language / maskPrompt / maskBox /
 * tryonItems / garmentName / fabric / tryonModel / tryonResolution / tryonAspectRatio），快照与旧数据不变。
 * 控件带 nodrag / nopan / nowheel，按下即选中本节点；排队 / 运行中整体禁用；下拉走 naive 默认 portal（挂 body），不被卡片裁。
 * 裁剪的拖拽框选在节点内（crop 区域通过 preview 插槽放进来），局部重绘的框选预览在这里。
 */
import { computed, ref } from 'vue'
import { normalizeModelTier } from '@/utils/model-label'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasNodeData } from './types.ts'
import { FOCUS_RING } from './ui.ts'

const props = defineProps<{ nodeId: string; data: CanvasNodeData }>()

const store = useCanvasEditor()

const tool = computed(() => props.data.tool ?? 'crop')
const disabled = computed(() => props.data.status === 'running' || props.data.status === 'queued')

/** 小标签：11px muted（读屏也靠它命名） */
const LABEL = 'block mb-2px text-muted text-11px leading-16px'
const SEG_BTN = `h-28px min-w-44px px-10px border border-solid rounded-4px text-12px cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`
const SEG_ON = 'border-violet-line bg-violet-soft text-violet-ink'
const SEG_OFF = 'border-control bg-white text-ink-2 hover:border-violet-line hover:text-violet-ink'

function patch(values: Record<string, unknown>) {
  store.updateNodeData(props.nodeId, values)
}

const catalogTools = computed(() => store.catalog.value?.tools ?? [])

// ---- 上游图片 ----
/** 工具可选的上游图片来源（不含分组框、文字与自身） */
const upstreamOptions = computed(() =>
  store.nodes.value
    .filter((item) => item.id !== props.nodeId && item.type !== 'module' && item.type !== 'text')
    .map((item) => ({ label: item.data.title || item.id, value: item.id })),
)

// ---- 裁剪 ----
const crop = computed(() => props.data.crop ?? { shape: 'rect' as const, x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
function patchCrop(values: Partial<{ shape: 'rect' | 'circle'; x: number; y: number; w: number; h: number }>) {
  patch({ crop: { ...crop.value, ...values } })
}
const cropNumbers = [
  { key: 'x', label: 'X', min: 0 },
  { key: 'y', label: 'Y', min: 0 },
  { key: 'w', label: '宽', min: 0.05 },
  { key: 'h', label: '高', min: 0.05 },
] as const

// ---- 放大 / 扩图 ----
const scaleOptions = computed(() => catalogTools.value.find((item) => item.tool === 'upscale')?.scales ?? [2, 4])
const outpaintRatioOptions = computed(() =>
  (
    catalogTools.value.find((item) => item.tool === 'outpaint')?.ratios ?? [
      '1:1',
      '3:4',
      '4:3',
      '9:16',
      '16:9',
      '2:3',
      '3:2',
    ]
  ).map((value) => ({ label: value, value })),
)
const resolutionOptions = ['1k', '2k', '4k'].map((value) => ({ label: value, value }))
/** 扩图宽高须成对（执行前 toolParamsOf 同口径拦截） */
const outSizeUnpaired = computed(
  () => (props.data.outWidth && !props.data.outHeight) || (!props.data.outWidth && props.data.outHeight),
)

// ---- 试穿 ----
// 传值与 studio 模型档一致（GPT = GPT Image 2.6、GPT25 = GPT Image 2.5，按张计费）；旧节点数据里的旧档位值经 normalizeModelTier 归一
const tryonModelOptions = [
  { label: '通用', value: '通用' },
  { label: 'GPT Image 2.6', value: 'GPT' },
  { label: 'GPT Image 2.5', value: 'GPT25' },
  { label: 'Nano Banana 2.1', value: 'Banana' },
  { label: 'Seedream 5.5', value: 'Seedream' },
]
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
const tryonItems = computed(() => (props.data.tryonItems?.length ? props.data.tryonItems : ['top']))
const tryonItemOptions = computed(() =>
  TRYON_ITEMS.map((item) => {
    const selected = tryonItems.value.includes(item.value)
    const conflict = tryonItems.value.some((s) => TRYON_CONFLICTS[item.value]?.includes(s))
    return { ...item, disabled: !selected && (conflict || tryonItems.value.length >= 3) }
  }),
)
function toggleTryonItem(value: string, checked: boolean) {
  const next = checked ? [...tryonItems.value, value] : tryonItems.value.filter((v) => v !== value)
  if (!next.length) return // 至少保留 1 件
  patch({ tryonItems: next })
}

// ---- 局部重绘：在输入图预览上拖拽框选（比例坐标，不存 dataURL） ----
const maskSourceImage = computed(() => {
  if (tool.value !== 'mask') return ''
  const edge = store.edges.value.find(
    (item) => item.target === props.nodeId && (item.targetHandle ?? 'image') === 'image',
  )
  const source = store.findNode(edge?.source ?? props.data.sourceNodeId ?? '')
  const media = source?.data as { resultImage?: string; image?: string } | undefined
  return media?.resultImage ?? media?.image ?? ''
})
/** 上游产物的现签地址过期：让上游节点换一次签名 */
function onMaskSourceError() {
  const edge = store.edges.value.find(
    (item) => item.target === props.nodeId && (item.targetHandle ?? 'image') === 'image',
  )
  const sourceId = edge?.source ?? props.data.sourceNodeId
  if (sourceId) store.refreshNodeMedia(sourceId)
}
const maskDraft = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let maskStart: { x: number; y: number } | null = null
const maskShown = computed(() => maskDraft.value ?? props.data.maskBox ?? null)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
function maskPoint(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  }
}
function onMaskDown(event: PointerEvent) {
  if (disabled.value || event.button !== 0) return
  store.selectNode(props.nodeId)
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
  if (box && box.w >= 0.02 && box.h >= 0.02) patch({ maskBox: box })
}
</script>

<template>
  <div
    class="flex flex-col gap-8px nodrag nopan nowheel"
    role="group"
    aria-label="工具参数"
    data-node-params
    @pointerdown.stop="store.selectNode(nodeId)"
    @dblclick.stop
  >
    <!-- 上游图片（原型「上游图片」选择；连线优先） -->
    <div v-if="tool !== 'tryon'">
      <span :class="LABEL">上游图片（不连线时指定）</span>
      <n-select
        :value="data.sourceNodeId || null"
        size="small"
        clearable
        :disabled="disabled"
        :options="upstreamOptions"
        placeholder="连线优先；也可在这里选"
        :consistent-menu-width="false"
        @update:value="(value: string | null) => patch({ sourceNodeId: value ?? '' })"
      />
    </div>

    <!-- 裁剪的拖拽框选区域由节点通过插槽放进来 -->
    <slot name="preview" />

    <!-- 裁剪 -->
    <template v-if="tool === 'crop'">
      <div class="flex items-center gap-6px" role="group" aria-label="裁剪形状">
        <button
          type="button"
          :class="[SEG_BTN, (crop.shape ?? 'rect') === 'rect' ? SEG_ON : SEG_OFF]"
          :disabled="disabled"
          :aria-pressed="(crop.shape ?? 'rect') === 'rect'"
          @click="patchCrop({ shape: 'rect' })"
        >
          矩形
        </button>
        <button
          type="button"
          :class="[SEG_BTN, crop.shape === 'circle' ? SEG_ON : SEG_OFF]"
          :disabled="disabled"
          :aria-pressed="crop.shape === 'circle'"
          title="圆形按外接矩形裁剪"
          @click="patchCrop({ shape: 'circle' })"
        >
          圆形
        </button>
      </div>
      <div class="grid grid-cols-4 gap-6px">
        <div v-for="field in cropNumbers" :key="field.key" class="min-w-0">
          <span :class="LABEL">{{ field.label }}</span>
          <n-input-number
            :value="crop[field.key]"
            class="w-full"
            size="small"
            :min="field.min"
            :max="1"
            :step="0.05"
            :show-button="false"
            :disabled="disabled"
            :input-props="{ 'aria-label': `裁剪${field.label}` }"
            @update:value="(value: number | null) => value !== null && patchCrop({ [field.key]: value })"
          />
        </div>
      </div>
    </template>

    <!-- 高清放大 -->
    <div v-else-if="tool === 'upscale'" role="group" aria-label="放大倍数">
      <span :class="LABEL">放大倍数</span>
      <div class="flex items-center gap-6px">
        <button
          v-for="value in scaleOptions"
          :key="value"
          type="button"
          :class="[SEG_BTN, (data.scale ?? 2) === value ? SEG_ON : SEG_OFF]"
          :disabled="disabled"
          :aria-pressed="(data.scale ?? 2) === value"
          @click="patch({ scale: value })"
        >
          {{ value }}x
        </button>
      </div>
    </div>

    <!-- 扩图 -->
    <template v-else-if="tool === 'outpaint'">
      <div class="grid grid-cols-2 gap-8px">
        <div class="min-w-0">
          <span :class="LABEL">目标比例</span>
          <n-select
            :value="data.ratio"
            size="small"
            :disabled="disabled"
            :options="outpaintRatioOptions"
            :consistent-menu-width="false"
            @update:value="(value: string) => patch({ ratio: value })"
          />
        </div>
        <div class="min-w-0">
          <span :class="LABEL">分辨率</span>
          <n-select
            :value="data.resolution || '2k'"
            size="small"
            :disabled="disabled"
            :options="resolutionOptions"
            :consistent-menu-width="false"
            @update:value="(value: string) => patch({ resolution: value })"
          />
        </div>
      </div>
      <div>
        <span :class="LABEL">或指定宽高（像素，须同时填写；填写后忽略比例）</span>
        <div class="flex items-center gap-8px">
          <n-input-number
            :value="data.outWidth ?? null"
            size="small"
            clearable
            :min="1"
            :precision="0"
            :show-button="false"
            :disabled="disabled"
            placeholder="宽"
            :input-props="{ 'aria-label': '扩图宽度' }"
            @update:value="(value: number | null) => patch({ outWidth: value ?? undefined })"
          />
          <span class="text-muted">×</span>
          <n-input-number
            :value="data.outHeight ?? null"
            size="small"
            clearable
            :min="1"
            :precision="0"
            :show-button="false"
            :disabled="disabled"
            placeholder="高"
            :input-props="{ 'aria-label': '扩图高度' }"
            @update:value="(value: number | null) => patch({ outHeight: value ?? undefined })"
          />
        </div>
        <div v-if="outSizeUnpaired" class="mt-4px text-danger text-11px" role="alert">宽高须成对填写</div>
      </div>
    </template>

    <!-- 反推 -->
    <div v-else-if="tool === 'i2p'" role="group" aria-label="输出语言">
      <span :class="LABEL">输出语言</span>
      <div class="flex items-center gap-6px">
        <button
          type="button"
          :class="[SEG_BTN, data.language !== 'en' ? SEG_ON : SEG_OFF]"
          :disabled="disabled"
          :aria-pressed="data.language !== 'en'"
          @click="patch({ language: 'zh' })"
        >
          中文
        </button>
        <button
          type="button"
          :class="[SEG_BTN, data.language === 'en' ? SEG_ON : SEG_OFF]"
          :disabled="disabled"
          :aria-pressed="data.language === 'en'"
          @click="patch({ language: 'en' })"
        >
          英文
        </button>
      </div>
    </div>

    <!-- 局部重绘 -->
    <template v-else-if="tool === 'mask'">
      <div>
        <div class="flex items-center justify-between">
          <span :class="LABEL">重绘区域（在图上拖拽框选）</span>
          <button
            v-if="data.maskBox"
            type="button"
            class="mb-2px p-0 border-0 bg-transparent text-violet-ink text-11px cursor-pointer hover:text-violet-press disabled:opacity-50"
            :class="FOCUS_RING"
            :disabled="disabled"
            @click="patch({ maskBox: undefined })"
          >
            清除
          </button>
        </div>
        <div v-if="maskSourceImage" class="flex justify-center px-6px py-6px rounded-6px bg-surface2">
          <div
            class="relative inline-block max-w-full cursor-crosshair select-none touch-none"
            @pointerdown="onMaskDown"
            @pointermove="onMaskMove"
            @pointerup="onMaskUp"
            @pointercancel="onMaskUp"
          >
            <img
              :src="maskSourceImage"
              alt="重绘输入图"
              draggable="false"
              class="block max-w-full max-h-200px pointer-events-none"
              @error="onMaskSourceError"
            />
            <div
              v-if="maskShown"
              class="absolute border-2 border-violet border-solid bg-violet/20 pointer-events-none"
              :style="{
                left: `${maskShown.x * 100}%`,
                top: `${maskShown.y * 100}%`,
                width: `${maskShown.w * 100}%`,
                height: `${maskShown.h * 100}%`,
              }"
            />
          </div>
        </div>
        <div v-else class="px-8px py-6px rounded-4px bg-surface2 text-placeholder text-11px">
          请先连一张输入图片（或在上方指定上游图片），再框选区域
        </div>
      </div>
      <div>
        <label :class="LABEL" :for="`tool-mask-${nodeId}`">重绘要求</label>
        <n-input
          :value="data.maskPrompt ?? ''"
          type="textarea"
          placeholder="要修改什么，例如：把背景换成海边"
          :maxlength="3000"
          :disabled="disabled"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :input-props="{ id: `tool-mask-${nodeId}` }"
          @update:value="(value: string) => patch({ maskPrompt: value })"
        />
      </div>
    </template>

    <!-- 试穿（服装 / 模特槽在 TryonSlots） -->
    <template v-else-if="tool === 'tryon'">
      <div>
        <span :class="LABEL">单品（1–3 件）</span>
        <div class="flex flex-wrap gap-x-12px gap-y-6px">
          <n-checkbox
            v-for="opt in tryonItemOptions"
            :key="opt.value"
            :checked="tryonItems.includes(opt.value)"
            :disabled="disabled || opt.disabled"
            @update:checked="(value: boolean) => toggleTryonItem(opt.value, value)"
          >
            {{ opt.label }}
          </n-checkbox>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-8px">
        <div class="min-w-0">
          <span :class="LABEL">服装名称（可选）</span>
          <n-input
            :value="data.garmentName ?? ''"
            size="small"
            maxlength="50"
            :disabled="disabled"
            :input-props="{ 'aria-label': '服装名称' }"
            @update:value="(value: string) => patch({ garmentName: value })"
          />
        </div>
        <div class="min-w-0">
          <span :class="LABEL">面料（可选）</span>
          <n-input
            :value="data.fabric ?? ''"
            size="small"
            maxlength="50"
            :disabled="disabled"
            :input-props="{ 'aria-label': '面料' }"
            @update:value="(value: string) => patch({ fabric: value })"
          />
        </div>
      </div>
      <div class="grid grid-cols-3 gap-8px">
        <div class="min-w-0">
          <span :class="LABEL">模型</span>
          <n-select
            :value="normalizeModelTier(data.tryonModel) || '通用'"
            size="small"
            :disabled="disabled"
            :options="tryonModelOptions"
            :consistent-menu-width="false"
            @update:value="(value: string) => patch({ tryonModel: value })"
          />
        </div>
        <div class="min-w-0">
          <span :class="LABEL">分辨率</span>
          <n-select
            :value="data.tryonResolution || '1k'"
            size="small"
            :disabled="disabled"
            :options="resolutionOptions"
            :consistent-menu-width="false"
            @update:value="(value: string) => patch({ tryonResolution: value })"
          />
        </div>
        <div class="min-w-0">
          <span :class="LABEL">比例</span>
          <n-select
            :value="data.tryonAspectRatio || '3:4'"
            size="small"
            :disabled="disabled"
            :options="outpaintRatioOptions"
            :consistent-menu-width="false"
            @update:value="(value: string) => patch({ tryonAspectRatio: value })"
          />
        </div>
      </div>
    </template>
  </div>
</template>
