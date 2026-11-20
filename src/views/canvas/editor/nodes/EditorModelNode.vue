<script setup lang="ts">
/**
 * 生成节点（图片 / 视频）：参数摘要 + 运行态结果区。
 * 端口：prompt（1 条，新线替换旧线）+ image（视频模型为 image1/image2 首尾帧）；
 * 输出 image-out（= 当前选中的候选）；图片模型多候选时每张候选另有 candidate-N 输出口
 * （0 起编号 +1；graph.buildReferences 带 candidate_index，服务端按上游最近一次成功 run 的第 N 张取图）。
 * 结果图是按钮：点开灯箱看全部候选（灯箱里可下载）；候选缩略图悬停出 主 / 大 / ↓ / ×。
 */
import { computed, inject, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { modelLabelOf } from '@/utils/model-label'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import RunErrorNotice from '../RunErrorNotice.vue'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { PORT_UNWIRED, portClass, portLabelClass } from '../ports.ts'
import { normalizeHandle } from '../graph.ts'
import {
  CHECKER_BG,
  FOCUS_RING,
  NODE_BADGE,
  NODE_CARD,
  NODE_CARD_SELECTED,
  NODE_HEAD,
  NODE_HEAD_H,
  NODE_MENU_HOST,
  NODE_NOTICE,
  NODE_RUN_BTN,
  NODE_TITLE,
  PORT_COUNT,
  PORT_COUNT_VIDEO,
  type IQuickAddRequest,
} from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeDeleteBtn from '../NodeDeleteBtn.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'
import ModelParamFields from '../ModelParamFields.vue'
import NodeLightbox from './NodeLightbox.vue'
import { ColorFixPill } from '@/components/ColorFix'
import { openColorFix } from '../color-fix-action.ts'
import LibraryStatusHint from '../LibraryStatusHint.vue'
import { editorMessage } from '../useCanvasEditor.ts'
import { useNodeEstimate } from '../useNodeEstimate.ts'
import { canvasThumb } from '../thumbs.ts'
import { thumbFallback } from '@/utils/oss'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; quickAdd: [request: IQuickAddRequest] }>()

const store = useCanvasEditor()

/** 候选操作钮：视觉 22（原型 .wf-model-node__candidate-actions button），::after 外扩 5 → 命中 32 */
const CAND_ACTION =
  'relative grid w-22px h-22px p-0 place-items-center border border-solid border-white/50 rounded-4px bg-white/90 text-ink text-11px font-600 leading-none no-underline cursor-pointer pointer-events-auto hover:bg-white hover:text-violet-ink after:content-empty after:absolute after:-inset-5px'

const isVideo = computed(() => props.data.kind === 'video')
const isRunning = computed(() => props.data.status === 'running' || props.data.status === 'queued')
/** 取消已被拒（已发给模型）：执行钮变为不可点的「生成中」，等结果 */
const cancelLocked = computed(() => isRunning.value && store.isCancelLocked(props.id))
/** 已请求取消、等派发器确认（cancel_state=requested）：同样不可点，文案「取消中…」 */
const cancelPending = computed(() => cancelLocked.value && store.cancelLockOf(props.id) === 'requested')
const width = computed(() => props.data.width ?? (isVideo.value ? 338 : 318))
const candidates = computed(() => props.data.candidates ?? [])
/**
 * 端口纵向位置：按卡片顶端的固定像素锚定（头部 44 + 内边距 8 = 结果区顶端 52px），不再按卡片高度百分比——
 * 卡片随参数行数 / 结果图比例变高变矮时百分比口会漂到参数标签、模型框或结果图上。所有口都落在结果区高度内
 * （结果区最矮 120px → 52~172px），视频模型 5 个输入口的最后一个略超出也只压在卡片边框上，不压正文。
 * 连线锚点由 Vue Flow 量 Handle 的实际位置得出，跟着口走；已有连线按 handle id 关联，不会错位。
 */
