<script setup lang="ts" generic="K extends string | boolean">
/**
 * 本地生活分段控件（原型 `.sx-seg--picker` / SettingsPopover 分段轨道，ui-design-spec §4.1）。
 *
 * <p>轨道：整宽等分网格，内边距 3、gap 2、r6、底 #f3f4f5 + 输入内凹（sx-seg）；
 * 选项高 30、r4（sx-seg-item），选中 = violet-line 描边 + 白→#f8f3fc 渐变 + `0 1px 2px rgba(31,35,41,.05)` + violet-ink 600
 * （sx-seg-on，同全案页「预览 / 历史」页签）；过渡 300ms (.4,0,.2,1)（duration-seg ease-std）。
 * size=md 用于页面主切换（13px），sm 用于卡内的来源切换（12px）。
 * 语义为 radiogroup + radio，方向键切换并移动焦点。
 */
import { ref } from 'vue'

const {
  options,
  label,
  size = 'sm',
} = defineProps<{
  options: readonly { key: K; label: string }[]
  /** 无障碍名称 */
  label: string
  size?: 'sm' | 'md'
}>()

const model = defineModel<K>({ required: true })

/** 等分列（UnoCSS 只认静态类名） */
const COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }

const btnRefs = ref<HTMLButtonElement[]>([])
function onKeydown(event: KeyboardEvent, index: number) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const next = (index + step + options.length) % options.length
  model.value = options[next]!.key
  btnRefs.value[next]?.focus()
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="label"
    class="sx-seg !grid w-full box-border"
    :class="COLS[options.length] ?? 'grid-flow-col auto-cols-fr'"
  >
    <button
      v-for="(opt, index) in options"
      :key="String(opt.key)"
      ref="btnRefs"
      type="button"
      role="radio"
      :aria-checked="model === opt.key"
      :tabindex="model === opt.key ? 0 : -1"
      class="sx-seg-item min-w-0 !px-8px bg-transparent sx-focus"
      :class="[
        size === 'md' ? '!text-13px' : '!text-12px',
        model === opt.key ? 'sx-seg-on' : 'font-500 !text-muted hover:!text-ink',
      ]"
      @click="model = opt.key"
      @keydown="onKeydown($event, index)"
    >
      <span class="truncate">{{ opt.label }}</span>
    </button>
  </div>
</template>
