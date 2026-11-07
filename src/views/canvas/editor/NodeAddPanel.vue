<script setup lang="ts">
/**
 * 添加节点面板（原型 CanvasAddPanel + canvas-v31 §3）：300 宽浮层，头 44px + 搜索 + 分组卡片
 * （输入节点 / 生成节点 / 工具）。从左工具条「+」、双击空白画布、端口「+」打开；
 * 选中一项由画布页在打开位置新建节点（端口「+」打开时只列可接到下游的种类，并自动连线）。
 * 输入节点里的「音频」暂未开放：灰显（.35）、悬停提示「即将开放」、点了没反应（原型 enabled:false）。
 * 端口「+」打开时额外给「添加文字」（原型 quick-add 第 4 项）：文字节点没有输入口，不连线，
 * 发 add-text 交给画布页新建（点「+」落在来源节点右侧、拖线到空白落在松手点），不走自动连线（否则会提示「文字节点没有输入口」）。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import EditorIcon from './EditorIcon.vue'
import { toolLabel } from './graph.ts'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasToolKind } from './types.ts'
import { FOCUS_RING, POP_SURFACE, type AddPanelKind, type QuickAddKind } from './ui.ts'

const props = defineProps<{
  /** 面板左上角（相对画布舞台，px） */
  x: number
  y: number
  /** 端口「+」打开时可选的下游种类；不传 = 全部 */
  kinds?: QuickAddKind[]
}>()

const emit = defineEmits<{ close: []; add: [kind: AddPanelKind, tool?: CanvasToolKind]; addText: [] }>()

const store = useCanvasEditor()
const q = ref('')
const searchRef = ref<HTMLInputElement | null>(null)

interface IAddItem {
  key: string
  kind: AddPanelKind
  tool?: CanvasToolKind
  /** 即将开放：灰显不可点 */
  soon?: boolean
  label: string
  desc?: string
  icon: string
  tone?: 'video'
}

const INPUTS: IAddItem[] = [
  { key: 'text', kind: 'text', label: '文字', icon: 'text' },
  { key: 'image', kind: 'image', label: '图片', icon: 'image' },
  { key: 'video', kind: 'video', label: '视频', icon: 'video' },
  { key: 'audio', kind: 'text', label: '音频', icon: 'doc', soon: true },
]

/** 端口「+」专用：在来源节点旁加一个文字节点（不连线） */
const QUICK_TEXT: IAddItem = { key: 'quick-text', kind: 'text', label: '添加文字', desc: '提示词节点', icon: 'text' }

const GENERATORS: IAddItem[] = [
  { key: 'image-model', kind: 'image-model', label: '图片生成', desc: '文生图 / 参考图生图', icon: 'image' },
  {
    key: 'video-model',
    kind: 'video-model',
    label: '视频生成',
    desc: '文生视频 / 图生视频',
    icon: 'video',
    tone: 'video',
  },
]

const TOOL_DESC: Record<CanvasToolKind, { desc: string; icon: string }> = {
  tryon: { desc: '服装 × 模特，按模特数量出图', icon: 'shirt' },
  crop: { desc: '矩形 / 圆形裁切', icon: 'crop' },
  upscale: { desc: '按 2x / 4x 放大清晰度', icon: 'model' },
  outpaint: { desc: '保留原图并向外延伸', icon: 'expand' },
  i2p: { desc: '连接图片生成结构化提示词', icon: 'text' },
  mask: { desc: '框选局部并写修改要求', icon: 'brush' },
}

const TOOL_ORDER: CanvasToolKind[] = ['tryon', 'crop', 'upscale', 'outpaint', 'i2p', 'mask']

const TOOLS: IAddItem[] = TOOL_ORDER.map((tool) => ({
  key: `tool-${tool}`,
  kind: 'tool',
  tool,
  label: toolLabel(tool),
  desc: TOOL_DESC[tool].desc,
  icon: TOOL_DESC[tool].icon,
}))

/** catalog 里 ready=false 的工具灰显（目录未加载时不拦，同节点 / 执行的口径） */
function toolClosed(item: IAddItem): boolean {
  return item.kind === 'tool' && store.catalog.value?.tools?.find((t) => t.tool === item.tool)?.ready === false
}

function allowed(item: IAddItem): boolean {
  if (!props.kinds) return true
  if (item.key === 'quick-text') return true
  return (props.kinds as string[]).includes(item.kind)
}

function disabledOf(item: IAddItem): boolean {
  return Boolean(item.soon) || toolClosed(item)
}

