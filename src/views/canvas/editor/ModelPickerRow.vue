<script setup lang="ts">
/**
 * 生成卡模型行（2026-11-13）：参数块第一行，整行宽按钮显示当前模型名 + 单价 / 关键能力，点开列表换模型。
 * 选择走 store.changeModel（与控制台同一实现：回填并夹紧比例 / 分辨率 / 数量 / 质量 / 时长，裁掉超出参考上限的连线）。
 * 列表：本账号最近用过的在前、超过 8 个出搜索框；上下键 / Home / End / Enter / Esc 全键盘可用。
 * 弹层 teleport 到 body：内容带 data-canvas-popover / data-node-params，画布快捷键守卫（Delete / Backspace）照常放行；
 * 带 nodrag nopan nowheel，不触发拖动 / 平移 / 缩放。
 */
import { computed, nextTick, ref } from 'vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasNodeData } from './types.ts'
import type { ICanvasCatalogModel } from '@/api/canvas-home.ts'
import { modelLabelOf } from '@/utils/model-label'
import { readRecentModels, rememberRecentModel } from './model-recent-prefs.ts'
import { FOCUS_RING } from './ui.ts'

const props = defineProps<{ nodeId: string; data: CanvasNodeData; disabled?: boolean }>()

const store = useCanvasEditor()
const kind = computed<'image' | 'video'>(() => (props.data.kind === 'video' ? 'video' : 'image'))
const models = computed(() => {
  const catalog = store.catalog.value
  return (kind.value === 'video' ? catalog?.video_models : catalog?.imageModels) ?? []
})
const current = computed(
  () =>
    models.value.find((item) => item.modelId === props.data.modelId) ??
    models.value.find((item) => item.model === props.data.model),
)

const nameOf = (item: ICanvasCatalogModel) => item.label || modelLabelOf(item.model)

/** 单价：图 = 最低档「N 点/张起」；视频 = 按时长折算的最低「N 点/秒起」，折算不出就写「N 点/条起」；目录没价就不显示 */
function priceOf(item: ICanvasCatalogModel): string {
  const prices = item.prices ?? []
  if (!prices.length) return ''
  if (kind.value === 'video') {
    const perSecond = prices
      .map((price) => {
        const seconds = Number.parseFloat(price.duration ?? '')
        return seconds > 0 ? price.points / seconds : NaN
      })
      .filter((value) => Number.isFinite(value))
    if (perSecond.length) return `${formatPoints(Math.min(...perSecond))} 点/秒起`
    return `${Math.min(...prices.map((price) => price.points))} 点/条起`
  }
  return `${Math.min(...prices.map((price) => price.points))} 点/张起`
}
function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10)
}
/** 关键能力短标签 */
function tagsOf(item: ICanvasCatalogModel): string[] {
  const tags: string[] = []
  if (item.maxImageRefs > 0) tags.push(`最多 ${item.maxImageRefs} 张参考`)
  if ((item.maxReferenceVideos ?? 0) > 0) tags.push(`参考视频 ${item.maxReferenceVideos} 个`)
  if (item.sizes?.some((size) => size.toUpperCase() === '4K')) tags.push('支持 4K')
  if (kind.value === 'video' && item.sound) tags.push('带声音')
  return tags
}
const subline = computed(() => {
  const item = current.value
  if (!item) return ''
  return [priceOf(item), tagsOf(item)[0]].filter(Boolean).join(' · ')
})

// ---- 弹层 ----
const show = ref(false)
const keyword = ref('')
const active = ref(0)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const SEARCH_MIN = 8

const showSearch = computed(() => models.value.length > SEARCH_MIN)
const rows = computed(() => {
  const recent = readRecentModels(kind.value)
  const rank = (item: ICanvasCatalogModel) => {
    const i = recent.indexOf(item.modelId)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const word = keyword.value.trim().toLowerCase()
  return models.value
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !word || nameOf(item).toLowerCase().includes(word) || item.model.toLowerCase().includes(word))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => ({ item, recent: rank(item) !== Number.MAX_SAFE_INTEGER }))
})
const optionId = (index: number) => `${props.nodeId}-model-opt-${index}`

