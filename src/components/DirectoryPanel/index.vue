<script setup lang="ts">
/**
 * 功能目录面板（头 + 展开 / 收起两层）——AI 图片 / AI 视频 / 电商 / 商拍二级目录（layout/Navigation）
 * 与工具页目录（views/tools）共用，对齐 2026-11-12 原型 NextDirectory：
 *
 * - 展开层 body 固定 160 宽、收起层 rail 固定 44 宽，叠在同一个 stage 里：opacity 交叉淡入淡出 170ms
 *   cubic-bezier(.4,0,.2,1)；不可见那层 inert + aria-hidden（不进 Tab 序、读屏看不到、键盘上下键也走不到）。
 * - 头部两枚按钮各自钉在固定位置（收起钮 x=123 / 展开钮 x=8）交叉淡入淡出，后出现那枚延后 60ms；
 *   标题淡出 90ms。图标因此在展开 / 收起之间不会横向位移。
 * - 槽宽过渡（220ms 同曲线）由宿主负责（Navigation 的面板 / tools 的 nav 槽）；本组件内全部过渡在
 *   prefers-reduced-motion 下关闭。
 * - 不可见层不带 data-rail-id / data-panel-node / role=menu：宿主的收起气泡只在收起层取节点，
 *   键盘上下键只在可见层移动。
 * - 颜色只用主题令牌（深色自动跟随）；文字截断，最大字号（×1.2）下行高固定 44，不撑破。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import DirectoryItem from './DirectoryItem.vue'
import type { DirectoryEntry, DirectoryGroup } from './types'

const props = withDefaults(
  defineProps<{
    title: string
    groups: DirectoryGroup[]
    /** 收起为 44 图标列（只有 railable 时生效） */
    collapsed?: boolean
    /** 可收起：头部出现展开 / 收起两枚按钮，并渲染 rail 层；否则只有 body 层 + 关闭钮 */
    railable?: boolean
    /** 条目是否当前页（含「点开下一级」条目的选中语义），默认全不选中 */
    isActive?: (e: DirectoryEntry) => boolean
    /** role=menu / menuitem（Navigation 的浮出目录） */
    menu?: boolean
    /** 可点条目渲染成 RouterLink */
    link?: boolean
    /** 列表上下渐隐（还能往那个方向滚才出现） */
    fades?: boolean
    titleId?: string
    /** 目录列表 id（aria-controls 指向它） */
    listId?: string
    /** 展开钮 id（宿主 Esc 收起浮层后把焦点还给它） */
    toggleId?: string
  }>(),
  {
    collapsed: false,
    railable: true,
    isActive: () => false,
    menu: false,
    link: false,
    fades: false,
    titleId: undefined,
    listId: undefined,
    toggleId: undefined,
  },
)

const emit = defineEmits<{
  /** 点收起 / 展开钮：宿主翻转 collapsed */
  toggle: []
  /** 非 railable 的关闭钮 */
  close: []
  select: [entry: DirectoryEntry, e: MouseEvent]
  /** 收起层鼠标进出 / 滚动 / 悬停 / 聚焦（宿主用来挂「一次性全部名字」气泡） */
  'rail-enter': []
  'rail-leave': []
  'rail-scroll': []
  'rail-hover': [entry: DirectoryEntry]
  'rail-focus': [entry: DirectoryEntry]
  'rail-blur': []
}>()

const rail = computed(() => props.railable && props.collapsed)
const layers = computed<('body' | 'rail')[]>(() => (props.railable ? ['body', 'rail'] : ['body']))
const isLive = (layer: 'body' | 'rail') => (layer === 'rail' ? rail.value : !rail.value)

/** 组头 / 收起态对应空位的高度：有组名 24；无组名首组 4、后续组 8（两层同高，条目纵向对齐） */
const leadHeight = (g: DirectoryGroup, gi: number) => (g.label ? 24 : gi ? 8 : 4)

const stageEl = ref<HTMLElement | null>(null)
const layerEls: Record<'body' | 'rail', HTMLElement | null> = { body: null, rail: null }
function setLayerEl(layer: 'body' | 'rail', el: unknown) {
  layerEls[layer] = el instanceof HTMLElement ? el : null
}
const wideBtn = ref<HTMLButtonElement | null>(null)
const railBtn = ref<HTMLButtonElement | null>(null)

function onToggle() {
  const wasCollapsed = rail.value
  emit('toggle')
  // 被点的那枚随即 inert，焦点会掉到 body：交给刚出现的那枚
  void nextTick(() => (wasCollapsed ? wideBtn.value : railBtn.value)?.focus())
}

