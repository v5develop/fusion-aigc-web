<script setup lang="ts">
/**
 * 生成卡「提示词与参考」对话框（原右侧控制台里卡片上没有的那部分，2026-11-19 控制台下线后搬到这里）：
 * 节点自带提示词（与连线文字拼接提交）、「图N / 视频N」引用片、上游参考缩略图（拖动调序号、点击定位、× 断开、+ 从画布选）。
 * 入口：节点菜单「提示词与参考」。字段直接写回节点 data / 连线 data.order，与原控制台同一套 store 方法。
 */
import { computed, ref } from 'vue'
import EditorIcon from './EditorIcon.vue'
import { compareRefOrder, normalizeHandle } from './graph.ts'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasEditorNode } from './types.ts'
import { FOCUS_RING } from './ui.ts'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ nodeId: string }>()
const emit = defineEmits<{ locate: [id: string] }>()

const store = useCanvasEditor()

const node = computed(() => (props.nodeId ? store.findNode(props.nodeId) : undefined))
const isVideo = computed(() => node.value?.data.kind === 'video')

const currentModel = computed(() => {
  const list = isVideo.value ? store.catalog.value?.video_models : store.catalog.value?.imageModels
  const d = node.value?.data
  return list?.find((item) => item.modelId === d?.modelId) ?? list?.find((item) => item.model === d?.model)
})

const promptValue = computed({
  get: () => node.value?.data.prompt ?? '',
  set: (value: string) => node.value && store.updateNodeData(node.value.id, { prompt: value }),
})

/** 提示词来源：连到本节点 prompt 口的上游 */
const promptSource = computed(() => {
  const id = props.nodeId
  const edge = store.edges.value.find((item) => item.target === id && normalizeHandle(item.targetHandle) === 'prompt')
  return edge ? store.findNode(edge.source) : undefined
})

/** 上游参考：非提示词入边，按口分组、组内按连线 order 编号（与 run 请求同一排序，「图N」= references[].index） */
const references = computed(() => {
  const id = props.nodeId
  const incoming = store.edges.value
    .filter((edge) => edge.target === id && normalizeHandle(edge.targetHandle) !== 'prompt')
    .map((edge) => ({ edge, source: store.findNode(edge.source) }))
    .filter((item): item is { edge: (typeof item)['edge']; source: CanvasEditorNode } => Boolean(item.source))
  const seq: Record<string, number> = {}
  return incoming
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
})

