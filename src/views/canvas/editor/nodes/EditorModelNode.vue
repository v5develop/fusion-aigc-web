<script setup lang="ts">
/**
 * 生成节点（图片 / 视频）：参数摘要 + 运行态结果区。
 * 端口：prompt（1 条，新线替换旧线）+ image（视频模型为 image1/image2 首尾帧）；
 * 输出 image-out；候选通过参数面板 / 缩略图选择（select-candidate 写回服务端）。
 */
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import RunErrorNotice from '../RunErrorNotice.vue'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass, portLabelClass } from '../ports.ts'
import { normalizeHandle } from '../graph.ts'
import {
  CHECKER_BG,
  FOCUS_RING,
  NODE_BADGE,
  NODE_CARD,
  NODE_CARD_SELECTED,
  NODE_HEAD,
  NODE_ICON_BTN,
  NODE_RUN_BTN,
  NODE_TITLE,
  PORT_COUNT,
  type QuickAddKind,
} from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; quickAdd: [kind: QuickAddKind] }>()

const store = useCanvasEditor()

const isVideo = computed(() => props.data.kind === 'video')
const isRunning = computed(() => props.data.status === 'running' || props.data.status === 'queued')
const width = computed(() => props.data.width ?? (isVideo.value ? 338 : 318))
const candidates = computed(() => props.data.candidates ?? [])
const selectedIdx = computed(() => props.data.selectedCandidate ?? 0)

/** 头部副标题：模型名（与标题相同时不重复，同原型） */
const modelLine = computed(() => (props.data.model && props.data.model !== props.data.title ? props.data.model : ''))

/** 参考图计数徽标：连到 image 口的线数（原型 .wf-model-node__ref-count） */
const imageRefCount = computed(
  () =>
    store.edges.value.filter((edge) => edge.target === props.id && normalizeHandle(edge.targetHandle) === 'image')
      .length,
)

/**
 * 结果区高度（原型默认 318×364 / 视频 338×350，结果区 = 节点高 − 头 36 − 内边距 18；
 * 出图后按原图比例，媒体高度上限 540）。只做本地显示计算，不写回快照。
 */
const naturalRatio = ref(0)
const mediaHeight = computed(() => {
  const inner = width.value - 20
  if ((props.data.image || props.data.video) && naturalRatio.value > 0) {
    return Math.round(Math.min(540, Math.max(120, inner / naturalRatio.value)))
  }
  return Math.max(120, (props.data.height ?? (isVideo.value ? 350 : 364)) - 36 - 18)
})

function onMediaLoad(event: Event) {
  const el = event.target as HTMLImageElement | HTMLVideoElement
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
  if (w && h) naturalRatio.value = w / h
}

const partial = computed(() => {
  const requested = props.data.requestedCount ?? 0
  return requested > 1 && candidates.value.length > 0 && candidates.value.length < requested
})

function onSelectCandidate(index: number) {
  void store.selectCandidate(props.id, index)
}
</script>

