import type { SlotSelect } from '../types'
import { ICON_CARET_DOWN } from './icons'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/** 构建选择块 innerHTML */
export function buildSelectHTML(s: SlotSelect): string {
  // 先 escapeHtml 处理 & < >，再转义引号，保证 getAttribute 反解回原始 JSON
  const opts = escapeHtml(JSON.stringify(s.options)).replace(/"/g, '&quot;')
  const title = s.title || ''
  return `<span class="ps-slot ps-slot--select" contenteditable="false"
    data-slot-type="select" data-slot-label="${escapeHtml(s.label)}"
    data-slot-value="${escapeHtml(s.value)}" data-slot-options="${opts}" data-slot-title="${escapeHtml(title)}">${escapeHtml(s.label)}<span class="ps-arrow">${ICON_CARET_DOWN}</span></span>​`
}

/** 弹出下拉面板，挂载到 body */
export function showDropdown(anchor: HTMLElement, onSelect: () => void) {
  const raw = anchor.getAttribute('data-slot-options') || '[]'
  const options: { label: string; value: string; icon?: string }[] = JSON.parse(raw)
  const currentValue = anchor.getAttribute('data-slot-value') || ''
  const title = anchor.getAttribute('data-slot-title') || ''

  const rect = anchor.getBoundingClientRect()

  let headerHtml = ''
  if (title) {
    headerHtml = `<div class="ps-dropdown-header">${escapeHtml(title)}</div>`
  }

  const dd = document.createElement('div')
  dd.className = 'ps-dropdown'
  dd.style.position = 'fixed'
  dd.style.top = rect.bottom + 4 + 'px'
  dd.style.left = rect.left + 'px'
  // options 为空（后端暂未配置选项）时展示空态
  const bodyHtml = options.length === 0
    ? `<div class="ps-dropdown-empty">暂无可选项</div>`
    : options
      .map((opt) => {
        // icon 仅支持图片 URL；options 来自接口，内联 SVG/HTML 字符串一律不渲染，防注入
        const isIconUrl = !!opt.icon && !opt.icon.trimStart().startsWith('<')
        const iconHtml = isIconUrl
          ? `<span class="ps-dropdown-icon"><img src="${escapeHtml(opt.icon!)}" alt="" /></span>`
          : ''
        return `<div class="ps-dropdown-item${opt.value === currentValue ? ' active' : ''}" data-value="${escapeHtml(opt.value)}">
          ${iconHtml}<span class="ps-dropdown-label">${escapeHtml(opt.label)}</span>
          ${opt.value === currentValue ? '<span class="ps-dropdown-check">✓</span>' : ''}
        </div>`
      })
      .join('')

  dd.innerHTML = headerHtml + bodyHtml

  document.body.appendChild(dd)

  dd.querySelectorAll('.ps-dropdown-item').forEach((item) => {
    item.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const el = item as HTMLElement
      const newValue = el.getAttribute('data-value') || ''
      const newLabel = (el.querySelector('.ps-dropdown-label')?.textContent || '').trim()

      anchor.setAttribute('data-slot-value', newValue)
      anchor.setAttribute('data-slot-label', newLabel)
      anchor.innerHTML = `${escapeHtml(newLabel)}<span class="ps-arrow">${ICON_CARET_DOWN}</span>`

      dd.remove()
      onSelect()
    })
  })
}

/** 关闭所有下拉面板 */
export function closeAllDropdowns() {
  document.querySelectorAll('.ps-dropdown').forEach((d) => d.remove())
}