const PORT_STEP = 28
/** 输出序号：卡片右外侧、端口右边 10px（端口半径 5 + 间隙） */
const OUT_INDEX = '-right-10px translate-x-full'
/** 主输出序号与「+」快捷添加同位置：悬停 / 选中时淡出让位 */
const OUT_INDEX_YIELD = 'transition-opacity duration-120 group-hover:opacity-0 [.is-selected_&]:opacity-0'
const portTops = computed(() => {
  const first = isVideo.value ? 72 : 76
  const at = (i: number) => `${first + i * PORT_STEP}px`
  return {
    prompt: at(0),
    image1: at(1),
    image2: at(2),
    /** 图片模型：参考图紧跟提示词；视频模型：首帧 / 尾帧之后 */
    image: isVideo.value ? at(3) : at(1),
    video: at(4),
    /** 主输出口与提示词口同高，逐张候选口依次排在下面 */
    out: at(0),
    candidate: (i: number) => at(i + 1),
  }
})
const promptTop = computed(() => portTops.value.prompt)
const selectedIdx = computed(() => props.data.selectedCandidate ?? 0)

/** 头部副标题：模型名（与标题相同时不重复，同原型） */
const modelLine = computed(() =>
  props.data.model && props.data.model !== props.data.title ? modelLabelOf(props.data.model) : '',
)

/** 参考图计数徽标：连到 image 口的线数（原型 .wf-model-node__ref-count） */
const imageRefCount = computed(
  () =>
    store.edges.value.filter((edge) => edge.target === props.id && normalizeHandle(edge.targetHandle) === 'image')
      .length,
)

/**
 * 结果区高度（原型默认 318×364 / 视频 338×350，结果区 = 节点高 − 头 44 − 内边距 18 − 参数行；
 * 出图后按原图比例，媒体高度上限 540）。只做本地显示计算，不写回快照。
 * 参数行（比例 / 分辨率 / 质量 / 数量…）在卡片上，高度现量（图片一行、视频两行），默认高度要把它扣掉，
 * 否则默认空卡会比原型高出一截。用户拖过高度（heightFixed）时不再算：外框 min-height = data.height，
 * 媒体区 flex 撑满剩余空间（见模板），参数行 / 提示条 / 候选条再多也不会把媒体挤出框外。
 */
const naturalRatio = ref(0)
const paramsRef = ref<HTMLElement | null>(null)
const paramsHeight = ref(0)
let paramsObserver: ResizeObserver | null = null
watch(paramsRef, (el) => {
  paramsObserver?.disconnect()
  paramsObserver = null
  if (!el) return
  paramsHeight.value = el.offsetHeight
  if (typeof ResizeObserver === 'undefined') return
  paramsObserver = new ResizeObserver(() => {
    paramsHeight.value = el.offsetHeight
  })
  paramsObserver.observe(el)
})
onBeforeUnmount(() => paramsObserver?.disconnect())

/**
 * 内容最小高度（给 NodeResize 夹紧用）：头 + 内边距 + 媒体区最小 60 + 参数行 / 提示条 / 候选条等其余块（含外边距）+ 外框描边。
 * 拖小时用 max(请求高度, 这个值)，卡片不会停在内容高度上而指针还在空拖（死区）。
 */
const MEDIA_MIN = 60
const headRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
const mediaRef = ref<HTMLElement | null>(null)
const contentMin = ref(0)
let contentObserver: ResizeObserver | null = null
function measureContentMin() {
  const head = headRef.value
  const body = bodyRef.value
  if (!head || !body) return
  const cs = getComputedStyle(body)
  let others = 0
  for (const child of Array.from(body.children) as HTMLElement[]) {
    if (child === mediaRef.value) continue
    const st = getComputedStyle(child)
    others += child.offsetHeight + (parseFloat(st.marginTop) || 0) + (parseFloat(st.marginBottom) || 0)
  }
  contentMin.value = Math.ceil(
    head.offsetHeight + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + others + MEDIA_MIN + 2,
  )
}
const observedKids = new Set<Element>()
/** 观察器只建一次；更新时只对子元素做增删差量，不重建 */
function observeContent() {
  measureContentMin()
  if (typeof ResizeObserver === 'undefined' || !bodyRef.value) return
  if (!contentObserver) contentObserver = new ResizeObserver(measureContentMin)
  const now = new Set<Element>(Array.from(bodyRef.value.children).filter((child) => child !== mediaRef.value))
  for (const old of Array.from(observedKids)) {
    if (!now.has(old)) {
      contentObserver.unobserve(old)
      observedKids.delete(old)
    }
  }
  for (const child of now) {
    if (!observedKids.has(child)) {
      contentObserver.observe(child)
      observedKids.add(child)
    }
  }
}
onMounted(observeContent)
onUpdated(observeContent)
onBeforeUnmount(() => contentObserver?.disconnect())

