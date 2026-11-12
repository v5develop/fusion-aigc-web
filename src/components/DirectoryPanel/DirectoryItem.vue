<script setup lang="ts">
/**
 * 功能目录条目（展开 body 层 / 收起 rail 层共用）。
 *
 * - 展开：行高 44，图标 20（24 盒），文字 14/500，gap 12；选中不铺整行，只在图标外画 36×36 内凹砖（inset -6）。
 * - 收起：44 宽列，图标 20、ink 色；悬停 / 选中同一块 36×36 砖。
 * - 图标盒在两层里的 x 中心都是 22，切换时图标不横移。
 * - 可点条目：link 时渲染 RouterLink，否则 button；不可点的渲染 div + aria-disabled。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { DirectoryEntry } from './types'

const props = defineProps<{
  entry: DirectoryEntry
  layer: 'body' | 'rail'
  active: boolean
  /** 本层是否可见 / 可交互（决定是否挂 data-panel-node、data-rail-id、menuitem 角色） */
  live: boolean
  /** 目录按 role=menu 暴露（键盘上下键由宿主处理，节点用 data-panel-node 标记） */
  menu: boolean
  /** 可点条目用 RouterLink（地址可复制 / 新标签打开）；否则用 button */
  link: boolean
}>()

const emit = defineEmits<{
  click: [e: MouseEvent]
  hover: []
  focus: []
  blur: []
}>()

const clickable = computed(() => !!props.entry.route || !!props.entry.hasChildren)
const tag = computed(() => (!clickable.value ? 'div' : props.link && props.entry.route ? RouterLink : 'button'))
const attrs = computed(() => {
  const e = props.entry
  const a: Record<string, unknown> = {}
  if (!clickable.value) a['aria-disabled'] = 'true'
  else if (tag.value === 'button') a.type = 'button'
  else a.to = e.route
  if (props.active && !e.hasChildren) a['aria-current'] = 'page'
  return a
})
const label = computed(() => {
  const e = props.entry
  if (e.ariaLabel) return e.ariaLabel
  if (!clickable.value) return `${e.name}（即将开放）`
  return props.layer === 'rail' ? e.name : undefined
})
const ink = computed(() => (clickable.value ? 'text-ink' : 'text-muted opacity-60'))
</script>

<template>
  <component
    :is="tag"
    v-bind="attrs"
    :role="menu && live ? 'menuitem' : undefined"
    :data-panel-node="menu && live && clickable ? '' : undefined"
    :data-rail-id="layer === 'rail' && live ? entry.key : undefined"
    :aria-label="label"
    :title="layer === 'body' ? entry.title : undefined"
    class="group relative box-border flex items-center border-0 bg-transparent p-0 text-left no-underline outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-[-2px])"
    :class="[
      layer === 'rail'
        ? 'h-44px w-44px flex-none justify-center'
        : 'h-44px w-full gap-12px rounded-6px pr-8px ' + (entry.icon ? 'pl-2px' : 'pl-10px'),
      clickable ? 'cursor-pointer' : 'cursor-not-allowed',
      layer === 'body' && clickable ? 'hover:bg-surface3' : '',
    ]"
    @click="emit('click', $event)"
    @mouseenter="emit('hover')"
    @focus="emit('focus')"
    @blur="emit('blur')"
  >
    <span
      v-if="entry.icon || layer === 'rail'"
      class="relative grid h-24px w-24px flex-none place-items-center"
      :class="ink"
      aria-hidden="true"
    >
      <!-- 36×36 内凹砖：选中用 ACTIVE 材质（sx-grad-sunk + shadow-sunk + line 描边）；收起态悬停给浅底 -->
      <i
        class="pointer-events-none absolute -inset-6px rounded-6px border border-solid"
        :class="
          active
            ? 'border-line sx-grad-sunk shadow-sunk'
            : layer === 'rail' && clickable
              ? 'border-transparent bg-transparent group-hover:bg-surface3'
              : 'border-transparent'
        "
      />
      <svg
        v-if="entry.icon"
        class="relative h-20px w-20px"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        :innerHTML="entry.icon"
      />
      <span v-else class="relative text-14px font-600 leading-none">{{ entry.name.slice(0, 1) }}</span>
    </span>
    <template v-if="layer === 'body'">
      <span class="min-w-0 flex-1 truncate text-14px font-500 leading-20px" :class="clickable ? 'text-ink' : 'text-muted'">
        {{ entry.name }}
      </span>
      <svg
        v-if="entry.hasChildren"
        class="h-12px w-12px flex-none text-placeholder"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
      </svg>
    </template>
  </component>
</template>
