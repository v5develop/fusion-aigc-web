<script setup lang="ts" generic="V extends string | number">
/**
 * 自绘向上浮层下拉（对齐商拍换装 长度 / 袖长 的 .dm-pick：左侧灰色标签、向上弹出、选中浅紫、点外面 / Esc 收起并把焦点还给触发钮）。
 * 触发钮与选项都是 32 高（§10 命中区下限）。键盘：触发钮上 ↑ / ↓ 打开并聚焦当前项；列表里 ↑ / ↓ 移动（跳过禁用、首尾循环）、
 * Home / End 到首尾、Enter / 空格选中、Tab 收起。
 * 姿态复刻的逐人配对用；商拍换装页自带一份内联实现，不动它。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export interface PickOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
}

const props = defineProps<{
  options: PickOption<V>[]
  label: string
  ariaLabel?: string
  disabled?: boolean
}>()
const model = defineModel<V>({ required: true })

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const current = computed(() => props.options.find((o) => o.value === model.value)?.label ?? '')

function close(restoreFocus = false) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function choose(o: PickOption<V>) {
  if (o.disabled) return
  model.value = o.value
  close(true)
}
const list = ref<HTMLElement | null>(null)

function optionEls(): HTMLButtonElement[] {
  return [...(list.value?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])]
}

/** 打开并把焦点放到选中项（没有选中项 / 选中项禁用时放第一项） */
async function openList() {
  if (props.disabled) return
  open.value = true
  await nextTick()
  const els = optionEls()
  ;(els.find((el) => el.getAttribute('aria-selected') === 'true') ?? els[0])?.focus()
}

function toggle() {
  if (open.value) close()
  else void openList()
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  void openList()
}

function onListKey(e: KeyboardEvent) {
  const els = optionEls()
  if (!els.length) return
  const at = els.indexOf(document.activeElement as HTMLButtonElement)
  let next = -1
  if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % els.length
  else if (e.key === 'ArrowUp') next = at < 0 ? els.length - 1 : (at - 1 + els.length) % els.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = els.length - 1
  else if (e.key === 'Tab') {
    close()
    return
  }
  if (next < 0) return
  e.preventDefault()
  els[next]!.focus()
}

function onOutside(e: Event) {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = false
}
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  e.preventDefault()
  close(true)
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onEsc, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onEsc, true)
})
</script>

<template>
  <span ref="root" class="relative flex min-w-0 flex-1">
    <button
      ref="trigger"
      type="button"
      class="flex h-32px w-full min-w-0 cursor-pointer items-center gap-6px box-border pl-10px pr-8px rounded-6px border border-solid bg-white text-12px text-ink sx-focus disabled:(cursor-not-allowed opacity-50)"
      :class="open ? 'border-violet' : 'border-line'"
      :disabled="disabled"
      :aria-label="ariaLabel ?? label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span class="shrink-0 text-12px text-placeholder">{{ label }}</span>
      <b class="min-w-0 flex-1 overflow-hidden text-left text-12px font-400 whitespace-nowrap text-ellipsis">{{
        current
      }}</b>
      <svg
        class="h-10px w-10px shrink-0 text-placeholder transition-transform duration-160 motion-reduce:transition-none"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <div
      v-if="open"
      ref="list"
      role="listbox"
      :aria-label="ariaLabel ?? label"
      class="absolute left-0 bottom-[calc(100%+4px)] z-24 box-border max-h-260px min-w-full overflow-y-auto overscroll-contain rounded-8px border border-solid border-line bg-white p-4px shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)]"
      @keydown="onListKey"
    >
      <button
        v-for="o in options"
        :key="o.value"
        type="button"
        role="option"
        :aria-selected="o.value === model"
        :tabindex="o.value === model ? 0 : -1"
        :disabled="o.disabled"
        class="block h-32px w-full cursor-pointer box-border rounded-5px border-0 px-8px text-left text-12px whitespace-nowrap sx-focus disabled:(cursor-not-allowed opacity-45)"
        :class="
          o.value === model
            ? 'bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] text-violet-ink'
            : 'bg-transparent text-ink-2 enabled:hover:bg-surface3'
        "
        @click="choose(o)"
      >
        {{ o.label }}
      </button>
    </div>
  </span>
</template>
