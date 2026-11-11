<script setup lang="ts">
/**
 * 提交按钮上方的「选一项」字段卡（原型 components/tool/ChoiceFieldButton picker 版）：图片翻译 / 视频翻译的目标语言、配音音色。
 *
 * <p>卡 = 44 高 sx-field-btn（与底部「模型 / 视频设置」同一档）：图标 13 · 字段名 11 muted · 右对齐当前值 11/500 · 箭头。
 * 点开贴着卡弹面板（宽 = 卡宽，上方放得下就往上开），出现 / 收起 120ms 淡入 + 4px 上移，减少动效时直接出现：
 * - `grid`：长列表（语言）三列 34 高格子，顶部带搜索（≥9 项时出现），一屏看完；
 * - `list`：一列 44 高行（音色：名字 · 女声 / 男声 + 副标题），行尾可带「试听」钮（每行两个按钮，面板按 dialog 处理）。
 * Esc / 点外面 / 窗口缩放或页面滚动收起；面板里 ↑↓ 换焦点，选中即关并把焦点还给卡。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

export interface ToolChoiceOption {
  label: string
  value: string | number
  /** list 版第二行说明 */
  description?: string
  /** 有试听源时行尾出「试听」 */
  audition?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | undefined
    options: ToolChoiceOption[]
    label: string
    icon?: 'language' | 'voice'
    layout?: 'grid' | 'list'
    disabled?: boolean
    placeholder?: string
    required?: boolean
  }>(),
  { icon: 'language', layout: 'list', disabled: false, placeholder: '请选择', required: false },
)
const emit = defineEmits<{ 'update:modelValue': [string | number]; audition: [string | number] }>()

const uid = useId()
const panelId = `tool-choice-${uid}`
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')
const panelStyle = ref<Record<string, string>>({})

const current = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null)
const searchable = computed(() => props.layout === 'grid' && props.options.length >= 9)
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options
})

const GAP = 6
function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.round(rect.width)
  const rows = props.layout === 'grid' ? Math.ceil(props.options.length / 3) : props.options.length
  const want = 12 + (searchable.value ? 42 : 0) + rows * (props.layout === 'grid' ? 38 : 52)
  const vh = window.innerHeight
  const above = rect.top - GAP - 12
  const below = vh - rect.bottom - GAP - 12
  const up = above >= want || above >= below
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
  panelStyle.value = {
    left: `${Math.round(left)}px`,
    width: `${width}px`,
    maxHeight: `${Math.round(Math.max(160, Math.min(420, up ? above : below)))}px`,
    ...(up ? { bottom: `${Math.round(vh - rect.top + GAP)}px` } : { top: `${Math.round(rect.bottom + GAP)}px` }),
  }
}

async function toggle() {
  if (props.disabled) return
  if (open.value) return close(false)
  query.value = ''
  place()
  open.value = true
  await nextTick()
  if (searchable.value) searchEl.value?.focus({ preventScroll: true })
  else panel.value?.querySelector<HTMLElement>('[data-on="true"]')?.focus({ preventScroll: true })
}

function close(refocus = true) {
  open.value = false
  if (refocus) trigger.value?.focus({ preventScroll: true })
}

function choose(v: string | number) {
  emit('update:modelValue', v)
  close()
}

function moveFocus(delta: number) {
  const rows = [...(panel.value?.querySelectorAll<HTMLElement>('[data-choice-opt]') ?? [])]
  if (!rows.length) return
  const at = rows.indexOf(document.activeElement as HTMLElement)
  const next = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : (at + delta + rows.length) % rows.length
  rows[next]?.focus()
}

