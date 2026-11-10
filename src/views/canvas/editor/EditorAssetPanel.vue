<script setup lang="ts">
/**
 * 左侧「画布资产」栏（对齐原型 CanvasView .wf-assets + canvas-v31 §2）：
 * 列表直接取当前画布节点（分组框除外），不调新接口；点一行定位到画布。
 * 宽 248 / 头 44 / 搜索 32 / 行 44 / 缩略 32；可折叠到 48。
 */
import { computed, ref } from 'vue'
import { modelLabelOf } from '@/utils/model-label'
import EditorIcon from './EditorIcon.vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasEditorNode } from './types.ts'
import { FOCUS_RING } from './ui.ts'

const emit = defineEmits<{ locate: [id: string]; addFromLibrary: [] }>()

const store = useCanvasEditor()
const { nodes, selectedNodeId } = store

const collapsed = ref(false)
const query = ref('')
const filter = ref<'all' | 'image' | 'video' | 'text' | 'model'>('all')

const FILTERS = [
  { value: 'all', label: '全部类型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'text', label: '文字' },
  { value: 'model', label: '模型' },
] as const

const allRows = computed(() => nodes.value.filter((node) => node.type !== 'module'))

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return allRows.value.filter((node) => {
    if (filter.value === 'image' && node.type !== 'image') return false
    if (filter.value === 'video' && node.type !== 'video' && node.data.kind !== 'video') return false
    if (filter.value === 'text' && node.type !== 'text') return false
    if (filter.value === 'model' && node.type !== 'model') return false
    if (!q) return true
    return `${node.data.title} ${node.data.subtitle ?? ''}`.toLowerCase().includes(q)
  })
})

function isVideoNode(node: CanvasEditorNode) {
  return node.type === 'video' || node.data.kind === 'video'
}

/** 副标题：类型 · 模型（同原型 nodeTypeLabel） */
function typeLabel(node: CanvasEditorNode) {
  if (node.type === 'text') return '文字'
  if (node.type === 'video') return '视频'
  if (node.type === 'tool') return '工具'
  if (node.type === 'model')
    return `${node.data.kind === 'video' ? '视频' : '图片'} · ${modelLabelOf(node.data.model) || '模型'}`
  return '图片'
}

function thumbOf(node: CanvasEditorNode) {
  return node.data.image || node.data.resultImage || ''
}
</script>

<template>
  <aside
    class="flex shrink-0 min-h-0 flex-col border-r border-r-solid border-line bg-white transition-[width] duration-150"
    :class="collapsed ? 'w-48px' : 'w-248px'"
    aria-label="画布资产"
  >
    <header
      class="flex shrink-0 h-44px items-center gap-6px border-b border-b-solid border-line-soft text-ink-2"
      :class="collapsed ? 'px-8px' : 'px-12px'"
    >
      <template v-if="!collapsed">
        <EditorIcon name="layers" :size="15" />
        <strong class="text-ink text-13px font-600">画布资产</strong>
        <span
          class="px-6px border border-solid border-line rounded-999px bg-surface2 text-muted text-11px leading-18px"
          >{{ allRows.length }}</span
        >
      </template>
      <button
        type="button"
        class="relative grid w-28px h-28px ml-auto p-0 after:content-empty after:absolute after:-inset-3px place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
        :class="FOCUS_RING"
        :title="collapsed ? '展开画布资产' : '折叠画布资产'"
        :aria-label="collapsed ? '展开画布资产' : '折叠画布资产'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <EditorIcon :name="collapsed ? 'chevronRight' : 'chevronLeft'" :size="14" />
      </button>
    </header>

    <template v-if="!collapsed">
      <label
        class="flex shrink-0 h-32px items-center gap-6px mx-12px mt-10px px-8px border border-solid border-control rounded-4px bg-white text-placeholder shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] focus-within:border-violet focus-within:shadow-[0_0_0_3px_rgba(135,95,154,0.14),inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
      >
        <EditorIcon name="search" :size="13" />
        <input
          v-model="query"
          class="flex-1 min-w-0 p-0 border-none bg-transparent text-ink text-13px outline-none placeholder:text-placeholder"
          placeholder="搜索画布资产"
          aria-label="搜索画布资产"
        />
      </label>
      <div class="flex shrink-0 h-34px items-center gap-6px mx-12px pt-8px pb-2px">
        <select
          v-model="filter"
          class="flex-1 h-24px p-0 border-none bg-transparent text-muted text-13px cursor-pointer outline-none focus-visible:text-violet-ink"
          aria-label="按类型筛选"
        >
          <option v-for="item in FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <span class="text-muted text-11px tabular-nums">{{ rows.length }} / {{ allRows.length }}</span>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-8px pt-6px">
        <button
          v-for="node in rows"
          :key="node.id"
          type="button"
          class="flex w-full h-44px items-center gap-8px px-8px py-5px border border-solid border-transparent rounded-4px bg-transparent text-ink-2 text-left cursor-pointer hover:bg-surface2"
          :class="[
            FOCUS_RING,
            {
              '!border-violet-line !bg-violet-soft shadow-[inset_0_1px_2px_rgba(31,35,41,0.1),inset_0_0_0_1px_rgba(31,35,41,0.03)]':
                selectedNodeId === node.id,
            },
          ]"
          :title="`${node.data.title}\n在画布中定位`"
          :aria-current="selectedNodeId === node.id ? 'true' : undefined"
          @click="emit('locate', node.id)"
        >
          <span
            class="grid shrink-0 w-32px h-32px place-items-center overflow-hidden border border-solid border-line rounded-4px bg-surface3 text-muted"
          >
            <img v-if="thumbOf(node)" :src="thumbOf(node)" alt="" class="w-full h-full object-cover" />
            <span v-else-if="isVideoNode(node)" class="grid place-items-center gap-1px">
              <EditorIcon name="video" :size="16" />
              <em class="not-italic text-10px font-500 leading-[1.1]">视频</em>
            </span>
            <span v-else-if="node.type === 'text'" class="text-13px leading-none">Aa</span>
            <EditorIcon v-else :name="node.type === 'tool' ? 'model' : 'image'" :size="15" />
          </span>
          <span class="flex min-w-0 flex-col gap-2px">
            <strong class="overflow-hidden text-ink text-13px font-500 leading-17px text-ellipsis whitespace-nowrap">{{
              node.data.title
            }}</strong>
            <small class="overflow-hidden text-muted text-11px leading-15px text-ellipsis whitespace-nowrap">{{
              typeLabel(node)
            }}</small>
          </span>
        </button>
        <p v-if="!rows.length" class="m-0 py-24px text-center text-placeholder text-11px">
          {{ allRows.length ? '没有匹配的资产' : '画布上还没有节点' }}
        </p>
      </div>

      <button
        type="button"
        class="flex shrink-0 h-32px items-center justify-center gap-6px mx-12px mt-8px px-9px border border-solid border-control rounded-4px bg-gradient-to-b from-white to-#fbfcfc text-ink-2 text-13px cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] hover:border-violet-line hover:from-violet-soft hover:to-violet-soft hover:text-violet-ink"
        :class="FOCUS_RING"
        @click="emit('addFromLibrary')"
      >
        <EditorIcon name="albums" :size="15" />
        从素材库添加
      </button>
      <p class="mx-12px mt-6px mb-12px text-center text-placeholder text-11px leading-15px">点击资产可定位到画布</p>
    </template>
  </aside>
</template>