<template>
  <div
    :class="[NODE_CARD, { 'is-selected': selected, [NODE_CARD_SELECTED]: selected }]"
    :style="{ width: `${width}px` }"
  >
    <header :class="NODE_HEAD">
      <span class="shrink-0 w-8px h-8px rounded-full" :class="isVideo ? 'bg-danger' : 'bg-success'" />
      <div class="flex flex-1 min-w-0 flex-col leading-[1.15]">
        <span :class="NODE_TITLE">{{ data.title || '生成节点' }}</span>
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
          :title="isRunning ? '取消执行' : '执行此节点'"
          :aria-label="isRunning ? `取消执行 ${data.title}` : `执行 ${data.title}`"
          @click.stop="isRunning ? store.cancelRun(id) : store.runNode(id)"
        >
          <EditorIcon :name="isRunning ? 'stop' : 'play'" :size="13" />
        </button>
        <button
          type="button"
          :class="NODE_ICON_BTN"
          title="设置"
          :aria-label="`${data.title} 参数设置`"
          @click.stop="store.selectNode(id)"
        >
          <EditorIcon name="settings" :size="14" />
        </button>
        <NodeMenu :title="data.title || '生成节点'" @remove="emit('remove')" />
      </div>
    </header>

    <div class="px-10px pt-8px pb-10px">
      <div v-if="data.inputOnly" class="mb-6px text-warning text-11px">参考素材 · 不执行</div>

      <div
        class="relative grid w-full place-items-center overflow-hidden rounded-6px"
        :class="CHECKER_BG"
        :style="{ height: `${mediaHeight}px` }"
      >
        <video
          v-if="isVideo && data.video"
          :src="data.video"
          controls
          preload="metadata"
          class="block w-full h-full rounded-6px bg-black object-contain nodrag nowheel"
          @loadedmetadata="onMediaLoad"
        />
        <img
          v-else-if="data.image"
          :src="data.image"
          :alt="data.title"
          draggable="false"
          class="block w-full h-full object-contain"
          @load="onMediaLoad"
        />
        <div v-else class="flex flex-col items-center justify-center gap-8px text-placeholder text-11px">
          <span class="grid w-40px h-40px place-items-center border border-solid border-line rounded-full text-ink-2">
            <EditorIcon :name="isVideo ? 'video' : 'play'" :size="18" />
          </span>
          <span>{{ isRunning ? '等待生成…' : '尚无结果' }}</span>
        </div>
      </div>

      <div
        v-if="isRunning"
        class="flex items-center gap-6px mt-6px px-8px py-5px border border-solid border-line-soft rounded-4px bg-surface2 text-muted text-11px"
      >
        <span
          class="shrink-0 w-12px h-12px border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin"
        />
        {{ data.status === 'queued' ? '排队中…' : `生成中…${data.progress ? ` ${data.progress}%` : ''}` }}
      </div>
      <RunErrorNotice v-else-if="data.status === 'error'" :node-id="id" :data="data" />
      <div
        v-else-if="partial"
        class="flex items-center gap-6px mt-6px px-8px py-5px border border-solid border-success-line rounded-4px text-11px bg-success-soft text-success"
      >
        成功 {{ candidates.length }}/{{ data.requestedCount }} · 只计成功张数
      </div>

      <div v-if="candidates.length > 1" class="flex gap-6px mt-8px overflow-x-auto nodrag nowheel">
        <button
          v-for="(url, index) in candidates"
          :key="url + index"
          type="button"
          class="relative shrink-0 w-44px h-44px overflow-hidden border border-solid border-line rounded-4px p-0 bg-surface2 cursor-pointer"
          :class="[FOCUS_RING, { '!border-violet shadow-[0_0_0_1px_#875f9a]': selectedIdx === index }]"
          :title="`候选 ${index + 1}，点击设为输出`"
          :aria-label="`候选 ${index + 1}，设为输出`"
          :aria-pressed="selectedIdx === index"
          @click.stop="onSelectCandidate(index)"
        >
          <img :src="url" :alt="`候选 ${index + 1}`" draggable="false" class="block w-full h-full object-cover" />
        </button>
      </div>
    </div>

    <span :class="portLabelClass('prompt')" :style="{ top: '26%' }">提示词</span>
    <Handle id="prompt" type="target" :position="Position.Left" :class="portClass('prompt')" :style="{ top: '26%' }" />

    <template v-if="isVideo">
      <span :class="portLabelClass('image')" :style="{ top: '42%' }">首帧</span>
      <Handle id="image1" type="target" :position="Position.Left" :class="portClass('image')" :style="{ top: '42%' }" />
      <span :class="portLabelClass('image')" :style="{ top: '56%' }">尾帧</span>
      <Handle id="image2" type="target" :position="Position.Left" :class="portClass('image')" :style="{ top: '56%' }" />
      <!-- 参考图 / 参考视频口（契约 4.2 元素替换模板、6.1 规则表）：缺了这两个口，模板里的连线渲染不出来 -->
      <span :class="portLabelClass('image')" :style="{ top: '70%' }">参考图</span>
      <Handle id="image" type="target" :position="Position.Left" :class="portClass('image')" :style="{ top: '70%' }" />
      <span :class="portLabelClass('video')" :style="{ top: '84%' }">参考视频</span>
      <Handle id="video" type="target" :position="Position.Left" :class="portClass('video')" :style="{ top: '84%' }" />
    </template>
    <template v-else>
      <span :class="portLabelClass('image')" :style="{ top: '62%' }"
        >参考图 · {{ imageRefCount }}{{ data.maxImageRefs ? `/${data.maxImageRefs}` : '' }}</span
      >
      <Handle id="image" type="target" :position="Position.Left" :class="portClass('image')" :style="{ top: '62%' }" />
      <span :class="PORT_COUNT" class="left-12px" :style="{ top: '62%' }" aria-hidden="true">{{ imageRefCount }}</span>
    </template>

    <!-- 参考视频素材节点（inputOnly）在模板里以 sourceHandle=video 连出 -->
    <Handle
      :id="data.inputOnly ? 'video' : 'image-out'"
      type="source"
      :position="Position.Right"
      :class="portClass(data.inputOnly ? 'video' : 'out')"
    />
    <span v-if="!data.inputOnly" :class="PORT_COUNT" class="right-10px" :style="{ top: '50%' }" aria-hidden="true"
      >1</span
    >
    <NodeQuickAdd
      :kinds="data.inputOnly ? ['video-model'] : ['image-model', 'video-model', 'tool']"
      @pick="emit('quickAdd', $event)"
    />
  </div>
</template>