// 上下渐隐
const fadeTop = ref(false)
const fadeBottom = ref(false)
function updateFades() {
  if (!props.fades) return
  const el = layerEls[rail.value ? 'rail' : 'body']
  if (!el) return
  fadeTop.value = el.scrollTop > 0
  fadeBottom.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1
}
let observer: ResizeObserver | null = null
function observe() {
  observer?.disconnect()
  observer = null
  if (!props.fades || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(updateFades)
  for (const el of Object.values(layerEls)) if (el) observer.observe(el)
}
watch(
  () => [props.groups, rail.value, props.fades] as const,
  () =>
    void nextTick(() => {
      observe()
      updateFades()
    }),
  { immediate: true, flush: 'post' },
)
onBeforeUnmount(() => observer?.disconnect())

function onScroll(layer: 'body' | 'rail') {
  if (!isLive(layer)) return
  updateFades()
  if (layer === 'rail') emit('rail-scroll')
}

defineExpose({ stageEl })

const BTN =
  'absolute top-10px grid h-28px w-28px place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer ' +
  'transition-opacity duration-120 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ' +
  'hover:(bg-surface3 text-ink) focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) ' +
  'after:(content-empty absolute -inset-2px)'
const EASE = 'ease-[cubic-bezier(0.4,0,0.2,1)]'
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <!-- 头：高 48；标题随收起淡出（90ms），两枚按钮钉死在各自位置交叉淡入淡出 -->
    <div class="relative h-48px flex-none">
      <h2
        :id="titleId"
        class="m-0 truncate pl-14px text-16px font-600 leading-48px text-ink transition-opacity duration-90 motion-reduce:transition-none"
        :class="[EASE, rail ? 'pointer-events-none opacity-0' : 'opacity-100 [transition-delay:60ms] motion-reduce:[transition-delay:0ms]', railable ? 'pr-44px' : 'pr-40px']"
      >
        {{ title }}
      </h2>
      <template v-if="railable">
        <button
          :id="toggleId ? `${toggleId}-collapse` : undefined"
          ref="wideBtn"
          type="button"
          :class="[BTN, 'left-123px', rail ? 'pointer-events-none opacity-0' : 'opacity-100 [transition-delay:60ms] motion-reduce:[transition-delay:0ms]']"
          aria-label="收起目录"
          title="收起目录"
          :aria-expanded="!rail"
          :aria-controls="listId"
          :aria-hidden="rail || undefined"
          :tabindex="rail ? -1 : undefined"
          :inert="rail || undefined"
          @click="onToggle"
        >
          <svg class="h-16px w-16px" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path stroke-miterlimit="10" d="M80 160h352M80 256h352M80 352h352" />
          </svg>
        </button>
        <button
          :id="toggleId"
          ref="railBtn"
          type="button"
          :class="[BTN, 'left-8px', rail ? 'opacity-100 [transition-delay:60ms] motion-reduce:[transition-delay:0ms]' : 'pointer-events-none opacity-0']"
          aria-label="展开目录"
          title="展开目录"
          :aria-expanded="!rail"
          :aria-controls="listId"
          :aria-hidden="!rail || undefined"
          :tabindex="rail ? undefined : -1"
          :inert="!rail || undefined"
          @click="onToggle"
        >
          <svg class="h-16px w-16px" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path stroke-width="48" d="M184 112l144 144-144 144" />
          </svg>
        </button>
      </template>
      <button
        v-else
        type="button"
        :class="[BTN, 'right-8px']"
        aria-label="收起目录"
        title="收起目录"
        @click="emit('close')"
      >
        <svg class="h-16px w-16px" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path stroke-miterlimit="10" d="M80 160h352M80 256h352M80 352h352" />
        </svg>
      </button>
    </div>

    <div :id="listId" ref="stageEl" class="relative min-h-0 flex-1">
      <span
        v-if="fades"
        class="pointer-events-none absolute inset-x-0 top-0 z-1 h-16px bg-[linear-gradient(var(--xq-surface),rgb(var(--xq-surface-rgb)/0))] transition-opacity duration-160 motion-reduce:transition-none"
        :class="fadeTop ? 'opacity-100' : 'opacity-0'"
        aria-hidden="true"
      />
      <div
        v-for="layer in layers"
        :key="layer"
        :ref="(el) => setLayerEl(layer, el)"
        class="absolute inset-y-0 left-0 overflow-y-auto transition-opacity duration-170 motion-reduce:transition-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        :class="[
          EASE,
          layer === 'body' ? 'w-160px px-8px pb-12px' : 'w-44px',
          isLive(layer) ? 'opacity-100' : 'pointer-events-none opacity-0',
        ]"
        :role="menu && isLive(layer) ? 'menu' : undefined"
        :aria-label="menu && isLive(layer) ? title : undefined"
        :aria-hidden="isLive(layer) ? undefined : 'true'"
        :inert="isLive(layer) ? undefined : true"
        @scroll="onScroll(layer)"
        @mouseenter="layer === 'rail' && emit('rail-enter')"
        @mouseleave="layer === 'rail' && emit('rail-leave')"
      >
        <section
          v-for="(g, gi) in groups"
          :key="g.key ?? g.label ?? gi"
          class="relative"
          :class="
            gi
              ? [
                  'before:(absolute top-0 h-1px bg-shell-line content-empty)',
                  layer === 'body' ? 'before:(-left-8px -right-8px)' : 'before:(left-0 right-0)',
                ]
              : ''
          "
        >
          <h3
            v-if="layer === 'body' && g.label"
            class="m-0 flex h-24px items-center whitespace-nowrap px-2px text-12px font-600 tracking-[.02em] text-muted"
          >
            {{ g.label }}
          </h3>
          <div v-else :style="{ height: `${leadHeight(g, gi)}px` }" aria-hidden="true" />
          <component :is="menu ? 'div' : 'ul'" class="m-0 list-none p-0" :role="menu ? 'none' : undefined">
            <component :is="menu ? 'div' : 'li'" v-for="e in g.entries" :key="e.key" :role="menu ? 'none' : undefined">
              <DirectoryItem
                :entry="e"
                :layer="layer"
                :active="isActive(e)"
                :live="isLive(layer)"
                :menu="menu"
                :link="link"
                @click="(e.route || e.hasChildren) && emit('select', e, $event)"
                @hover="layer === 'rail' && emit('rail-hover', e)"
                @focus="layer === 'rail' && emit('rail-focus', e)"
                @blur="layer === 'rail' && emit('rail-blur')"
              />
            </component>
          </component>
        </section>
      </div>
      <span
        v-if="fades"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-1 h-16px bg-[linear-gradient(to_top,var(--xq-surface),rgb(var(--xq-surface-rgb)/0))] transition-opacity duration-160 motion-reduce:transition-none"
        :class="fadeBottom ? 'opacity-100' : 'opacity-0'"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
