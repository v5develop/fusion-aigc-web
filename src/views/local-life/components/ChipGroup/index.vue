<script setup lang="ts" generic="V extends string | number">
/**
 * 本地生活单选胶囊组（原型 StudioParamCard 的 chip：内容类型 / 风格 / 行业 / 笔记类型 / 海报类型…）。
 *
 * <p>外观：高 28、内边距 0 12、全圆角、13px（StudioParamCard.vue:198-216，v3-theme.css:69 把 typo-product 定为 13）；
 * 常态描边 #c9cfd6、底 #f7f8f9（ui-design-spec §4.1「胶囊标签」）；hover 描边 violet-line、字 violet-ink；
 * 选中 violet-line / violet-soft / violet-ink 600；胶囊间距 8（`flex-wrap gap-2`）。
 * 语义为 radiogroup + radio，方向键在组内移动。传 emptyLabel 时在最前面放一颗「空值」胶囊（选填项）。
 */
import { computed, ref, useId } from 'vue'

interface ChipOption {
  label: string
  value: V
  disabled?: boolean
}

const {
  options,
  label,
  emptyLabel = '',
  emptyValue,
  disabled = false,
} = defineProps<{
  options: readonly ChipOption[]
  /** 无障碍名称（卡头已有可见标题时也要传） */
  label: string
  /** 选填项的「空值」胶囊文案；不传不出 */
  emptyLabel?: string
  /** 「空值」胶囊写回的值；不传时字符串组写 ''、数字组写 undefined */
  emptyValue?: '' | null
  disabled?: boolean
}>()

const model = defineModel<V | '' | null | undefined>()

const uid = useId()
const EMPTY = Symbol('empty')
type Item = { key: string; label: string; value: V | typeof EMPTY; disabled?: boolean }

const items = computed<Item[]>(() => [
  ...(emptyLabel ? [{ key: `${uid}-empty`, label: emptyLabel, value: EMPTY } as Item] : []),
  ...options.map((o) => ({ key: `${uid}-${String(o.value)}`, label: o.label, value: o.value, disabled: o.disabled })),
])

const isEmpty = computed(() => model.value === '' || model.value == null)
function isOn(item: Item) {
  return item.value === EMPTY ? isEmpty.value : model.value === item.value
}

function pick(item: Item) {
  if (disabled || item.disabled) return
  if (item.value !== EMPTY) model.value = item.value
  else if (emptyValue !== undefined) model.value = emptyValue
  else model.value = typeof options[0]?.value === 'number' ? undefined : ''
}

const btnRefs = ref<HTMLButtonElement[]>([])
function onKeydown(event: KeyboardEvent, index: number) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const list = items.value
  for (let i = 1; i <= list.length; i++) {
    const next = (index + step * i + list.length) % list.length
    if (!list[next]!.disabled) {
      pick(list[next]!)
      btnRefs.value[next]?.focus()
      return
    }
  }
}

/** 漫游焦点：选中项可 Tab 进入；都没选时第一项可进入 */
const focusIndex = computed(() => Math.max(0, items.value.findIndex(isOn)))
</script>

<template>
  <div role="radiogroup" :aria-label="label" :aria-disabled="disabled || undefined" class="flex flex-wrap gap-8px">
    <button
      v-for="(item, index) in items"
      :key="item.key"
      ref="btnRefs"
      type="button"
      role="radio"
      :aria-checked="isOn(item)"
      :tabindex="index === focusIndex ? 0 : -1"
      :disabled="disabled || item.disabled"
      class="inline-flex items-center h-28px max-w-full box-border px-12px rounded-full border border-solid text-13px leading-18px whitespace-nowrap cursor-pointer select-none outline-none transition-[background,border-color,color] duration-fast ease-sx motion-reduce:transition-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-45 cursor-not-allowed)"
      :class="
        isOn(item)
          ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
          : 'border-control bg-surface2 font-400 text-ink-2 enabled:hover:(border-violet-line text-violet-ink)'
      "
      @click="pick(item)"
      @keydown="onKeydown($event, index)"
    >
      <span class="truncate">{{ item.label }}</span>
    </button>
  </div>
</template>