const fixedHeight = computed(() => Boolean(props.data.heightFixed && props.data.height))
/** 参数行占高（含与媒体区的 8px 间距）；参考素材节点（inputOnly）没有参数行 */
const paramsExtra = computed(() => (props.data.inputOnly ? 0 : paramsHeight.value + 8))
const mediaHeight = computed(() => {
  const inner = width.value - 20
  if ((props.data.image || props.data.video) && naturalRatio.value > 0) {
    return Math.round(Math.min(540, Math.max(120, inner / naturalRatio.value)))
  }
  return Math.max(120, (props.data.height ?? (isVideo.value ? 350 : 364)) - NODE_HEAD_H - 18 - paramsExtra.value)
})

function onMediaLoad(event: Event) {
  const el = event.target as HTMLImageElement | HTMLVideoElement
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
  if (w && h) naturalRatio.value = w / h
}

/** 已接线的输入口（原文 targetHandle 与归一化后的口名都记上），未接线的口常驻半透明 */
const wired = computed(() => {
  const set = new Set<string>()
  for (const edge of store.edges.value) {
    if (edge.target !== props.id) continue
    if (edge.targetHandle) set.add(edge.targetHandle)
    const normalized = normalizeHandle(edge.targetHandle)
    if (normalized) set.add(normalized)
  }
  return set
})

function portCls(tone: 'prompt' | 'image' | 'video', handle: string) {
  return [portClass(tone), wired.value.has(handle) ? '' : PORT_UNWIRED]
}

const partial = computed(() => {
  const requested = props.data.requestedCount ?? 0
  return requested > 1 && candidates.value.length > 0 && candidates.value.length < requested
})

function onSelectCandidate(index: number) {
  void store.selectCandidate(props.id, index)
}

/** 未被移除的候选（保留原下标：candidate-N 与服务端候选列表按下标对应） */
const visibleCandidates = computed(() => {
  const hidden = store.hiddenCandidatesOf(props.data)
  return candidates.value.map((url, index) => ({ url, index })).filter((item) => !hidden.has(item.index))
})

/** 图片模型才有逐张输出口（视频模型的候选是封面图，不单独引用） */
const perCandidatePorts = computed(() => !isVideo.value && !props.data.inputOnly)

/**
 * candidate-N 输出口：可见候选 > 1 时每张一个；已经从某个口连出去的线即使候选变少也保留口位，
 * 免得 Vue Flow 找不到 Handle 把线丢掉。排在主输出口下方，按固定间距（见 portTops）。
 */
const candidateHandles = computed(() => {
  if (!perCandidatePorts.value) return []
  const indexes = new Set<number>()
  if (visibleCandidates.value.length > 1) for (const item of visibleCandidates.value) indexes.add(item.index)
  for (const edge of store.edges.value) {
    if (edge.source !== props.id) continue
    const match = /^candidate-(\d+)$/.exec(edge.sourceHandle ?? '')
    if (match?.[1]) indexes.add(Number(match[1]) - 1)
  }
  const sorted = [...indexes].sort((a, b) => a - b)
  return sorted.map((index, i) => ({
    index,
    id: `candidate-${index + 1}`,
    top: portTops.value.candidate(i),
  }))
})

