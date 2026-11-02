<script setup lang="ts">
/**
 * 生成节点（图片 / 视频）：参数摘要 + 运行态结果区。
 * 端口：prompt（1 条，新线替换旧线）+ image（视频模型为 image1/image2 首尾帧）；
 * 输出 image-out；候选通过参数面板 / 缩略图选择（select-candidate 写回服务端）。
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import EditorIcon from '../EditorIcon.vue'
import RunErrorNotice from '../RunErrorNotice.vue'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const store = useCanvasEditor()

const isVideo = computed(() => props.data.kind === 'video')
const isRunning = computed(() => props.data.status === 'running' || props.data.status === 'queued')
const width = computed(() => props.data.width ?? (isVideo.value ? 340 : 320))
const candidates = computed(() => props.data.candidates ?? [])
const selectedIdx = computed(() => props.data.selectedCandidate ?? 0)

const summary = computed(() => {
  const parts: string[] = []
  if (props.data.model) parts.push(props.data.model)
  if (isVideo.value) {
    if (props.data.duration) parts.push(props.data.duration)
    if (props.data.size) parts.push(props.data.size)
  } else if (props.data.size) {
    parts.push(props.data.size)
  }
  if (props.data.ratio) parts.push(props.data.ratio)
  if (!isVideo.value && (props.data.count ?? 1) > 1) parts.push(`${props.data.count}张`)
  return parts.join(' · ')
})

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
    class="ll-card group relative text-12px text-ink"
    :class="{
      'is-selected': selected,
      '!border-violet !shadow-[0_0_0_2px_rgba(135,95,154,0.18),0_10px_18px_-10px_rgba(31,35,41,0.22)]': selected,
    }"
    :style="{ width: `${width}px` }"
  >
    <header class="flex h-34px items-center gap-8px pl-12px pr-10px border-b border-line-soft rounded-t-10px">
      <span class="shrink-0 w-8px h-8px rounded-full" :class="isVideo ? 'bg-[#f472b6]' : 'bg-[#875f9a]'" />
      <span class="overflow-hidden flex-1 text-13px font-600 text-ellipsis whitespace-nowrap">{{
        data.title || '生成节点'
      }}</span>
      <span
        v-if="data.badge"
        class="shrink-0 px-6px py-1px rounded-4px bg-violet-soft text-violet-ink text-10px leading-16px"
        >{{ data.badge }}</span
      >
      <button
        type="button"
        class="grid shrink-0 w-22px h-22px p-0 place-items-center border border-violet-line rounded-6px bg-violet-soft text-violet-ink cursor-pointer hover:border-violet hover:text-violet-press"
        :class="{ '!bg-#ede3f2 !border-violet-line': isRunning }"
        :title="isRunning ? '取消执行' : '执行此节点'"
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
      <div class="flex items-center justify-between gap-8px mb-6px text-ink-2 text-11px">
        <span>{{ summary || '未选择模型' }}</span>
        <span v-if="data.inputOnly" class="shrink-0 text-warning">参考素材 · 不执行</span>
      </div>

      <div
        v-if="isVideo && data.video"
        class="grid w-full place-items-center overflow-hidden rounded-8px border border-line-soft [background:repeating-conic-gradient(#f3f4f5_0%,#f3f4f5_25%,transparent_0%,transparent_50%)_0_0/14px_14px,#f7f8f9] min-h-120px"
      >
        <video
          :src="data.video"
          controls
          preload="metadata"
          class="block w-full max-h-240px object-contain nodrag nowheel"
        />
      </div>
      <div
        v-else-if="data.image"
        class="grid w-full place-items-center overflow-hidden rounded-8px border border-line-soft [background:repeating-conic-gradient(#f3f4f5_0%,#f3f4f5_25%,transparent_0%,transparent_50%)_0_0/14px_14px,#f7f8f9] min-h-120px"
      >
        <img :src="data.image" :alt="data.title" draggable="false" class="block w-full max-h-240px object-contain" />
      </div>
      <div
        v-else
        class="flex flex-col items-center gap-6px justify-center border border-dashed border-line rounded-8px text-placeholder text-11px bg-surface2 min-h-110px"
      >
        <EditorIcon :name="isVideo ? 'video' : 'image'" :size="20" />
        <span>{{ isRunning ? '等待生成…' : '尚无结果' }}</span>
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
        {{ data.status === 'queued' ? '排队中…' : `生成中 ${data.progress ?? 0}%` }}
      </div>
      <RunErrorNotice v-else-if="data.status === 'error'" :node-id="id" :data="data" />
      <div
        v-else-if="partial"
        class="flex items-center gap-6px mt-6px px-8px py-4px rounded-6px text-11px bg-success-soft text-success"
      >
        成功 {{ candidates.length }}/{{ data.requestedCount }} · 只计成功张数
      </div>

      <div v-if="candidates.length > 1" class="flex gap-5px mt-6px overflow-x-auto nodrag nowheel">
        <button
          v-for="(url, index) in candidates"
          :key="url + index"
          type="button"
          class="relative shrink-0 w-46px h-46px overflow-hidden border border-line rounded-6px p-0 bg-surface2 cursor-pointer"
          :class="{ '!border-violet !shadow-[0_0_0_1px_rgba(135,95,154,0.45)]': selectedIdx === index }"
          :title="`候选 ${index + 1}，点击设为输出`"
          @click.stop="onSelectCandidate(index)"
        >
          <img :src="url" :alt="`候选 ${index + 1}`" draggable="false" class="block w-full h-full object-cover" />
        </button>
      </div>
    </div>

    <span
      class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#22c55e]"
      :style="{ top: '26%' }"
      >提示词</span
    >
    <Handle
      id="prompt"
      type="target"
      :position="Position.Left"
      class="ed-port ed-port--prompt"
      :style="{ top: '26%' }"
    />

    <template v-if="isVideo">
      <span
        class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#38bdf8]"
        :style="{ top: '52%' }"
        >首帧</span
      >
      <Handle
        id="image1"
        type="target"
        :position="Position.Left"
        class="ed-port ed-port--image"
        :style="{ top: '52%' }"
      />
      <span
        class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#38bdf8]"
        :style="{ top: '70%' }"
        >尾帧</span
      >
      <Handle
        id="image2"
        type="target"
        :position="Position.Left"
        class="ed-port ed-port--image"
        :style="{ top: '70%' }"
      />
    </template>
    <template v-else>
      <span
        class="absolute px-7px py-2px rounded-5px text-white text-10px font-600 leading-14px whitespace-nowrap -translate-x-full -translate-y-50% pointer-events-none opacity-0 transition-opacity duration-120 group-hover:opacity-100 [.is-selected_&]:opacity-100 bg-[#38bdf8]"
        :style="{ top: '62%' }"
        >参考图</span
      >
      <Handle
        id="image"
        type="target"
        :position="Position.Left"
        class="ed-port ed-port--image"
        :style="{ top: '62%' }"
      />
    </template>

    <Handle id="image-out" type="source" :position="Position.Right" class="ed-port ed-port--out" />
  </div>
</template>

<style scoped lang="less">
// Handle 是 Vue Flow 组件，自带 .vue-flow__handle 样式，端口样式留在 Less 以保证优先级
@import '../node-base.less';
</style>
