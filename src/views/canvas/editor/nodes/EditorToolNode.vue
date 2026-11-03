<script setup lang="ts">
/**
 * 工具节点：crop / upscale / outpaint / i2p / mask / tryon。
 * 输入：image 口（tryon 为 garment / models 口）；输出：i2p 是 text（反推文本），
 * 其余是 image-out。工具参数在右侧参数面板维护，这里显示摘要与运行结果。
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import RunErrorNotice from '../RunErrorNotice.vue'
import { toolLabel } from '../graph.ts'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { portClass, portLabelClass } from '../ports.ts'
import {
  CANVAS_OK,
  NODE_CARD,
  NODE_CARD_SELECTED,
  NODE_HEAD_PLAIN,
  NODE_NOTICE,
  NODE_RUN_BTN,
  NODE_TITLE,
  type IQuickAddRequest,
} from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; quickAdd: [request: IQuickAddRequest] }>()

const store = useCanvasEditor()

const isRunning = computed(() => props.data.status === 'running' || props.data.status === 'queued')
const isI2p = computed(() => props.data.tool === 'i2p')
const isTryon = computed(() => props.data.tool === 'tryon')
/** catalog 里 ready=false 的工具：灰显并禁止执行（目录未加载时不拦） */
const notReady = computed(() => store.catalog.value?.tools?.find((t) => t.tool === props.data.tool)?.ready === false)
/** 原型 useNodeResize 默认 340 宽 */
const width = computed(() => props.data.width ?? 340)

const resultImage = computed(() => props.data.resultImage ?? props.data.image)
const resultText = computed(() => props.data.resultText ?? '')

const summary = computed(() => {
  const tool = props.data.tool
  if (tool === 'crop') {
    const crop = props.data.crop
    return crop ? `裁剪 ${Math.round(crop.w * 100)}×${Math.round(crop.h * 100)}%` : '未设置裁剪区域'
  }
  if (tool === 'upscale') return `${props.data.scale ?? 2}x 放大`
  if (tool === 'outpaint') return `扩图 ${props.data.ratio ?? ''}`
  if (tool === 'i2p') return `反推（${props.data.language === 'en' ? '英' : '中'}）`
  if (tool === 'mask')
    return (props.data.maskPrompt ?? '').trim()
      ? props.data.maskBox
        ? '已框选区域并填写要求'
        : '待框选重绘区域'
      : '待填重绘要求'
  if (tool === 'tryon') return '模特试穿'
  return ''
})
</script>

<template>
  <div
    :class="[NODE_CARD, { 'is-selected': selected, 'opacity-55': notReady, [NODE_CARD_SELECTED]: selected }]"
    :style="{ width: `${width}px`, minHeight: data.height ? `${data.height}px` : undefined }"
  >
    <header :class="NODE_HEAD_PLAIN">
      <span class="shrink-0 w-9px h-9px rounded-full bg-violet" />
      <span class="flex-1" :class="NODE_TITLE">{{ data.title || toolLabel(data.tool) }}</span>
      <div class="flex shrink-0 items-center gap-2px">
        <button
          type="button"
          :class="NODE_RUN_BTN"
          :disabled="notReady && !isRunning"
          :title="notReady && !isRunning ? '该功能暂未开放' : isRunning ? '取消执行' : '执行此工具'"
          :aria-label="isRunning ? `取消执行 ${data.title}` : `执行 ${data.title}`"
          @click.stop="isRunning ? store.cancelRun(id) : store.runNode(id)"
        >
          <EditorIcon :name="isRunning ? 'stop' : 'play'" :size="13" />
        </button>
        <NodeMenu
          :title="data.title || toolLabel(data.tool)"
          :image-actions-for="isI2p ? undefined : id"
          @remove="emit('remove')"
        />
      </div>
    </header>

    <!-- 原型 .wf-tool-node__body：内边距 0 12 12、gap 8 -->
    <div class="flex flex-col gap-8px px-12px pb-12px">
      <div class="m-0 text-[#7f7f7f] text-12px">{{ summary }}</div>

      <div
        v-if="isI2p && resultText"
        class="max-h-136px overflow-auto px-9px py-7px border border-solid border-[#e3e6ee] rounded-6px bg-[#f7f8fb] text-ink-2 text-11px leading-[1.55] whitespace-pre-wrap break-all nodrag nowheel"
      >
        {{ resultText }}
      </div>
      <div
        v-else-if="resultImage"
        class="grid w-full place-items-center overflow-hidden min-h-110px border border-solid border-[#e9ecf2] rounded-6px bg-[#f4f6fa]"
      >
        <img :src="resultImage" :alt="data.title" draggable="false" class="block w-full max-h-240px object-contain" />
      </div>
      <div
        v-else
        class="flex flex-col items-center gap-6px justify-center min-h-80px border border-dashed border-[#d9d9d9] rounded-6px text-[#9d9d9d] text-12px"
      >
        <EditorIcon name="tool" :size="20" />
        <span>{{ isRunning ? '处理中…' : '连一条图片输入后执行' }}</span>
      </div>

      <div v-if="isRunning" class="h-3px overflow-hidden rounded-999px bg-violet-soft-2">
        <i
          class="block h-full rounded-999px bg-gradient-to-b from-violet-top to-violet-bottom transition-[width] duration-400"
          :style="{ width: `${data.progress ?? 0}%` }"
        />
      </div>
      <div
        v-if="isRunning"
        :class="NODE_NOTICE"
        class="!mt-0 border border-solid border-line-soft bg-surface2 text-muted"
      >
        {{ data.status === 'queued' ? '排队中…' : `处理中 ${data.progress ?? 0}%` }}
      </div>
      <RunErrorNotice v-else-if="data.status === 'error'" class="!mt-0" :node-id="id" :data="data" />
      <div v-else-if="data.status === 'done'" :class="[NODE_NOTICE, CANVAS_OK]" class="!mt-0 border border-solid">
        已完成
      </div>
    </div>

    <template v-if="isTryon">
      <span :class="portLabelClass('garment')" :style="{ top: '34%' }">服装</span>
      <Handle
        id="garment"
        type="target"
        :position="Position.Left"
        :class="portClass('garment')"
        :style="{ top: '34%' }"
      />
      <span :class="portLabelClass('models')" :style="{ top: '62%' }">模特</span>
      <Handle
        id="models"
        type="target"
        :position="Position.Left"
        :class="portClass('models')"
        :style="{ top: '62%' }"
      />
    </template>
    <template v-else>
      <span :class="portLabelClass('image')" :style="{ top: '50%' }">图片</span>
      <Handle id="image" type="target" :position="Position.Left" :class="portClass('image')" :style="{ top: '50%' }" />
    </template>

    <Handle
      :id="isI2p ? 'text' : 'image-out'"
      type="source"
      :position="Position.Right"
      :class="portClass(isI2p ? 'text' : 'out')"
    />
    <NodeQuickAdd
      :kinds="isI2p ? ['image-model', 'video-model'] : ['image-model', 'video-model', 'tool']"
      @open="emit('quickAdd', $event)"
    />
    <NodeResize :id="id" kind="tool" :title="data.title || toolLabel(data.tool)" />
  </div>
</template>