function onDocPointer(e: PointerEvent) {
  if (!open.value || !(e.target instanceof Node)) return
  if (trigger.value?.contains(e.target) || panel.value?.contains(e.target)) return
  close(false)
}
/** 焦点移出弹层与触发钮（Tab 走开）就收起；relatedTarget 为空（点非聚焦区域）交给 pointerdown 判断 */
function onFocusOut(e: FocusEvent) {
  if (!open.value) return
  const to = e.relatedTarget
  if (!(to instanceof Node)) return
  if (trigger.value?.contains(to) || panel.value?.contains(to)) return
  close(false)
}
function onViewport(e?: Event) {
  if (!open.value) return
  if (e?.target instanceof Node && panel.value?.contains(e.target)) return
  close(false)
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  window.addEventListener('resize', onViewport)
  window.addEventListener('scroll', onViewport, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  window.removeEventListener('resize', onViewport)
  window.removeEventListener('scroll', onViewport, true)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="sx-field-btn relative min-w-0 w-full box-border gap-6px [transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease] motion-reduce:transition-none disabled:(opacity-50 cursor-not-allowed)"
    :class="
      open
        ? '!border-control-press !bg-[linear-gradient(var(--xq-surface3),var(--xq-surface2))] !shadow-[inset_0_1px_2px_rgba(31,35,41,0.12),inset_0_0_0_1px_rgba(31,35,41,0.03)]'
        : ''
    "
    :disabled="disabled"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-controls="open ? panelId : undefined"
    :aria-label="`${label}：${current?.label ?? placeholder}`"
    @click="toggle"
    @focusout="onFocusOut"
    @keydown.esc="open && ($event.stopPropagation(), close())"
    @keydown.down.prevent="!open && toggle()"
  >
    <svg
      class="flex-none w-13px h-13px text-violet"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <template v-if="icon === 'voice'">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </template>
      <template v-else>
        <path d="M4 5h9M8.5 3v2M6 5c.6 3.6 3 6.4 6 7.5M11 5c-.7 3.8-3.4 6.9-7 8" />
        <path d="M12.5 21l4-9 4 9M14 17.5h5" />
      </template>
    </svg>
    <span class="flex-none text-12px font-400 leading-18px text-muted"
      >{{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></span
    >
    <span
      class="ml-auto min-w-0 truncate text-right text-13px font-500 leading-18px text-ink-2"
      :title="current?.label"
      >{{ current?.label ?? placeholder }}</span
    >
    <svg
      class="absolute right-8px top-1/2 -mt-6px w-12px h-12px text-muted transition-transform duration-150 motion-reduce:transition-none"
      :class="open ? 'rotate-180' : ''"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  <Teleport to="body">
    <Transition
      enter-active-class="[transition:opacity_120ms_ease,transform_120ms_ease] motion-reduce:transition-none"
      enter-from-class="opacity-0 translate-y-4px"
      leave-active-class="[transition:opacity_120ms_ease,transform_120ms_ease] motion-reduce:transition-none"
      leave-to-class="opacity-0 translate-y-4px"
    >
      <div
        v-if="open"
        :id="panelId"
        ref="panel"
        role="dialog"
        :aria-label="label"
        class="sx-squircle fixed z-[6000] flex flex-col box-border overflow-hidden rounded-18px border border-solid border-line bg-overlay shadow-pop"
        :style="panelStyle"
        @focusout="onFocusOut"
        @keydown.esc.stop.prevent="close()"
        @keydown.down.prevent="moveFocus(1)"
        @keydown.up.prevent="moveFocus(-1)"
      >
        <div v-if="searchable" class="flex-none px-6px pt-6px">
          <input
            ref="searchEl"
            v-model="query"
            type="search"
            class="sx-input w-full box-border !h-32px !text-12px"
            :placeholder="`搜索${label}`"
            :aria-label="`搜索${label}`"
            @keydown.enter.prevent="shown.length === 1 && choose(shown[0]!.value)"
          />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-6px [scrollbar-width:thin] [overscroll-behavior:contain]">
          <p v-if="!shown.length" class="m-0 py-14px text-center text-12px text-muted">没有匹配的{{ label }}</p>
          <div v-else-if="layout === 'grid'" class="grid grid-cols-3 gap-4px">
            <button
              v-for="o in shown"
              :key="o.value"
              type="button"
              data-choice-opt
              :data-on="o.value === modelValue"
              :aria-pressed="o.value === modelValue"
              class="h-34px min-w-0 box-border px-8px rounded-10px border border-solid text-12px font-500 truncate cursor-pointer sx-focus"
              :class="
                o.value === modelValue
                  ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-violet-ink font-600'
                  : 'border-transparent bg-transparent text-ink hover:bg-surface3'
              "
              :title="o.label"
              @click="choose(o.value)"
            >
              {{ o.label }}
            </button>
          </div>
          <ul v-else class="m-0 p-0 list-none flex flex-col gap-2px">
            <li
              v-for="o in shown"
              :key="o.value"
              class="flex items-center gap-6px min-h-44px box-border pr-6px rounded-10px border border-solid"
              :class="
                o.value === modelValue
                  ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                  : 'border-transparent hover:bg-surface3'
              "
            >
              <button
                type="button"
                data-choice-opt
                :data-on="o.value === modelValue"
                :aria-pressed="o.value === modelValue"
                class="flex-1 min-w-0 self-stretch flex flex-col justify-center box-border px-10px py-6px rounded-10px border-none bg-transparent text-left cursor-pointer sx-focus"
                @click="choose(o.value)"
              >
                <span
                  class="truncate text-13px leading-18px"
                  :class="o.value === modelValue ? 'text-violet-ink font-600' : 'text-ink font-500'"
                  >{{ o.label }}</span
                >
                <span v-if="o.description" class="truncate text-11px leading-16px text-muted">{{ o.description }}</span>
              </button>
              <button
                v-if="o.audition"
                type="button"
                class="sx-btn flex-none !h-32px !px-10px !text-12px"
                :aria-label="`试听${o.label}`"
                @click="emit('audition', o.value)"
              >
                试听
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
