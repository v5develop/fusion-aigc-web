import type { FileItem } from '../types'
import { ICON_UPLOAD } from './icons'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/** 上传块标识：优先按模板插槽 key 匹配（label 可能重复），无 key 的旧数据回退 label */
export interface UploadIdentity {
  key?: string
  label: string
}

/** 判断上传块 DOM 是否对应指定插槽 */
export function matchUploadBlock(block: HTMLElement, id: UploadIdentity): boolean {
  const blockKey = block.getAttribute('data-slot-key') || ''
  if (id.key || blockKey) return blockKey === (id.key || '')
  return block.getAttribute('data-slot-label') === id.label
}

/** 构建上传块 innerHTML */
export function buildUploadHTML(id: UploadIdentity, value: FileItem[]): string {
  const idAttrs = `data-slot-type="upload" data-slot-key="${escapeHtml(id.key || '')}" data-slot-label="${escapeHtml(id.label)}"`
  if (value.length > 0 && value[0]) {
    const imgs = value
      .map((item, idx) => {
        const src = item.thumbnail || item.url || ''
        const full = item.url || src
        return `<span class="ps-thumb" style="background-image:url('${escapeHtml(src)}')" onmouseenter="window.__psPreviewShow?.(event)" onmouseleave="window.__psPreviewHide?.()"><img class="ps-thumb-preview-src" src="${escapeHtml(full)}" /><span class="ps-thumb-remove" data-index="${idx}" onclick="event.stopPropagation();window.__psRemoveUploadItem?.(event)">×</span></span>`
      })
      .join('')
    return `<span class="ps-slot ps-slot--upload filled" contenteditable="false"
      ${idAttrs}
      onclick="event.stopPropagation();window.__psClickUpload?.(event)"><span class="ps-thumbs">${imgs}</span><span class="ps-remove" onclick="event.stopPropagation();window.__psRemoveUpload?.(event)">×</span></span>​`
  }
  return `<span class="ps-slot ps-slot--upload" contenteditable="false"
    ${idAttrs}
    onclick="event.stopPropagation();window.__psClickUpload?.(event)"><span class="ps-icon">${ICON_UPLOAD}</span>${escapeHtml(id.label)}</span>​`
}

/** 局部更新上传块 DOM（替换 outerHTML） */
export function updateUploadBlockDOM(surfaceEl: HTMLElement, id: UploadIdentity, value: FileItem[]) {
  const blocks = surfaceEl.querySelectorAll<HTMLElement>('[data-slot-type="upload"]')
  blocks.forEach((block) => {
    if (matchUploadBlock(block, id)) {
      block.outerHTML = buildUploadHTML(id, value)
    }
  })
}