// ---- 大图灯箱（结果图 / 候选「大」）：图片模型看全部可见候选，下载在灯箱里 ----
const lightboxShow = ref(false)
const lightboxIndex = ref(0)
const lightboxItems = computed(() => {
  const name = props.data.title || '生成结果'
  if (visibleCandidates.value.length && !isVideo.value) {
    return visibleCandidates.value.map((item) => ({
      url: item.url,
      type: 'image' as const,
      name: `${name}-${item.index + 1}`,
    }))
  }
  return props.data.image ? [{ url: props.data.image, type: 'image' as const, name }] : []
})
/** 结果图盖满卡面：点它放大的同时也要选中卡片（click.stop 会吞掉画布的 node-click） */
function selectThenZoom() {
  store.selectNode(props.id)
  openLightbox()
}
function openLightbox(candidateIndex?: number) {
  const target = candidateIndex ?? selectedIdx.value
  const at = visibleCandidates.value.findIndex((item) => item.index === target)
  lightboxIndex.value = Math.max(0, at)
  lightboxShow.value = true
}

/** 候选下载文件名：节点标题-序号 */
function downloadName(index: number) {
  return `${props.data.title || '候选'}-${index + 1}`
}

function onRemoveCandidate(index: number) {
  void store.removeCandidate(props.id, index)
}

// ---- 点数底栏（原控制台「预计消耗」搬上卡）：估价共用 useNodeEstimate（缓存 + 并发上限，多卡不起请求风暴） ----
const { estimate, loading: estimateLoading } = useNodeEstimate(
  () => props.id,
  () => props.data,
)
/** 本次运行提交时冻结的点数（只有本会话提交、网关计价的 run 才知道；0 = 不知道） */
const runCharge = computed(() => (isRunning.value ? store.runChargeOf(props.id) : 0))
const actualSettle = computed(() => estimate.value.kind === 'actual')
/** 底栏文案：lead = 数字前的词、points = 数字（空 = 无数字）、tag = 右侧短说明、tip = ⓘ 悬停的完整说明 */
const pointsBar = computed(() => {
  if (runCharge.value > 0) {
    return {
      lead: '已预扣',
      points: runCharge.value,
      tag: actualSettle.value ? '按量结算' : '运行中',
      tip: actualSettle.value
        ? '提交时按上限冻结；完成后按实际用量结算，多退少补，失败或取消全额退回'
        : '提交时已冻结；失败或取消全额退回，部分成功只计成功张数',
    }
  }
  const { kind, points } = estimate.value
  if (kind === 'actual') {
    return { lead: '预计最多', points, tag: '按量结算', tip: '按实际用量结算，通常更少；多退少补' }
  }
  if (kind === 'fixed') {
    return {
      lead: '预计',
      points,
      tag: '按张计费',
      tip: '固定价：按生成张数计费，部分成功只计成功张数，失败或取消退回',
    }
  }
  if (kind === 'static') {
    return { lead: '约', points, tag: '估算', tip: '按模型价目估算，以实际扣点为准' }
  }
  return { lead: '暂无报价', points: 0, tag: '', tip: '当前模型 / 参数暂时拿不到报价，以实际扣点为准' }
})

// ---- 标题双击改名（原控制台标题输入框）：交给画布页的「编辑名称」弹窗 ----
const menuHost = inject(NODE_MENU_HOST, null)
function onTitleDblClick() {
  if (menuHost?.rename) menuHost.rename(props.id)
}

/** 现签地址过期（加载失败 / 403）：换一次签名（store 内限流，不会循环） */
function onMediaError() {
  store.refreshNodeMedia(props.id)
}

/** 产物还在转存素材库：校色只认地址，先不给用 */
const colorFixBlocked = computed(() => store.mediaBlockReason(props.id))
function onColorFix(e: MouseEvent) {
  e.stopPropagation()
  if (colorFixBlocked.value) {
    editorMessage.info(colorFixBlocked.value)
    return
  }
  openColorFix(props.id, props.data.image)
}
</script>

