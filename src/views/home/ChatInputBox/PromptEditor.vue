<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import type { PromptSlot, SlotUpload, FileItem } from './types'
import { DEFAULT_UPLOAD_LIMIT } from './types'
import { buildSelectHTML, showDropdown, closeAllDropdowns } from './slots/select'
import { buildUploadHTML, updateUploadBlockDOM, type UploadIdentity } from './slots/upload'

declare global {
  interface Window {
    __psClickUpload?: (e: Event) => void
    __psRemoveUpload?: (e: Event) => void
    __psRemoveUploadItem?: (e: Event) => void
    __psPreviewShow?: (e: Event) => void
    __psPreviewHide?: () => void
  }
}

const slots = defineModel<PromptSlot[]>('slots', { required: true })

const message = useMessage()
const surfaceRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

let pendingUpload: UploadIdentity | null = null

/** 按 key 优先、label 兜底查找上传插槽（label 可能重复，key 来自模板详情接口） */
function findUploadSlot(id: UploadIdentity): SlotUpload | undefined {
  return slots.value.find(
    (s): s is SlotUpload => s.type === 'upload' && (id.key || s.key ? s.key === id.key : s.label === id.label),
  )
}

function blockIdentity(block: HTMLElement): UploadIdentity {
  return {
    key: block.getAttribute('data-slot-key') || undefined,
    label: block.getAttribute('data-slot-label') || '',
  }
}

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
      if (s.type === 'upload') return buildUploadHTML({ key: s.key, label: s.label }, s.value)
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
        const title = node.getAttribute('data-slot-title') || ''
        result.push({
          type: 'select',
          label: node.getAttribute('data-slot-label') || '',
          value: node.getAttribute('data-slot-value') || '',
          options: JSON.parse(node.getAttribute('data-slot-options') || '[]'),
          ...(title ? { title } : {}),
        })
      } else if (slotType === 'upload') {
        const id = blockIdentity(node)
        const existing = findUploadSlot(id)
        result.push({
          type: 'upload',
          key: id.key,
          label: id.label,
          value: existing ? existing.value : [],
          limit: existing?.limit ?? DEFAULT_UPLOAD_LIMIT,
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
  nextTick(() => {
    suppressRender = false
  })
}

// ========== 事件处理 ==========

function onInput() {
  // 打字必须同步回 slots 模型：提交时 slotsToPrompt 读的是模型而非 DOM，
  // 且首页默认填充依赖 slots 非空来判断「用户已输入，不覆盖」。
  // syncFromDOM 只解析不重渲（suppressRender），不影响光标与输入法组合
  syncFromDOM()
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
    // nodes 是 childNodes 快照，b 可能已被前一轮 remove() 移出 DOM，
    // 必须校验两节点在真实 DOM 中仍相邻，否则将陷入无限合并同一对节点的死循环
    if (a.nextSibling !== b) continue
    if (a.nodeType === Node.TEXT_NODE && b.nodeType === Node.TEXT_NODE) {
      a.textContent = (a.textContent || '') + (b.textContent || '')
      b.remove()
      i--
    }
  }
}

/** 计算节点在编辑器中纯文本的起始偏移量（跳过零宽空格守卫节点） */
function getTextOffsetBeforeNode(target: Node): number {
  const el = surfaceRef.value
  if (!el) return 0
  let offset = 0
  for (const child of Array.from(el.childNodes)) {
    if (child === target) return offset
    if (child.nodeType === Node.TEXT_NODE && (child.textContent || '') !== '​') {
      offset += (child.textContent || '').length
    }
  }
  return offset
}

/** 将光标恢复到编辑器纯文本中的指定偏移位置 */
function restoreCursorAtTextOffset(targetOffset: number) {
  const el = surfaceRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel) return

  let cum = 0
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent || '') !== '​') {
      const len = (child.textContent || '').length
      if (cum + len >= targetOffset) {
        const range = document.createRange()
        range.setStart(child, targetOffset - cum)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        return
      }
      cum += len
    }
  }
  // 兜底：放到编辑器末尾
  const last = el.lastChild
  if (last) {
    const range = document.createRange()
    if (last.nodeType === Node.TEXT_NODE) {
      range.setStart(last, (last.textContent || '').length)
    } else {
      range.setStartAfter(last)
    }
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
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
          // 删除前计算光标目标位置：slot 元素之前所有纯文本的长度，即被删插槽的插入点
          const targetOffset = getTextOffsetBeforeNode(prev)
          const zwnbsp = prev.nextSibling
          if (zwnbsp && zwnbsp.nodeType === Node.TEXT_NODE && zwnbsp.textContent === '​') zwnbsp.remove()
          prev.remove()
          mergeAdjacentText()
          restoreCursorAtTextOffset(targetOffset)
          return
        }
      }
    }

    if (e.inputType === 'deleteContentForward') {
      if (node.nodeType === Node.TEXT_NODE && offset === (node.textContent || '').length) {
        const next = findNextRealNode(node)
        if (next && next instanceof HTMLElement && next.classList.contains('ps-slot')) {
          e.preventDefault()
          // 光标在插槽前的文本末尾，目标偏移 = 该文本起始偏移 + 其原始长度
          const targetOffset = getTextOffsetBeforeNode(node) + (node.textContent || '').length
          const zwnbsp = next.nextSibling
          if (zwnbsp && zwnbsp.nodeType === Node.TEXT_NODE && zwnbsp.textContent === '​') zwnbsp.remove()
          next.remove()
          mergeAdjacentText()
          restoreCursorAtTextOffset(targetOffset)
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

  const id = pendingUpload
  const slot = id && findUploadSlot(id)
  if (id && slot && surfaceRef.value) {
    // 按插槽 limit（接口 maxCount）截断，超出额度时明确提示而非静默丢弃
    const limit = slot.limit ?? DEFAULT_UPLOAD_LIMIT
    const remaining = limit - slot.value.length
    if (files.length > remaining) message.warning(`最多上传 ${limit} 张图片`)
    const picked = Array.from(files).slice(0, Math.max(0, remaining))
    const newItems: FileItem[] = []
    let settled = 0
    const settle = () => {
      settled++
      if (settled !== picked.length) return
      // 只提交成功读取的文件，单个文件读取失败不拖垮整批
      if (newItems.length === 0) return
      slot.value = [...slot.value, ...newItems]
      updateUploadBlockDOM(surfaceRef.value!, id, slot.value)
      syncFromDOM()
    }
    picked.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        newItems.push({ url: reader.result as string, name: file.name })
        settle()
      }
      reader.onerror = () => {
        message.error(`「${file.name}」读取失败`)
        settle()
      }
      reader.readAsDataURL(file)
    })
  }
  input.value = ''
  pendingUpload = null
}

