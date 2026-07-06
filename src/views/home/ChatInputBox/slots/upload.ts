import type { FileItem } from '../types'
import { ICON_UPLOAD } from './icons'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/** 构建上传块 innerHTML */
export function buildUploadHTML(label: string, value: FileItem[]): string {
  if (value.length > 0 && value[0]) {
    const imgs = value
      .map((item) => {
        const src = item.thumbnail || item.url || ''
        return `<span class="ps-thumb" style="background-image:url('${escapeHtml(src)}')"></span>`
      })
      .join('')
    const countBadge = value.length > 1 ? `<span class="ps-count">${value.length}</span>` : ''
    return `<span class="ps-slot ps-slot--upload filled" contenteditable="false"
      data-slot-type="upload" data-slot-label="${escapeHtml(label)}"
      onclick="event.stopPropagation();window.__psClickUpload?.(event)"><span class="ps-thumbs">${imgs}${countBadge}</span><span class="ps-remove" onclick="event.stopPropagation();window.__psRemoveUpload?.(event)">×</span></span>​`
  }
  return `<span class="ps-slot ps-slot--upload" contenteditable="false"
    data-slot-type="upload" data-slot-label="${escapeHtml(label)}"
    onclick="event.stopPropagation();window.__psClickUpload?.(event)"><span class="ps-icon">${ICON_UPLOAD}</span>${escapeHtml(label)}</span>​`
}

/** 局部更新上传块 DOM（替换 outerHTML） */
export function updateUploadBlockDOM(surfaceEl: HTMLElement, label: string, value: FileItem[]) {
  const blocks = surfaceEl.querySelectorAll<HTMLElement>('[data-slot-type="upload"]')
  blocks.forEach((block) => {
    if (block.getAttribute('data-slot-label') === label) {
      block.outerHTML = buildUploadHTML(label, value)
    }
  })
}