function titleOf(item: IAddItem): string {
  if (item.soon) return '即将开放'
  if (toolClosed(item)) return '该功能暂未开放'
  return item.desc ? `${item.label}：${item.desc}` : item.label
}

function matches(item: IAddItem): boolean {
  const key = q.value.trim().toLowerCase()
  return !key || `${item.label}${item.desc ?? ''}`.toLowerCase().includes(key)
}

const sections = computed(() =>
  [
    { title: '输入节点', compact: true, items: INPUTS },
    { title: '生成节点', compact: false, items: GENERATORS },
    { title: '工具', compact: false, items: TOOLS },
    ...(props.kinds ? [{ title: '其他', compact: true, items: [QUICK_TEXT] }] : []),
  ]
    .map((section) => ({ ...section, items: section.items.filter((item) => allowed(item) && matches(item)) }))
    .filter((section) => section.items.length),
)

function pick(item: IAddItem) {
  if (disabledOf(item)) return
  if (item.key === 'quick-text') {
    emit('addText')
    return
  }
  emit('add', item.kind, item.tool)
}

onMounted(() => {
  void nextTick(() => searchRef.value?.focus())
})
</script>

<template>
  <aside
    :class="POP_SURFACE"
    class="absolute z-20 flex flex-col w-300px max-h-[min(640px,calc(100%-40px))] overflow-hidden text-ink-2"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="dialog"
    aria-label="添加节点"
    data-canvas-popover
    @pointerdown.stop
    @wheel.stop
    @keydown.esc.stop="emit('close')"
  >
    <header
      class="flex shrink-0 items-center h-44px px-12px border-b border-b-solid border-line-soft rounded-t-8px bg-white"
    >
      <strong class="text-ink text-14px font-600">{{ kinds ? '添加下游节点' : '添加节点' }}</strong>
      <button
        type="button"
        class="relative grid w-28px h-28px ml-auto p-0 after:content-empty after:absolute after:-inset-3px place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
        :class="FOCUS_RING"
        aria-label="关闭添加面板"
        title="关闭"
        @click="emit('close')"
      >
        <EditorIcon name="close" :size="14" />
      </button>
    </header>
    <input
      ref="searchRef"
      v-model="q"
      class="shrink-0 h-32px mx-12px mt-10px mb-12px px-9px border border-solid border-control rounded-4px bg-white text-ink text-13px outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)] placeholder:text-placeholder focus:border-violet focus:shadow-[0_0_0_3px_rgba(135,95,154,0.14),inset_0_1px_2px_rgba(31,35,41,0.055)]"
      placeholder="按名称或类型搜索"
      aria-label="搜索节点类型"
    />

    <div class="flex-1 min-h-0 overflow-y-auto px-12px pt-2px pb-14px">
      <section v-for="section in sections" :key="section.title" class="mt-12px first:mt-0">
        <h4 class="m-0 mb-6px text-ink text-13px font-600">{{ section.title }}</h4>
        <div class="grid grid-cols-2 gap-8px">
          <button
            v-for="item in section.items"
            :key="item.key"
            type="button"
            class="flex flex-col items-center p-10px border border-solid border-line rounded-8px bg-white text-ink-2 text-13px text-center cursor-pointer transition-colors duration-120 hover:border-violet-line hover:bg-violet-soft hover:text-violet-ink aria-disabled:cursor-not-allowed aria-disabled:hover:border-line aria-disabled:hover:bg-white aria-disabled:hover:text-ink-2"
            :class="[
              FOCUS_RING,
              section.compact ? 'justify-center gap-6px min-h-64px' : 'gap-4px min-h-88px',
              item.soon ? 'opacity-35' : toolClosed(item) ? 'opacity-42' : '',
            ]"
            :aria-disabled="disabledOf(item) || undefined"
            :title="titleOf(item)"
            @click="pick(item)"
          >
            <span
              class="grid shrink-0 w-28px h-28px place-items-center rounded-4px"
              :class="item.tone === 'video' ? 'bg-[#fbeeed] text-danger' : 'bg-violet-soft text-violet'"
            >
              <EditorIcon :name="item.icon" :size="16" />
            </span>
            <span>{{ item.label }}</span>
            <small v-if="item.desc" class="w-full text-muted text-11px leading-[1.35]">{{
              toolClosed(item) ? '暂未开放' : item.desc
            }}</small>
          </button>
        </div>
      </section>
      <p v-if="!sections.length" class="m-0 mt-8px text-muted text-12px text-center">没有匹配的节点类型</p>
    </div>
  </aside>
</template>
