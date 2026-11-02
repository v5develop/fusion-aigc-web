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

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const store = useCanvasEditor()

const isRunning = computed(() => props.data.status === 'running' || props.data.status === 'queued')
const isI2p = computed(() => props.data.tool === 'i2p')
const isTryon = computed(() => props.data.tool === 'tryon')
/** catalog 里 ready=false 的工具：灰显并禁止执行（目录未加载时不拦） */
const notReady = computed(() => store.catalog.value?.tools?.find((t) => t.tool === props.data.tool)?.ready === false)
const width = computed(() => props.data.width ?? 300)

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
    class="ll-card group relative text-12px text-ink"
    :class="{
      'is-selected': selected,
      'opacity-55': notReady,
      '!border-violet !shadow-[0_0_0_2px_rgba(135,95,154,0.18),0_10px_18px_-10px_rgba(31,35,41,0.22)]': selected,
    }"
    :style="{ width: `${width}px` }"
  >
    <header class="flex h-34px items-center gap-8px pl-12px pr-10px border-b border-line-soft rounded-t-10px">
      <span class="shrink-0 w-8px h-8px rounded-full bg-[#6e7681]" />
      <span class="overflow-hidden flex-1 text-13px font-600 text-ellipsis whitespace-nowrap">{{
        data.title || toolLabel(data.tool)
      }}</span>
      <span class="shrink-0 px-6px py-1px rounded-4px bg-violet-soft text-violet-ink text-10px leading-16px">工具</span>
      <button
        type="button"
        class="grid shrink-0 w-22px h-22px p-0 place-items-center border border-violet-line rounded-6px bg-violet-soft text-violet-ink cursor-pointer hover:border-violet hover:text-violet-press"
        :class="{ '!bg-#ede3f2 !border-violet-line': isRunning, '!cursor-not-allowed': notReady && !isRunning }"
        :disabled="notReady && !isRunning"
        :title="notReady && !isRunning ? '该功能暂未开放' : isRunning ? '取消执行' : '执行此工具'"
        @click.stop="isRunning ? store.cancelRun(id) : store.runNode(id)"
      >
        <EditorIcon :name="isRunning ? 'stop' : 'play'" :size="13" />
      </button>
      <button
        type="button"
        class="absolute -top-9px -right-9px z-3 grid w-20px h-20px p-0 place-items-center border border-line rounded-full bg-white text-muted text-12px leading-none cursor-pointer opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:border-danger-line hover:bg-danger-soft hover:text-danger"
        title="删除节点"
        @click.stop="emit('remove')"
      >
        ×
      </button>
    </header>

    <div class="px-10px pt-8px pb-10px">
      <div class="mb-6px text-ink-2 text-11px">{{ summary }}</div>

      <div
        v-if="isI2p && resultText"
        class="max-h-120px overflow-auto px-10px py-8px border border-line-soft rounded-8px bg-surface2 text-ink text-11px leading-17px whitespace-pre-wrap break-all nodrag nowheel"
      >
        {{ resultText }}
      </div>
      <div
        v-else-if="resultImage"
        class="grid w-full place-items-center overflow-hidden rounded-8px border border-line-soft [background:repeating-conic-gradient(#f3f4f5_0%,#f3f4f5_25%,transparent_0%,transparent_50%)_0_0/14px_14px,#f7f8f9] min-h-110px"
      >
        <img :src="resultImage" :alt="data.title" draggable="false" class="block w-full max-h-240px object-contain" />
      </div>
      <div
        v-else
        class="flex flex-col items-center gap-6px justify-center border border-dashed border-line rounded-8px text-placeholder text-11px bg-surface2 min-h-100px"
      >
        <EditorIcon name="tool" :size="20" />
        <span>{{ isRunning ? '处理中…' : '连一条图片输入后执行' }}</span>
      </div>

      <div v-if="isRunning" class="h-3px mt-6px overflow-hidden rounded-999px bg-#ede3f2">
        <i
          class="block h-full rounded-999px bg-gradient-to-b from-violet-top to-violet-bottom transition-[width] duration-400"
          :style="{ width: `${data.progress ?? 0}%` }"
        />
      </div>
      <div
        v-if="isRunning"
        class="flex items-center gap-6px mt-6px px-8px py-4px rounded-6px text-11px bg-violet-soft text-violet-ink"
      >
        {{ data.status === 'queued' ? '排队中…' : `处理中 ${data.progress ?? 0}%` }}
      </div>
      <RunErrorNotice v-else-if="data.status === 'error'" :node-id="id" :data="data" />
      <div
        v-else-if="data.status === 'done'"
        class="flex items-center gap-6px mt-6px px-8px py-4px rounded-6px text-11px bg-success-soft text-success"
      >
        已完成
      </div>
    </div>

    <template v-if="isTryon">
      <span
        class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#875f9a]"
        :style="{ top: '34%' }"
        >服装</span
      >
      <Handle
        id="garment"
        type="target"
        :position="Position.Left"
        class="ed-port ed-port--garment"
        :style="{ top: '34%' }"
      />
      <span
        class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#2f80ed]"
        :style="{ top: '62%' }"
        >模特</span
      >
      <Handle
        id="models"
        type="target"
        :position="Position.Left"
        class="ed-port ed-port--models"
        :style="{ top: '62%' }"
      />
    </template>
    <template v-else>
      <span
        class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#38bdf8]"
        :style="{ top: '50%' }"
        >图片</span
      >
      <Handle
        id="image"
        type="target"
        :position="Position.Left"
        class="ed-port ed-port--image"
        :style="{ top: '50%' }"
      />
    </template>

    <Handle
      :id="isI2p ? 'text' : 'image-out'"
      type="source"
      :position="Position.Right"
      :class="isI2p ? 'ed-port ed-port--text' : 'ed-port ed-port--out'"
    />
  </div>
</template>

<style scoped lang="less">
// Handle 是 Vue Flow 组件，自带 .vue-flow__handle 样式，端口样式留在 Less 以保证优先级
@import '../node-base.less';
</style>