// ========== 生命周期 ==========

onMounted(() => {
  renderSlots(slots.value)
  document.addEventListener('click', onDocumentClick)

  // 注册全局上传回调（供 innerHTML 内联 onclick 调用）
  window.__psClickUpload = (e: Event) => {
    const target = e.target as HTMLElement
    const block = target.closest('.ps-slot--upload') as HTMLElement | null
    if (block && fileInputRef.value) {
      pendingUpload = blockIdentity(block)
      const slot = findUploadSlot(pendingUpload)
      fileInputRef.value.multiple = !slot || (slot.limit ?? DEFAULT_UPLOAD_LIMIT) > 1
      fileInputRef.value.click()
    }
  }
  window.__psRemoveUpload = (e: Event) => {
    const target = e.target as HTMLElement
    const block = target.closest('.ps-slot--upload') as HTMLElement | null
    if (block && surfaceRef.value) {
      const id = blockIdentity(block)
      const slot = findUploadSlot(id)
      if (slot) {
        slot.value = []
        updateUploadBlockDOM(surfaceRef.value, id, [])
        syncFromDOM()
      }
    }
  }
  window.__psRemoveUploadItem = (e: Event) => {
    const target = e.target as HTMLElement
    const btn = target.closest('.ps-thumb-remove') as HTMLElement | null
    const block = target.closest('.ps-slot--upload') as HTMLElement | null
    if (!btn || !block || !surfaceRef.value) return
    const idx = parseInt(btn.getAttribute('data-index') || '', 10)
    if (isNaN(idx)) return
    const id = blockIdentity(block)
    const slot = findUploadSlot(id)
    if (!slot) return
    slot.value.splice(idx, 1)
    updateUploadBlockDOM(surfaceRef.value, id, slot.value)
    syncFromDOM()
  }

  let previewEl: HTMLImageElement | null = null

  window.__psPreviewShow = (e: Event) => {
    const thumb = (e.target as HTMLElement).closest('.ps-thumb') as HTMLElement | null
    if (!thumb) return
    const srcImg = thumb.querySelector('.ps-thumb-preview-src') as HTMLImageElement | null
    if (!srcImg?.src) return

    previewEl = document.createElement('img')
    previewEl.src = srcImg.src
    previewEl.className = 'ps-thumb-preview-portal'
    const rect = thumb.getBoundingClientRect()
    previewEl.style.left = `${rect.left + rect.width / 2 - 100}px`
    previewEl.style.top = `${rect.top - 208}px`
    document.body.appendChild(previewEl)
  }

  window.__psPreviewHide = () => {
    if (previewEl) {
      previewEl.remove()
      previewEl = null
    }
  }
})