// ---- 参考排序（拖动缩略图，同口内重排 → 写回连线 data.order）----
const dragRefId = ref('')
type RefItem = { id: string; group: string; sortable: boolean }
function onRefDragStart(event: DragEvent, item: RefItem) {
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
function canDropOn(item: RefItem): boolean {
  const from = references.value.find((ref) => ref.id === dragRefId.value)
  return Boolean(from && item.sortable && from.id !== item.id && from.group === item.group)
}
function onRefDrop(item: RefItem) {
  if (canDropOn(item)) {
    const sameGroup = references.value.filter((ref) => ref.group === item.group && ref.sortable)
    store.reorderReference(
      props.nodeId,
      dragRefId.value,
      sameGroup.findIndex((ref) => ref.id === item.id),
    )
  }
  dragRefId.value = ''
}

/** 引用片：「图1 / 视频1」，点一下插到光标处 */
const refTokens = computed(() =>
  references.value
    .filter((item) => /^(图|视频)\d+$/.test(item.label))
    .map((item) => ({ id: item.id, token: item.label })),
)
const promptInputRef = ref<{ textareaElRef?: HTMLTextAreaElement | null } | null>(null)
function insertToken(token: string) {
  const current = promptValue.value
  const el = promptInputRef.value?.textareaElRef ?? null
  const focused = el && document.activeElement === el
  const start = focused ? el.selectionStart : current.length
  const end = focused ? el.selectionEnd : current.length
  const before = current.slice(0, start)
  const pad = before && !/\s$/.test(before) ? ' ' : ''
  promptValue.value = `${before}${pad}${token}${current.slice(end)}`.slice(0, 3000)
}

/** 「+」从画布选参考：可以喂图的节点（不含自身、分组框、文字、已连上的） */
const pickableRefs = computed(() => {
  const id = props.nodeId
  const linked = new Set(store.edges.value.filter((edge) => edge.target === id).map((edge) => edge.source))
  return store.nodes.value
    .filter(
      (item) =>
        item.id !== id &&
        item.type !== 'module' &&
        item.type !== 'text' &&
        !linked.has(item.id) &&
        !(item.type === 'tool' && item.data.tool === 'i2p'),
    )
    .map((item) => ({ label: item.data.title || item.id, key: item.id }))
})

const limitHint = computed(() => {
  const d = node.value?.data
  if (!d) return ''
  return `参考图上限 ${d.maxImageRefs ?? 5} 张 · 参考视频 ${currentModel.value?.maxReferenceVideos ?? 0} 个`
})

function locate(id: string) {
  show.value = false
  emit('locate', id)
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="`提示词与参考 · ${node?.data.title || '生成节点'}`"
    :bordered="false"
    size="small"
    class="!w-520px max-w-[calc(100vw-32px)]"
    data-canvas-popover
  >
    <template v-if="node">
      <div class="mb-6px flex items-baseline gap-8px text-muted text-12px">
        <span class="text-ink-2 font-500">上游参考</span>
        <span class="ml-auto">{{ limitHint }}</span>
      </div>
      <!-- 参考缩略图：44px + 序号徽标；× 视觉 16、::after 外扩 8 → 命中 32 -->
      <div
        class="flex items-start gap-14px mb-12px pt-10px pl-5px pr-14px overflow-x-auto"
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
          @dragover="canDropOn(item) && $event.preventDefault()"
          @drop.prevent="onRefDrop(item)"
          @dragend="dragRefId = ''"
        >
          <button
            type="button"
            class="block w-44px p-0 border-none bg-transparent text-left cursor-pointer"
            :class="FOCUS_RING"
            :aria-label="`${item.label}：${item.name}，点击定位`"
            @click="locate(item.sourceId)"
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
            class="absolute -top-6px -right-6px z-3 grid w-16px h-16px p-0 place-items-center border border-solid border-line-strong rounded-full bg-surface text-muted text-11px leading-none cursor-pointer hover:border-danger-line hover:text-danger after:content-empty after:absolute after:-inset-8px"
            :class="FOCUS_RING"
            :aria-label="`断开参考 ${item.label}`"
            title="断开这个参考"
            @click="store.removeEdgeById(item.id)"
          >
            ×
          </button>
        </div>
        <n-dropdown
          v-if="pickableRefs.length"
          trigger="click"
          :options="pickableRefs"
          scrollable
          :menu-props="() => ({ style: 'max-height: 260px' })"
          @select="(key: string | number) => store.addReferenceFrom(nodeId, String(key))"
        >
          <button
            type="button"
            class="grid shrink-0 w-44px h-44px p-0 place-items-center border border-dashed border-line-strong rounded-4px bg-surface text-muted cursor-pointer hover:border-violet hover:bg-violet-soft hover:text-violet-ink"
            :class="FOCUS_RING"
            title="从画布选一个节点作为参考"
            aria-label="从画布选一个节点作为参考"
            aria-haspopup="menu"
          >
            <EditorIcon name="plus" :size="16" />
          </button>
        </n-dropdown>
        <span v-if="!references.length" class="self-center text-muted text-12px leading-[1.5]"
          >还没有上游参考：把图片 / 生成节点连到卡片左侧参考口，或点「+」从画布选</span
        >
        <span
          v-else-if="references.some((item) => item.sortable)"
          class="self-center text-muted text-12px leading-[1.5]"
          >拖动缩略图可调整序号</span
        >
      </div>

      <div class="mb-6px flex items-baseline gap-8px text-muted text-12px">
        <label class="text-ink-2 font-500" for="canvas-node-prompt">节点提示词</label>
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{
          promptSource
            ? `连线文字来自「${promptSource.data.title || promptSource.id}」，这里的内容接在它后面`
            : '没有连文字节点时，用这里的提示词'
        }}</span>
      </div>
      <n-input
        ref="promptInputRef"
        v-model:value="promptValue"
        type="textarea"
        placeholder="写下要生成的内容；可点下方「图1」等插入参考引用"
        :maxlength="3000"
        show-count
        :autosize="{ minRows: 4, maxRows: 10 }"
        :input-props="{ id: 'canvas-node-prompt' }"
      />
      <div v-if="refTokens.length" class="flex flex-wrap gap-6px mt-8px" aria-label="插入参考引用">
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
    </template>
    <template #footer>
      <div class="flex justify-end">
        <n-button size="small" type="primary" @click="show = false">完成</n-button>
      </div>
    </template>
  </n-modal>
</template>
