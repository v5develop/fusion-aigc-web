<script setup lang="ts">
/**
 * 「按住看原图」：按住期间校色图换成未校色的原图，松开恢复（cf.peeking，不改任何参数）。
 * 指针：按下即看、抬起 / 取消 / 移出即还原；键盘：空格 / 回车按下看、抬起还原；失焦也还原。
 * 参数台标题栏可拖动，所以这里把 pointerdown 拦在按钮上，不触发拖动。
 */
import type { ResultColorFix } from './useResultColorFix.ts'

const props = defineProps<{ cf: ResultColorFix }>()
// cf 是引擎实例（对象内的 ref），不是 prop 本身；取出 ref 再写
const peeking = props.cf.peeking

function down(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  peeking.value = true
}
function up() {
  peeking.value = false
}
function keydown(e: KeyboardEvent) {
  if (e.key !== ' ' && e.key !== 'Enter') return
  e.preventDefault() // 不触发原生 click；也不让空格滚页面
  e.stopPropagation()
  if (!e.repeat) peeking.value = true
}
function keyup(e: KeyboardEvent) {
  if (e.key !== ' ' && e.key !== 'Enter') return
  e.preventDefault()
  peeking.value = false
}
</script>

<template>
  <button
    type="button"
    class="inline-flex h-24px flex-none cursor-pointer select-none items-center gap-4px rounded-12px border border-solid px-8px text-11px font-500 leading-none touch-none [transition:background_120ms,border-color_120ms,color_120ms] motion-reduce:transition-none sx-hit sx-focus"
    :class="
      peeking
        ? 'border-violet bg-violet-soft text-violet-ink'
        : 'border-line bg-surface text-ink-2 hover:(border-violet-line text-violet-ink)'
    "
    :aria-pressed="peeking"
    title="按住看未校色的原图，松开恢复（也可按住空格）"
    @pointerdown.stop.prevent="down"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture="up"
    @keydown="keydown"
    @keyup="keyup"
    @blur="up"
    @contextmenu.prevent
  >
    <svg
      class="h-12px w-12px"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
    按住看原图
  </button>
</template>
