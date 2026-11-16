<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 提示词文本节点（对齐原型 CanvasTextNode + canvas-v31）：
 * 头部只有标题与「…」；正文无框 textarea；底部字数；再下面是「生成来源」引用条
 * （这个文本框连到的生成节点上接的参考图，形如「@图片 1 … 参考图」，点一下定位）。
 * 右侧 text 输出口连到生成节点的 prompt 口。
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasEditor } from '../useCanvasEditor.ts'
import type { CanvasNodeData } from '../types.ts'
import { normalizeHandle } from '../graph.ts'
import { portClass } from '../ports.ts'
import { FOCUS_RING, NODE_CARD, NODE_CARD_SELECTED, NODE_HEAD, NODE_TITLE, type IQuickAddRequest } from '../ui.ts'
import NodeMenu from '../NodeMenu.vue'
import NodeDeleteBtn from '../NodeDeleteBtn.vue'
import NodeQuickAdd from '../NodeQuickAdd.vue'
import NodeResize from '../NodeResize.vue'

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
}>()

const emit = defineEmits<{ remove: []; locate: [id: string]; quickAdd: [request: IQuickAddRequest] }>()

const store = useCanvasEditor()

/** 字数上限沿用编辑器既有口径（原型显示 2000，见交付说明） */
const TEXT_MAX = 3000

const text = computed({
  get: () => props.data.text ?? '',
  set: (value: string) => store.updateNodeData(props.id, { text: value }),
})

const width = computed(() => props.data.width ?? 320)
const height = computed(() => props.data.height ?? 220)

/** 生成来源：本节点连到的生成节点，其 image 口上接的参考图（同原型 sourceRefs） */
const sourceRefs = computed(() => {
  const edges = store.edges.value
  const modelIds = new Set(edges.filter((edge) => edge.source === props.id).map((edge) => edge.target))
  if (!modelIds.size) return []
  const refs: { id: string; name: string; model: string }[] = []
  for (const edge of edges) {
    if (!modelIds.has(edge.target)) continue
    if (normalizeHandle(edge.targetHandle) !== 'image') continue
    if (refs.some((ref) => ref.id === edge.source)) continue
    const source = store.findNode(edge.source)
    if (!source) continue
    refs.push({
      id: source.id,
      name: source.data.title,
      model:
        source.type === 'model'
          ? modelLabelOf(source.data.model) || '模型'
          : source.type === 'video'
            ? '视频'
            : '参考图',
    })
  }
  return refs
})
</script>

<template>
  <div
    class="flex flex-col"
    :class="[NODE_CARD, { 'is-selected': selected, [NODE_CARD_SELECTED]: selected }]"
    :style="{ width: `${width}px`, minHeight: `${height}px`, height: data.heightFixed ? `${height}px` : undefined }"
  >
    <NodeDeleteBtn :title="data.title || '文字'" :hidden="!!data.locked" @remove="emit('remove')" />
    <header :class="NODE_HEAD">
      <span class="flex-1" :class="NODE_TITLE">{{ data.title || '文字' }}</span>
      <NodeMenu :title="data.title || '文字'" @remove="emit('remove')" />
    </header>

    <div class="flex flex-1 flex-col gap-8px px-12px pt-4px pb-20px">
      <textarea
        v-model="text"
        class="block flex-1 w-full min-h-40px overflow-y-auto p-0 border-none bg-transparent text-[color:var(--xq-canvas-prompt,var(--xq-ink-2))] text-13px leading-[1.6] resize-none outline-none placeholder:text-placeholder nodrag nowheel"
        :maxlength="TEXT_MAX"
        placeholder="输入提示词…"
        :aria-label="`${data.title || '文字'} 提示词`"
      />
      <footer class="flex shrink-0 h-32px items-center gap-8px text-muted text-11px font-500 tabular-nums">
        {{ text.length }} / {{ TEXT_MAX }}
      </footer>
      <div v-if="sourceRefs.length" class="flex flex-col gap-4px">
        <button
          v-for="source in sourceRefs"
          :key="`source-${source.id}`"
          type="button"
          class="flex w-full h-22px items-center gap-8px px-8px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-12px text-left cursor-pointer transition-colors duration-120 hover:border-violet hover:bg-violet-soft-2 nodrag"
          :class="FOCUS_RING"
          :title="`生成节点的图片输入 · ${source.name}`"
          @click.stop="emit('locate', source.id)"
        >
          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">@{{ source.name }}</span>
          <span class="shrink-0 ml-auto text-muted text-11px">{{ source.model }}</span>
        </button>
      </div>
    </div>

    <NodeQuickAdd :kinds="['image-model', 'video-model']" @open="emit('quickAdd', $event)" />
    <Handle id="text" type="source" :position="Position.Right" :class="portClass('text')" />
    <NodeResize :id="id" kind="text" :title="data.title || '文字'" />
  </div>
</template>