<template>
  <div
    :class="[NODE_CARD, 'flex flex-col', { 'is-selected': selected, [NODE_CARD_SELECTED]: selected }]"
    :style="{ width: `${width}px`, minHeight: fixedHeight ? `${Math.max(data.height ?? 0, contentMin)}px` : undefined }"
  >
    <NodeDeleteBtn :title="data.title || '生成节点'" :hidden="isRunning || !!data.locked" @remove="emit('remove')" />
    <header ref="headRef" :class="NODE_HEAD">
      <span class="shrink-0 w-8px h-8px rounded-full" :class="isVideo ? 'bg-danger' : 'bg-success'" />
      <div class="flex flex-1 min-w-0 flex-col leading-[1.15]">
        <span :class="NODE_TITLE" :title="menuHost?.rename ? '双击改名' : undefined" @dblclick.stop="onTitleDblClick">{{
          data.title || '生成节点'
        }}</span>
        <small
          v-if="modelLine"
          class="block overflow-hidden text-muted text-11px font-500 leading-14px text-ellipsis whitespace-nowrap"
          >{{ modelLine }}</small
        >
      </div>
      <span v-if="data.badge" :class="NODE_BADGE">{{ data.badge }}</span>
      <div class="flex shrink-0 items-center gap-2px">
        <button
          type="button"
          :class="NODE_RUN_BTN"
          :disabled="cancelLocked"
          :title="
            cancelPending
              ? '取消中…'
              : cancelLocked
                ? '生成中：已发给模型，无法取消'
                : isRunning
                  ? '取消执行'
                  : '执行此节点'
          "
          :aria-label="
            cancelPending
              ? `${data.title} 取消中`
              : cancelLocked
                ? `${data.title} 生成中，无法取消`
                : isRunning
                  ? `取消执行 ${data.title}`
                  : `执行 ${data.title}`
          "
          @click.stop="isRunning ? store.cancelRun(id) : store.runNode(id)"
        >
          <span
            v-if="cancelLocked"
            class="w-11px h-11px border-[1.5px] border-solid border-current border-t-transparent rounded-full animate-spin animate-duration-800"
            aria-hidden="true"
          />
          <EditorIcon v-else :name="isRunning ? 'stop' : 'play'" :size="13" />
        </button>
        <NodeMenu
          :title="data.title || '生成节点'"
          :image-actions-for="isVideo || data.inputOnly ? undefined : id"
          @remove="emit('remove')"
        />
      </div>
    </header>

    <div ref="bodyRef" class="flex flex-1 min-h-0 flex-col px-10px pt-8px pb-10px">
      <div v-if="data.inputOnly" class="mb-6px text-warning text-11px">参考素材 · 不执行</div>

      <div
        ref="mediaRef"
        class="canvas-media relative grid w-full place-items-center overflow-hidden rounded-6px"
        :class="[CHECKER_BG, fixedHeight ? 'flex-1 min-h-60px' : 'shrink-0']"
        :style="fixedHeight ? undefined : { height: `${mediaHeight}px` }"
      >
        <video
          v-if="isVideo && data.video"
          :src="data.video"
          controls
          preload="metadata"
          class="absolute inset-0 block w-full h-full rounded-6px bg-black object-contain nodrag nowheel"
          @loadedmetadata="onMediaLoad"
          @error="onMediaError"
        />
        <button
          v-else-if="data.image"
          type="button"
          class="absolute inset-0 block w-full h-full p-0 border-none bg-transparent cursor-zoom-in"
          :class="FOCUS_RING"
          title="点击放大查看"
          :aria-label="`放大查看 ${data.title || '生成结果'}`"
          @click.stop="selectThenZoom()"
        >
          <!-- 卡片只展示缩略图（缩放 + webp）；放大 / 下载 / 校色 / 传给下游仍用 data.image 原图，缩略图失败退回原图 -->
          <img
            :src="canvasThumb(data.image, width - 20)"
            :alt="data.title"
            draggable="false"
            loading="lazy"
            decoding="async"
            class="block w-full h-full object-contain"
            @load="onMediaLoad"
            @error="(e) => thumbFallback(e, data.image) || onMediaError()"
          />
          <!-- 悬停提示条（原型 .wf-model-node__hint）：深色细条 11px；键盘聚焦与触屏常显 -->
          <span
            class="absolute left-0 right-0 bottom-0 py-4px bg-[rgba(31,35,41,0.62)] text-white text-11px leading-16px text-center opacity-0 transition-opacity duration-120 pointer-events-none [:hover>&]:opacity-100 [:focus-visible>&]:opacity-100 [@media(hover:none)]:opacity-100"
            aria-hidden="true"
            >点击放大查看</span
          >
        </button>
        <!-- 校色（图片结果）：与放大按钮是兄弟节点，不嵌套；悬停 / 选中 / 键盘聚焦 / 触屏可见 -->
        <ColorFixPill
          v-if="!isVideo && data.image && !data.inputOnly"
          label="校色"
          :aria-label="`校色：${data.title || '生成结果'}`"
          :aria-disabled="colorFixBlocked ? 'true' : undefined"
          :title="colorFixBlocked || undefined"
          class="absolute top-8px right-8px z-3 nodrag opacity-0 [.canvas-media:hover_&]:opacity-100 [.is-selected_&]:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          :class="colorFixBlocked ? '!cursor-not-allowed !text-muted' : ''"
          @click="onColorFix"
        />
        <div v-else class="flex flex-col items-center justify-center gap-8px text-muted text-11px">
          <span class="grid w-40px h-40px place-items-center border border-solid border-line rounded-full text-ink-2">
            <EditorIcon :name="isVideo ? 'video' : 'play'" :size="18" />
          </span>
          <span>{{ isRunning ? '等待生成…' : '尚无结果' }}</span>
        </div>
      </div>

      <!-- 参数行（参数上卡：控制台不再重复这一块，卡上就是唯一入口） -->
      <!-- 参数行 + 点数底栏：一起量高度（默认卡高不因底栏变高，媒体区让出这一截） -->
      <div v-if="!data.inputOnly" ref="paramsRef" class="shrink-0 mt-8px">
        <ModelParamFields :node-id="id" :data="data" />
        <!-- 点数底栏：固定高度（加载占位同高，卡片不抖）；左边点数，右边短说明 + ⓘ 完整说明 -->
        <div
          class="flex h-20px items-center gap-6px mt-8px pt-8px border-0 border-t border-solid border-line-soft box-content text-muted text-11px leading-20px"
          data-node-points
        >
          <span
            v-if="estimateLoading && runCharge <= 0"
            class="block w-96px h-10px rounded-3px bg-surface3 animate-pulse motion-reduce:animate-none"
            aria-label="正在估算点数"
          />
          <span v-else class="flex min-w-0 items-baseline gap-3px whitespace-nowrap" role="status">
            <span>{{ pointsBar.lead }}</span>
            <template v-if="pointsBar.points">
              <b class="text-violet-ink text-13px font-600 tabular-nums">{{ pointsBar.points }}</b>
              <span>点</span>
            </template>
          </span>
          <span v-if="pointsBar.tag" class="ml-auto shrink-0 whitespace-nowrap">{{ pointsBar.tag }}</span>
          <n-tooltip placement="top" :style="{ maxWidth: '240px' }">
            <template #trigger>
              <button
                type="button"
                class="relative grid shrink-0 w-14px h-14px p-0 place-items-center border-none bg-transparent text-muted cursor-help hover:text-violet-ink after:content-empty after:absolute after:-inset-7px nodrag"
                :class="[FOCUS_RING, !pointsBar.tag && 'ml-auto']"
                aria-label="点数说明"
                @click.stop
              >
                <EditorIcon name="info" :size="14" />
              </button>
            </template>
            {{ pointsBar.tip }}
          </n-tooltip>
        </div>
      </div>

      <div v-if="isRunning" :class="NODE_NOTICE" class="border border-solid border-line-soft bg-surface2 text-muted">
        <span
          class="shrink-0 w-12px h-12px border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-800"
        />
        {{ data.status === 'queued' ? '排队中…' : `生成中…${data.progress ? ` ${data.progress}%` : ''}` }}
      </div>
      <RunErrorNotice v-else-if="data.status === 'error'" :node-id="id" :data="data" />
      <div
        v-else-if="partial"
        class="mt-6px px-8px py-3px rounded-5px bg-warning-soft text-warning text-11px font-500 text-center"
      >
        成功 {{ candidates.length }}/{{ data.requestedCount }} · 只计成功张数
      </div>
      <LibraryStatusHint
        v-if="!isRunning && candidates.length"
        :status="data.libraryStatus"
        :retry="() => store.retryLibrary(id)"
      />

      <!--
        候选缩略图（原型 .wf-model-node__candidate）：缩略图本身点一下设为输出；悬停出 2×2 操作
        主（设为输出）/ 大（看大图）/ ↓（下载）/ ×（移除）。操作钮视觉 22、间距 10，::after 各外扩 5 → 命中 32 互不覆盖；
        触屏（无悬停）与键盘聚焦时常显。操作层与缩略图按钮是兄弟节点，不嵌套交互元素。
      -->
      <div
        v-if="visibleCandidates.length > 1"
        class="flex gap-6px mt-8px overflow-x-auto nodrag nowheel"
        role="list"
        aria-label="候选结果"
      >
        <div
          v-for="item in visibleCandidates"
          :key="item.url + item.index"
          class="canvas-cand relative shrink-0 w-64px h-64px overflow-hidden border border-solid border-line rounded-4px bg-surface2"
          :class="{ '!border-violet shadow-[0_0_0_1px_var(--xq-violet)]': selectedIdx === item.index }"
          role="listitem"
        >
          <button
            type="button"
            class="block w-full h-full p-0 border-none bg-transparent cursor-pointer"
            :class="FOCUS_RING"
            :title="`候选 ${item.index + 1}，点击设为输出`"
            :aria-label="`候选 ${item.index + 1}，设为输出`"
            :aria-pressed="selectedIdx === item.index"
            @click.stop="onSelectCandidate(item.index)"
          >
            <img
              :src="canvasThumb(item.url, 64, 64)"
              :alt="`候选 ${item.index + 1}`"
              draggable="false"
              loading="lazy"
              decoding="async"
              class="block w-full h-full object-cover"
              @error="(e) => thumbFallback(e, item.url) || onMediaError()"
            />
          </button>
          <div
            class="absolute inset-0 grid grid-cols-[22px_22px] auto-rows-[22px] gap-10px content-center justify-center bg-[rgba(31,35,41,0.5)] opacity-0 transition-opacity duration-120 pointer-events-none [.canvas-cand:hover_&]:opacity-100 [.canvas-cand:focus-within_&]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <button
              type="button"
              :class="[CAND_ACTION, FOCUS_RING]"
              :title="selectedIdx === item.index ? '当前输出' : '设为输出'"
              :aria-label="`候选 ${item.index + 1} 设为输出`"
              @click.stop="onSelectCandidate(item.index)"
            >
              主
            </button>
            <button
              type="button"
              :class="[CAND_ACTION, FOCUS_RING]"
              title="查看大图"
              :aria-label="`查看候选 ${item.index + 1} 大图`"
              @click.stop="openLightbox(item.index)"
            >
              大
            </button>
            <a
              :href="item.url"
              :download="downloadName(item.index)"
              target="_blank"
              rel="noopener noreferrer"
              :class="[CAND_ACTION, FOCUS_RING]"
              title="下载这张"
              :aria-label="`下载候选 ${item.index + 1}`"
              @click.stop
            >
              ↓
            </a>
            <button
              type="button"
              :class="[CAND_ACTION, FOCUS_RING]"
              class="hover:!bg-danger-soft hover:!text-danger"
              title="移除这张"
              :aria-label="`移除候选 ${item.index + 1}`"
              @click.stop="onRemoveCandidate(item.index)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <span :class="portLabelClass('prompt')" :style="{ top: promptTop }"
      >提示词<span class="ml-2px text-11px">*</span></span
    >
    <Handle
      id="prompt"
      type="target"
      :position="Position.Left"
      :class="portCls('prompt', 'prompt')"
      :style="{ top: promptTop }"
      aria-label="提示词输入"
    />

    <template v-if="isVideo">
      <span :class="portLabelClass('image')" :style="{ top: portTops.image1 }">首帧</span>
      <Handle
        id="image1"
        type="target"
        :position="Position.Left"
        :class="portCls('image', 'image1')"
        :style="{ top: portTops.image1 }"
        aria-label="首帧输入"
      />
      <span :class="portLabelClass('image')" :style="{ top: portTops.image2 }">尾帧</span>
      <Handle
        id="image2"
        type="target"
        :position="Position.Left"
        :class="portCls('image', 'image2')"
        :style="{ top: portTops.image2 }"
        aria-label="尾帧输入"
      />
      <!-- 参考图 / 参考视频口（契约 4.2 元素替换模板、6.1 规则表）：缺了这两个口，模板里的连线渲染不出来 -->
      <span :class="portLabelClass('image')" :style="{ top: portTops.image }">参考图</span>
      <Handle
        id="image"
        type="target"
        :position="Position.Left"
        :class="portCls('image', 'image')"
        :style="{ top: portTops.image }"
        aria-label="参考图输入"
      />
      <span :class="portLabelClass('video')" :style="{ top: portTops.video }">参考视频</span>
      <Handle
        id="video"
        type="target"
        :position="Position.Left"
        :class="portCls('video', 'video')"
        :style="{ top: portTops.video }"
        aria-label="参考视频输入"
      />
    </template>
    <template v-else>
      <span :class="portLabelClass('image')" :style="{ top: portTops.image }"
        >参考图 · {{ imageRefCount }}{{ data.maxImageRefs ? `/${data.maxImageRefs}` : '' }}</span
      >
      <Handle
        id="image"
        type="target"
        :position="Position.Left"
        :class="portCls('image', 'image')"
        :style="{ top: portTops.image }"
        aria-label="参考图输入"
      />
      <!-- 原来卡片内侧还有一个「已接张数」小圆，会压住参数 / 模型框 / 结果图；张数已在外侧标签「参考图 · n/上限」里，去掉 -->
    </template>

    <!-- 参考视频素材节点（inputOnly）在模板里以 sourceHandle=video 连出 -->
    <Handle
      :id="data.inputOnly ? 'video' : 'image-out'"
      type="source"
      :position="Position.Right"
      :class="portClass(data.inputOnly || isVideo ? 'video' : 'out')"
      :style="{ top: portTops.out }"
    />
    <!-- 输出序号放在卡片右外侧（不压结果图）；悬停 / 选中时同位置出「+」快捷添加，序号让位 -->
    <span
      v-if="!data.inputOnly"
      :class="[PORT_COUNT, OUT_INDEX, OUT_INDEX_YIELD, isVideo ? PORT_COUNT_VIDEO : '']"
      :style="{ top: portTops.out }"
      aria-hidden="true"
      >{{ candidateHandles.length ? '主' : '1' }}</span
    >
    <!-- 逐张候选输出口：candidate-N 单独连到下游，不随「主」切换 -->
    <template v-for="port in candidateHandles" :key="port.id">
      <Handle
        :id="port.id"
        type="source"
        :position="Position.Right"
        :class="portClass('out')"
        :style="{ top: port.top }"
        :title="`候选 ${port.index + 1} 单独输出`"
        :aria-label="`候选 ${port.index + 1} 输出`"
      />
      <span :class="[PORT_COUNT, OUT_INDEX]" :style="{ top: port.top }" aria-hidden="true">{{ port.index + 1 }}</span>
    </template>
    <NodeQuickAdd
      :top="portTops.out"
      :kinds="data.inputOnly ? ['video-model'] : ['image-model', 'video-model', 'tool']"
      @open="emit('quickAdd', $event)"
    />
    <NodeResize :id="id" kind="model" :min-content-height="contentMin" :title="data.title || '生成节点'" />
    <NodeLightbox v-model:show="lightboxShow" v-model:index="lightboxIndex" :items="lightboxItems" />
  </div>
</template>
