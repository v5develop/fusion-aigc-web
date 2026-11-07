<script setup lang="ts">
/**
 * 画布工具条自定义提示（原型 .wf-canvas-tip）：深色气泡 #1f2329 / 11px / r6，悬停或键盘聚焦约 300ms 后出现，
 * 可带快捷键徽标。只认 root 内带 data-tip 的元素，零侵入：
 *
 *   <IconButton label="撤销" no-title data-tip="撤销" data-tip-key="Mod+Z" />
 *   <div data-tip-side="right">…左竖工具条里的按钮，气泡出现在按钮右侧…</div>
 *
 * - data-tip-key 用「+」分段，每段一个 kbd；Mod 在 macOS 显示 ⌘，其余平台显示 Ctrl。
 * - 只是视觉提示：读屏仍读按钮自身的 aria-label，这里 aria-hidden，不抢焦点也不接收指针。
 * - 出现时临时摘掉目标的原生 title（避免两个提示叠在一起），收起时还原。
 * - 减少动态效果时不做淡入。
 */
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ root: HTMLElement | null }>()

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
const DELAY = 300

const tip = ref<{ label: string; keys: string[]; x: number; y: number; side: 'top' | 'bottom' | 'right' } | null>(null)
const tipEl = ref<HTMLElement | null>(null)
let timer = 0
let target: HTMLElement | null = null
let nativeTitle: string | null = null

function keysOf(raw: string): string[] {
  return raw
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => (k === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : k))
}

function hide() {
  window.clearTimeout(timer)
  timer = 0
  if (target && nativeTitle != null) target.setAttribute('title', nativeTitle)
  target = null
  nativeTitle = null
  tip.value = null
}

function show(el: HTMLElement) {
  if (el === target) return
  hide()
  const label = el.dataset.tip?.trim()
  if (!label) return
  target = el
  const t = el.getAttribute('title')
  if (t != null) {
    nativeTitle = t
    el.removeAttribute('title')
  }
  timer = window.setTimeout(() => {
    if (!target || !target.isConnected) return
    const r = target.getBoundingClientRect()
    const right = Boolean(target.closest('[data-tip-side="right"]'))
    const keys = keysOf(target.dataset.tipKey ?? '')
    if (right) {
      tip.value = { label, keys, x: Math.round(r.right + 10), y: Math.round(r.top + r.height / 2), side: 'right' }
    } else {
      const below = r.top < 54
      tip.value = {
        label,
        keys,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(below ? r.bottom + 8 : r.top - 8),
        side: below ? 'bottom' : 'top',
      }
    }
    // 贴边时夹回视口
    requestAnimationFrame(() => {
      const box = tipEl.value
      const cur = tip.value
      if (!box || !cur) return
      if (cur.side === 'right') {
        const maxX = window.innerWidth - box.offsetWidth - 8
        if (cur.x > maxX) tip.value = { ...cur, x: Math.max(8, maxX) }
        return
      }
      const half = box.offsetWidth / 2 + 8
      const clamped = Math.round(Math.min(Math.max(cur.x, half), window.innerWidth - half))
      if (clamped !== cur.x) tip.value = { ...cur, x: clamped }
    })
  }, DELAY)
}

function tipTargetOf(node: EventTarget | null): HTMLElement | null {
  const el = (node as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null
  return el && props.root?.contains(el) ? el : null
}

function onOver(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const el = tipTargetOf(event.target)
  if (el) show(el)
}

function onOut(event: PointerEvent) {
  if (!target) return
  const next = event.relatedTarget as Node | null
  if (next && target.contains(next)) return
  hide()
}

function onFocusIn(event: FocusEvent) {
  const el = tipTargetOf(event.target)
  // 只在键盘聚焦时出（鼠标点按钮也会聚焦，那时已经走悬停逻辑）
  if (el && el.matches(':focus-visible')) show(el)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') hide()
}

let bound: HTMLElement | null = null
function bind(el: HTMLElement | null) {
  if (bound) {
    bound.removeEventListener('pointerover', onOver)
    bound.removeEventListener('pointerout', onOut)
    bound.removeEventListener('focusin', onFocusIn)
    bound.removeEventListener('focusout', hide)
    bound.removeEventListener('pointerdown', hide, true)
    bound.removeEventListener('wheel', hide)
  }
  bound = el
  if (!el) return
  el.addEventListener('pointerover', onOver)
  el.addEventListener('pointerout', onOut)
  el.addEventListener('focusin', onFocusIn)
  el.addEventListener('focusout', hide)
  el.addEventListener('pointerdown', hide, true)
  el.addEventListener('wheel', hide, { passive: true })
}

watch(() => props.root, bind, { immediate: true })
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  bind(null)
  hide()
  window.removeEventListener('keydown', onKey)
})

const TRANSFORM = { top: 'translate(-50%, -100%)', bottom: 'translate(-50%, 0)', right: 'translate(0, -50%)' }
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tip"
      ref="tipEl"
      class="fixed z-[7000] flex items-center gap-8px px-9px py-6px border border-solid border-white/12 rounded-6px bg-[#1f2329] text-white text-11px leading-16px whitespace-nowrap pointer-events-none shadow-[0_6px_18px_rgba(0,0,0,0.24)] animate-[canvas-editor-fade_120ms_ease-out] motion-reduce:animate-none"
      :style="{ left: `${tip.x}px`, top: `${tip.y}px`, transform: TRANSFORM[tip.side] }"
      aria-hidden="true"
    >
      <span>{{ tip.label }}</span>
      <span v-if="tip.keys.length" class="flex items-center gap-3px">
        <kbd
          v-for="(k, i) in tip.keys"
          :key="i"
          class="px-5px py-1px border border-solid border-white/20 rounded-4px bg-white/14 text-[#e5e7eb] font-inherit text-10px leading-14px"
          >{{ k }}</kbd
        >
      </span>
    </div>
  </Teleport>
</template>
