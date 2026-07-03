<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { PromptSlot, FileItem } from './types'
import { buildSelectHTML, showDropdown, closeAllDropdowns } from './slots/select'
import { buildUploadHTML, updateUploadBlockDOM } from './slots/upload'

const slots = defineModel<PromptSlot[]>('slots', { required: true })

const surfaceRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

let pendingUploadLabel = ''

// ========== 渲染 ==========

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function renderSlots(list: PromptSlot[]) {
  const el = surfaceRef.value
  if (!el) return
  el.innerHTML = list
    .map((s) => {
      if (s.type === 'text') return escapeHtml(s.value)
      if (s.type === 'select') return buildSelectHTML(s)
      if (s.type === 'upload') return buildUploadHTML(s.label, s.value)
      return ''
    })
    .join('')
}

// ========== 解析 ==========

function parseSlotsFromDOM(): PromptSlot[] {
  const el = surfaceRef.value
  if (!el) return []

  const result: PromptSlot[] = []
  const nodes = Array.from(el.childNodes)

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/​/g, '')
      if (text) {
        const last = result[result.length - 1]
        if (last && last.type === 'text') {
          last.value += text
        } else {
          result.push({ type: 'text', value: text })
        }
      }
    } else if (node instanceof HTMLElement && node.classList.contains('ps-slot')) {
      const slotType = node.getAttribute('data-slot-type')
      if (slotType === 'select') {
        result.push({
          type: 'select',
          label: node.getAttribute('data-slot-label') || '',
          value: node.getAttribute('data-slot-value') || '',
          options: JSON.parse(node.getAttribute('data-slot-options') || '[]'),
        })
      } else if (slotType === 'upload') {
        const label = node.getAttribute('data-slot-label') || ''
        const existing = slots.value.find((s): s is typeof s & { type: 'upload' } =>
          s.type === 'upload' && s.label === label,
        )
        result.push({
          type: 'upload',
          label,
          value: existing ? existing.value : [],
          limit: existing?.limit ?? 5,
        })
      }
    }
  }

  return result
}

let suppressRender = false

function syncFromDOM() {
  suppressRender = true
  slots.value = parseSlotsFromDOM()
}

// ========== 事件处理 ==========

function onInput() {
  // 文字编辑由浏览器原生处理，不需要同步 DOM
}

function findPrevRealNode(node: Node | null): Node | null {
  let prev = node?.previousSibling ?? null
  while (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent || '') === '​') {
    prev = prev.previousSibling
  }
  return prev
}

function findNextRealNode(node: Node | null): Node | null {
  let next = node?.nextSibling ?? null
  while (next && next.nodeType === Node.TEXT_NODE && (next.textContent || '') === '​') {
    next = next.nextSibling
  }
  return next
}

function mergeAdjacentText() {
  const el = surfaceRef.value
  if (!el) return
  const nodes = Array.from(el.childNodes)
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]
    const b = nodes[i + 1]
    if (!a || !b) continue
    if (a.nodeType === Node.TEXT_NODE && b.nodeType === Node.TEXT_NODE) {
      a.textContent = (a.textContent || '') + (b.textContent || '')
      b.remove()
      i--
    }
  }
}

function onBeforeInput(e: InputEvent) {
  if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!range.collapsed) return

    const node = range.startContainer
    const offset = range.startOffset

    if (e.inputType === 'deleteContentBackward') {
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        const prev = findPrevRealNode(node)
        if (prev && prev instanceof HTMLElement && prev.classList.contains('ps-slot')) {
          e.preventDefault()
          const zwnbsp = prev.nextSibling
          if (zwnbsp && zwnbsp.nodeType === Node.TEXT_NODE && zwnbsp.textContent === '​') zwnbsp.remove()
          prev.remove()
          mergeAdjacentText()
          return
        }
      }
    }

    if (e.inputType === 'deleteContentForward') {
      if (node.nodeType === Node.TEXT_NODE && offset === (node.textContent || '').length) {
        const next = findNextRealNode(node)
        if (next && next instanceof HTMLElement && next.classList.contains('ps-slot')) {
          e.preventDefault()
          const zwnbsp = next.nextSibling
          if (zwnbsp && zwnbsp.nodeType === Node.TEXT_NODE && zwnbsp.textContent === '​') zwnbsp.remove()
          next.remove()
          mergeAdjacentText()
          return
        }
      }
    }
  }
}