watch(
  () => slots.value,
  (val) => {
    if (suppressRender) return
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
    height: 27px;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 16px;
    white-space: nowrap;
    user-select: none;
    cursor: default;
  }

  :deep(.ps-slot--select) {
    background: #f0ebff;
    border: 1px solid #d8b4fe;
    color: #8e66f9;
    gap: 4px;
    cursor: pointer;

    .ps-arrow {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
  }

  :deep(.ps-slot--upload) {
    background: #f0ebff;
    color: rgba(142, 102, 249, 0.5);
    gap: 4px;
    cursor: pointer;

    .ps-icon {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    &.filled {
      height: 27px;
      padding: 2px 4px;
      background: #fff;
      border: 1px solid #f0f0f0;
      box-shadow: 0 1px 6px 0 rgba(0, 0, 0, 0.06);
      gap: 6px;
      border-radius: 8px;
      overflow: visible;

      .ps-thumbs {
        display: flex;
        gap: 4px;
        overflow: visible;
      }

      .ps-thumb {
        width: 20px;
        height: 20px;
        border-radius: 3px;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
        position: relative;
        overflow: visible;
      }

      .ps-thumb-preview-src {
        display: none;
      }

      .ps-thumb-remove {
        display: none;
        position: absolute;
        top: 0;
        right: 0;
        width: 14px;
        height: 14px;
        border-radius: 0 4px 0 4px;
        background: rgba(255, 255, 255, 0.85);
        color: #8f8f8f;
        font-size: 10px;
        line-height: 14px;
        text-align: center;
        cursor: pointer;
        z-index: 2;

        &:hover {
          color: #f5222d;
          background: #fff;
        }
      }

      .ps-thumb:hover .ps-thumb-remove {
        display: block;
      }

      .ps-remove {
        cursor: pointer;
        color: #bfbfbf;
        font-size: 14px;
        flex-shrink: 0;
        padding: 0 2px;

        &:hover {
          color: #f5222d;
        }
      }
    }
  }
}
</style>

<style>
.ps-thumb-preview-portal {
  position: fixed;
  width: 200px;
  height: 200px;
  object-fit: cover;
  border-radius: 12px;
  box-shadow: 0 4px 20px 0 rgba(0, 0, 0, 0.15);
  z-index: 9999;
  pointer-events: none;
}

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

.ps-dropdown-icon img {
  width: 16px;
  height: 16px;
  object-fit: contain;
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

.ps-dropdown-empty {
  height: 40px;
  display: flex;
  align-items: center;
  padding: 10px 16px;
  font-size: 14px;
  color: #bfbfbf;
  cursor: default;
}
</style>
