<script setup lang="ts">
/**
 * 带区域标签的提示词输入（原型 styles/scoped/CanvasIdentifyPanel.css）：
 * .identify-prompt 最矮 96 / 最高 220、r8、页面底色、13px 行高 1.6，聚焦描边转主色，空时显示占位；
 * .identify-chip 胶囊（序号徽标 + 裁切缩略图 + 标签最宽 72 省略 + ×），悬停浮出大图（.identify-chip__tooltip）。
 *
 * <p>DOM 只有文本节点与标签 span（contenteditable=false）：回车插入换行符、粘贴只收纯文本，
 * 序列化时标签换成 {{region_xxx}}，服务端据此替换成区域描述。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IActionRegion } from './imageActions.ts'
import { regionRect } from './imageActions.ts'

const props = defineProps<{
  regions: IActionRegion[]
  numberOf: (region: IActionRegion) => number
  disabled?: boolean
}>()

const emit = defineEmits<{ change: [] }>()

const editorRef = ref<HTMLElement | null>(null)
let savedRange: Range | null = null

// 动态创建的节点类名写成常量，供 UnoCSS 扫描
const CHIP =
  'group relative inline-flex items-center gap-4px max-w-full mx-2px px-6px py-1px rounded-full border border-solid border-line bg-white text-11px leading-16px align-middle select-none'
const CHIP_BADGE =
  'flex shrink-0 items-center justify-center min-w-14px h-14px px-3px rounded-7px bg-violet text-white text-11px leading-none'
const CHIP_CROP = 'block shrink-0 w-16px h-16px overflow-hidden rounded-3px bg-no-repeat'
const CHIP_LABEL = 'max-w-72px overflow-hidden whitespace-nowrap text-ellipsis text-ink-2'
const CHIP_CLOSE =
  'shrink-0 w-14px h-14px p-0 border-none rounded-7px bg-transparent text-muted text-12px leading-none cursor-pointer hover:bg-surface2 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus'
const CHIP_TIP =
  'absolute left-50% top-[calc(100%+6px)] z-20 hidden w-96px h-96px overflow-hidden rounded-8px border border-solid border-line bg-white bg-no-repeat -translate-x-50% pointer-events-none shadow-pop group-hover:block'

function cropStyle(el: HTMLElement, region: IActionRegion) {
  const rect = regionRect(region)
  const px = rect.w >= 1 ? 0 : (rect.x / (1 - rect.w)) * 100
  const py = rect.h >= 1 ? 0 : (rect.y / (1 - rect.h)) * 100
  el.style.backgroundImage = `url("${region.url.replace(/"/g, '%22')}")`
  el.style.backgroundSize = `${100 / rect.w}% ${100 / rect.h}%`
  el.style.backgroundPosition = `${px}% ${py}%`
}

function fillChip(chip: HTMLElement, region: IActionRegion) {
  const number = props.numberOf(region)
  const label = region.label || '未命名主体'
  chip.replaceChildren()
  chip.title = region.description ? `${label}：${region.description}` : label
  const badge = document.createElement('span')
  badge.className = CHIP_BADGE
  badge.textContent = String(number)
  const crop = document.createElement('span')
  crop.className = CHIP_CROP
  cropStyle(crop, region)
  const text = document.createElement('span')
  text.className = CHIP_LABEL
  text.textContent = label
  const close = document.createElement('button')
  close.type = 'button'
  close.className = CHIP_CLOSE
  close.textContent = '×'
  close.setAttribute('aria-label', `从提示词移除区域 ${number}`)
  close.addEventListener('click', (event) => {
    event.preventDefault()
    chip.remove()
    emit('change')
  })
  const tip = document.createElement('span')
  tip.className = CHIP_TIP
  tip.setAttribute('aria-hidden', 'true')
  cropStyle(tip, region)
  chip.append(badge, crop, text, close, tip)
}

function makeChip(region: IActionRegion): HTMLElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.dataset.regionKey = region.key
  chip.className = CHIP
  fillChip(chip, region)
  return chip
}

function chips(): HTMLElement[] {
  return Array.from(editorRef.value?.querySelectorAll<HTMLElement>('[data-region-key]') ?? [])
}

/** 区域被删 / 改名 / 重新编号：同步标签；已删的区域从提示词里移除 */
function syncChips() {
  for (const chip of chips()) {
    const region = props.regions.find((item) => item.key === chip.dataset.regionKey)
    if (!region || region.status !== 'done') chip.remove()
    else fillChip(chip, region)
  }
  emit('change')
}

watch(
  () => props.regions.map((region) => `${region.key}|${region.status}|${region.label}|${props.numberOf(region)}`),
  syncChips,
)

function saveRange() {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !editorRef.value) return
  const range = selection.getRangeAt(0)
  if (editorRef.value.contains(range.commonAncestorContainer)) savedRange = range.cloneRange()
}

function insertNode(node: Node) {
  const editor = editorRef.value
  if (!editor) return
  let range = savedRange
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  savedRange = range.cloneRange()
  emit('change')
}

/** 在光标处插入区域标签（光标不在输入框里时追加到末尾） */
function insertRegion(region: IActionRegion) {
  if (props.disabled) return
  editorRef.value?.focus()
  insertNode(makeChip(region))
  insertNode(document.createTextNode(' '))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    saveRange()
    insertNode(document.createTextNode('\n'))
  }
}

function onPaste(event: ClipboardEvent) {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text) return
  saveRange()
  insertNode(document.createTextNode(text))
}

function onInput() {
  const editor = editorRef.value
  // 清空后浏览器会留一个 <br>，去掉以显示占位
  if (editor && !editor.textContent && !chips().length) editor.replaceChildren()
  emit('change')
}

/** 序列化：文本原样，标签换成 {{region_xxx}}；返回引用到的区域 */
function serialize(): { text: string; regions: IActionRegion[] } {
  const used: IActionRegion[] = []
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) return ''
    const key = node.dataset.regionKey
    if (key) {
      const region = props.regions.find((item) => item.key === key)
      if (!region?.id) return ''
      if (!used.includes(region)) used.push(region)
      return `{{${region.id}}}`
    }
    if (node.tagName === 'BR') return '\n'
    const inner = Array.from(node.childNodes).map(walk).join('')
    return node.tagName === 'DIV' || node.tagName === 'P' ? `\n${inner}` : inner
  }
  const editor = editorRef.value
  const text = editor ? Array.from(editor.childNodes).map(walk).join('') : ''
  return { text: text.replace(/^\n/, ''), regions: used }
}

onMounted(() => document.addEventListener('selectionchange', saveRange))
onBeforeUnmount(() => document.removeEventListener('selectionchange', saveRange))

defineExpose({ insertRegion, serialize })
</script>

<template>
  <div
    ref="editorRef"
    class="min-h-96px max-h-220px overflow-y-auto px-10px py-8px rounded-8px border border-solid border-line bg-page text-ink-2 text-13px leading-[1.6] whitespace-pre-wrap break-words outline-none focus:border-violet focus:shadow-focus empty:before:content-[attr(data-placeholder)] empty:before:text-placeholder"
    :contenteditable="disabled ? 'false' : 'true'"
    role="textbox"
    aria-multiline="true"
    aria-label="编辑要求"
    data-placeholder="写下要怎么改，例如：把区域 1 换成红色。点区域旁的「插入」引用它"
    @keydown="onKeydown"
    @paste="onPaste"
    @input="onInput"
    @blur="saveRange"
  />
</template>