function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement

  const selectBlock = target.closest('.ps-slot--select') as HTMLElement | null
  if (selectBlock) {
    e.stopPropagation()
    closeAllDropdowns()
    showDropdown(selectBlock, syncFromDOM)
    return
  }

  const uploadBlock = target.closest('.ps-slot--upload') as HTMLElement | null
  if (uploadBlock && !target.classList.contains('ps-remove')) {
    e.stopPropagation()
    pendingUploadLabel = uploadBlock.getAttribute('data-slot-label') || ''
    fileInputRef.value?.click()
    return
  }

  if (target.classList.contains('ps-remove')) {
    e.stopPropagation()
    const block = target.closest('.ps-slot--upload') as HTMLElement | null
    if (block && surfaceRef.value) {
      const label = block.getAttribute('data-slot-label') || ''
      const slot = slots.value.find((s): s is typeof s & { type: 'upload'; value: FileItem[] } =>
        s.type === 'upload' && s.label === label,
      )
      if (slot) {
        slot.value = []
        updateUploadBlockDOM(surfaceRef.value, label, [])
        syncFromDOM()
      }
    }
    return
  }
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.ps-dropdown')) return
  const el = surfaceRef.value
  if (el && !el.contains(target)) {
    closeAllDropdowns()
  }
}

// ========== 上传 ==========

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  const slot = slots.value.find((s): s is typeof s & { type: 'upload'; value: FileItem[] } =>
    s.type === 'upload' && s.label === pendingUploadLabel,
  )
  if (slot && surfaceRef.value) {
    const newItems: FileItem[] = []
    let loaded = 0
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        newItems.push({ url: reader.result as string, name: file.name })
        loaded++
        if (loaded === files.length) {
          slot.value = [...slot.value, ...newItems]
          updateUploadBlockDOM(surfaceRef.value!, pendingUploadLabel, slot.value)
          syncFromDOM()
        }
      }
      reader.readAsDataURL(file)
    })
  }
  input.value = ''
  pendingUploadLabel = ''
}

// ========== 生命周期 ==========

onMounted(() => {
  renderSlots(slots.value)
  document.addEventListener('click', onDocumentClick)
})

watch(
  () => slots.value,
  (val) => {
    if (suppressRender) {
      suppressRender = false
      return
    }
    renderSlots(val)
  },
  { deep: true },
)
</script>

<template>
  <div
    ref="surfaceRef"
    class="prompt-editor"
    contenteditable="true"
    data-placeholder="和我聊聊，你想要什么设计～"
    @input="onInput"
    @beforeinput="onBeforeInput"
    @click="onClick"
  ></div>
  <input ref="fileInputRef" type="file" accept="image/*" multiple style="display: none" @change="onFileChange" />
</template>

<style scoped lang="less">
.prompt-editor {
  flex: 1;
  outline: none;
  font-size: 16px;
  line-height: 28px;
  color: #3a3a3a;
  word-break: break-all;
  min-height: 100px;
  max-height: 160px;
  overflow-y: auto;

  &:empty::before {
    content: attr(data-placeholder);
    color: #bfbfbf;
    pointer-events: none;
  }

  :deep(.ps-slot) {
    display: inline-flex;
    vertical-align: middle;
    align-items: center;
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 15px;
    white-space: nowrap;
    user-select: none;
    cursor: default;
    margin: 0 1px;
  }

  :deep(.ps-slot--select) {
    background: #f0ebff;
    border: 1px solid #d8b4fe;
    color: #8e66f9;
    gap: 4px;
    cursor: pointer;

    .ps-arrow {
      font-size: 10px;
      opacity: 0.7;
    }
  }

  :deep(.ps-slot--upload) {
    background: #f0ebff;
    border: 1px dashed #d8b4fe;
    color: #8e66f9;
    gap: 5px;
    cursor: pointer;

    .ps-icon {
      font-size: 14px;
    }

    &.filled {
      border-style: solid;
      background: #fff;
      color: #3a3a3a;
      gap: 6px;

      .ps-thumb {
        width: 22px;
        height: 22px;
        border-radius: 4px;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
      }

      .ps-remove {
        cursor: pointer;
        color: #bfbfbf;
        font-size: 14px;
        margin-left: 2px;

        &:hover {
          color: #f5222d;
        }
      }
    }
  }
}
</style>

<style>
.ps-dropdown {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.12);
  min-width: 148px;
  padding: 8px 4px;
  z-index: 10000;
}

.ps-dropdown-header {
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  color: #8f8f8f;
  padding: 8px 16px;
}

.ps-dropdown-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 16px;
}

.ps-dropdown-label {
  flex: 1;
}

.ps-dropdown-item {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 20px;
  color: #3a3a3a;
  cursor: pointer;
  gap: 8px;
}

.ps-dropdown-item:hover {
  background: #f5f6f8;
}

.ps-dropdown-item.active {
  background: #f5f6f8;
}

.ps-dropdown-item.active .ps-dropdown-label {
  color: #3a3a3a;
  font-weight: 400;
}

.ps-dropdown-check {
  color: #8e66f9;
  font-size: 12px;
  flex-shrink: 0;
}
</style>