function open() {
  if (props.disabled || !models.value.length) return
  keyword.value = ''
  const at = rows.value.findIndex((row) => row.item.modelId === current.value?.modelId)
  active.value = Math.max(0, at)
  show.value = true
  void nextTick(() => {
    ;(showSearch.value ? searchRef.value : panelRef.value)?.focus({ preventScroll: true })
    document.getElementById(optionId(active.value))?.scrollIntoView?.({ block: 'nearest' })
  })
}
function close(restore = true) {
  show.value = false
  if (restore) void nextTick(() => triggerRef.value?.focus({ preventScroll: true }))
}
function choose(item: ICanvasCatalogModel) {
  if (!item.ready) return
  if (item.modelId !== current.value?.modelId) store.changeModel(props.nodeId, item)
  rememberRecentModel(kind.value, item.modelId)
  close()
}
function move(step: number) {
  const count = rows.value.length
  if (!count) return
  // 跳过不可用项
  let next = active.value
  for (let i = 0; i < count; i += 1) {
    next = (next + step + count) % count
    if (rows.value[next]?.item.ready) break
  }
  active.value = next
  void nextTick(() => document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' }))
}
function onKeydown(event: KeyboardEvent) {
  const key = event.key
  if (key === 'ArrowDown') move(1)
  else if (key === 'ArrowUp') move(-1)
  else if (key === 'Home' && !showSearch.value) active.value = 0
  else if (key === 'End' && !showSearch.value) active.value = Math.max(0, rows.value.length - 1)
  else if (key === 'Enter') {
    const row = rows.value[active.value]
    if (row) choose(row.item)
  } else if (key === 'Escape') close()
  else if (key === 'Tab') close(false)
  else return
  event.preventDefault()
  event.stopPropagation()
}
function onSearch() {
  const first = rows.value.findIndex((row) => row.item.ready)
  active.value = Math.max(0, first)
}
</script>

<template>
  <n-popover
    :show="show"
    trigger="manual"
    placement="bottom-start"
    :show-arrow="false"
    :raw="true"
    :width="288"
    @clickoutside="close(false)"
  >
    <template #trigger>
      <button
        ref="triggerRef"
        type="button"
        class="flex items-center w-full h-40px gap-8px px-10px border border-solid border-line rounded-6px bg-surface text-left cursor-pointer nodrag nopan nowheel hover:border-violet-line disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted"
        :class="FOCUS_RING"
        :disabled="disabled"
        aria-haspopup="listbox"
        :aria-expanded="show"
        :aria-label="`模型：${current ? nameOf(current) : '未选择'}，点击更换`"
        data-node-params
        @pointerdown.stop="store.selectNode(nodeId)"
        @click="show ? close() : open()"
      >
        <span class="min-w-0 flex-1">
          <span class="block overflow-hidden text-ellipsis whitespace-nowrap text-12px leading-18px font-500 text-ink">
            {{ current ? nameOf(current) : models.length ? '选择模型' : '目录加载中…' }}
          </span>
          <span
            v-if="subline"
            class="block overflow-hidden text-ellipsis whitespace-nowrap text-11px leading-14px text-muted"
            >{{ subline }}</span
          >
        </span>
        <svg
          class="shrink-0 text-muted"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
    </template>
    <div
      ref="panelRef"
      class="flex flex-col w-288px max-h-320px py-4px border border-solid border-line rounded-8px bg-overlay shadow-pop outline-none nodrag nopan nowheel"
      data-canvas-popover
      data-node-params
      tabindex="-1"
      @keydown="onKeydown"
      @pointerdown.stop
      @wheel.stop
    >
      <div v-if="showSearch" class="px-8px pb-4px pt-2px">
        <input
          ref="searchRef"
          v-model="keyword"
          type="search"
          class="box-border w-full h-28px px-8px border border-solid border-line rounded-4px bg-surface text-ink text-12px outline-none focus-visible:border-violet"
          placeholder="搜索模型"
          aria-label="搜索模型"
          role="combobox"
          aria-expanded="true"
          aria-controls="model-picker-list"
          :aria-activedescendant="rows.length ? optionId(active) : undefined"
          @input="onSearch"
        />
      </div>
      <ul
        id="model-picker-list"
        class="m-0 p-0 overflow-y-auto list-none"
        role="listbox"
        aria-label="选择模型"
        :aria-activedescendant="rows.length ? optionId(active) : undefined"
      >
        <li v-if="!rows.length" class="px-12px py-10px text-muted text-12px">没有匹配的模型</li>
        <li
          v-for="(row, index) in rows"
          :id="optionId(index)"
          :key="row.item.modelId"
          role="option"
          :aria-selected="row.item.modelId === current?.modelId"
          :aria-disabled="!row.item.ready || undefined"
          class="flex items-start gap-8px mx-4px px-8px py-6px rounded-4px"
          :class="[
            row.item.ready ? 'cursor-pointer text-ink' : 'cursor-not-allowed text-muted',
            index === active && row.item.ready ? 'bg-surface2' : '',
          ]"
          @mouseenter="row.item.ready && (active = index)"
          @click="choose(row.item)"
        >
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-6px">
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-12px leading-18px font-500">{{
                nameOf(row.item)
              }}</span>
              <span v-if="!row.item.ready" class="shrink-0 text-11px text-muted">（不可用）</span>
              <span v-else-if="row.recent" class="shrink-0 text-10px leading-14px text-muted">最近</span>
            </span>
            <span v-if="priceOf(row.item)" class="block text-11px leading-16px text-violet-ink">{{
              priceOf(row.item)
            }}</span>
            <span v-if="tagsOf(row.item).length" class="flex flex-wrap gap-4px mt-2px">
              <span
                v-for="tag in tagsOf(row.item)"
                :key="tag"
                class="px-4px text-10px leading-16px rounded-3px bg-surface3 text-muted"
                >{{ tag }}</span
              >
            </span>
          </span>
          <svg
            v-if="row.item.modelId === current?.modelId"
            class="shrink-0 mt-2px text-violet"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label="当前模型"
          >
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </li>
      </ul>
    </div>
  </n-popover>
</template>
