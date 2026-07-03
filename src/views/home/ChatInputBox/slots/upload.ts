import type { FileItem } from '../types'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/** 构建上传块 innerHTML */
export function buildUploadHTML(label: string, value: FileItem[]): string {
  if (value.length > 0 && value[0]) {
    const src = value[0].thumbnail || value[0].url || ''
    const countText = value.length > 1 ? ` 等${value.length}张` : ''
    return `<span class="ps-slot ps-slot--upload filled" contenteditable="false"
      data-slot-type="upload" data-slot-label="${escapeHtml(label)}"><span class="ps-thumb" style="background-image:url('${escapeHtml(src)}')"></span><span class="ps-fname">${label}${countText}</span><span class="ps-remove">×</span></span>​`
  }
  return `<span class="ps-slot ps-slot--upload" contenteditable="false"
    data-slot-type="upload" data-slot-label="${escapeHtml(label)}"><span class="ps-icon">📷</span> ${escapeHtml(label)}</span>​`
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
