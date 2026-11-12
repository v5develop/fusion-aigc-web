/**
 * 校色滑杆的精调（所有校色界面共用，只有显式加了指令的才生效）：
 * - vCfFine 挂在原生 range 上：Shift+方向键 ±shiftStepOf（普通方向键沿用原生 ±step），到边界停住；
 * - vCfValueEdit 挂在数值文字上：点一下变成小输入框，回车 / 失焦提交，Esc 取消，夹到该行滑杆的区间；
 *   数值通过「改 range 的 value 并派发 input」回写，原有 @input 处理函数无需改动。
 * ColorFixSlider 用自己的 editable 属性实现同一套交互。
 */
import type { Directive } from 'vue'

/** Shift+方向键的步长：约全程的 1/10，吸到 5 或 10——区间跨度 < 100 用 5，≥ 100 用 10 */
export function shiftStepOf(min: number, max: number): number {
  return max - min >= 100 ? 10 : 5
}

function setRange(range: HTMLInputElement, n: number) {
  const min = Number(range.min || 0)
  const max = Number(range.max || 100)
  const next = Math.min(max, Math.max(min, Math.round(n)))
  if (String(next) === range.value) return
  range.value = String(next)
  range.dispatchEvent(new Event('input', { bubbles: true }))
}

function onKey(event: KeyboardEvent) {
  if (!event.shiftKey) return
  const dir = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
  if (!dir) return
  event.preventDefault()
  const range = event.currentTarget as HTMLInputElement
  const override = (range as HTMLInputElement & { _cfShift?: number })._cfShift
  const step = override ?? shiftStepOf(Number(range.min || 0), Number(range.max || 100))
  setRange(range, Number(range.value) + dir * step)
}

export const vCfFine: Directive<HTMLInputElement> = {
  /** 可传数字显式覆盖步长：v-cf-fine="5" */
  mounted(el, binding) {
    if (typeof binding.value === 'number') (el as HTMLInputElement & { _cfShift?: number })._cfShift = binding.value
    el.addEventListener('keydown', onKey)
  },
  beforeUnmount(el) {
    el.removeEventListener('keydown', onKey)
  },
}

function findRange(el: HTMLElement): HTMLInputElement | null {
  return (el.parentElement?.querySelector('input[type="range"]') as HTMLInputElement | null) ?? null
}

function startEdit(event: Event) {
  const el = event.currentTarget as HTMLElement
  const range = findRange(el)
  if (!range || el.style.display === 'none') return
  event.preventDefault() // 值在 <label> 里时，不让点击把焦点转给 range
  const box = document.createElement('input')
  box.type = 'text'
  box.inputMode = 'numeric'
  box.value = range.value
  box.setAttribute('aria-label', `输入数值（${range.min} 到 ${range.max}）`)
  Object.assign(box.style, {
    width: '40px',
    boxSizing: 'border-box',
    padding: '0 4px',
    border: '1px solid var(--xq-violet)',
    borderRadius: '6px',
    background: 'var(--xq-surface)',
    color: 'var(--xq-ink)',
    font: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
    lineHeight: '16px',
    marginLeft: getComputedStyle(el).marginLeft,
  })
  let done = false
  const finish = (commit: boolean) => {
    if (done) return
    done = true
    const text = box.value.trim()
    const n = Number(text)
    box.remove()
    el.style.display = ''
    if (commit && text !== '' && Number.isFinite(n)) setRange(range, n)
  }
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }
  })
  box.addEventListener('blur', () => finish(true))
  box.addEventListener('click', (e) => e.stopPropagation())
  el.style.display = 'none'
  el.after(box)
  box.focus()
  box.select()
}

export const vCfValueEdit: Directive<HTMLElement> = {
  mounted(el) {
    el.style.cursor = 'text'
    el.title = '点击输入数值'
    el.addEventListener('click', startEdit)
  },
  beforeUnmount(el) {
    el.removeEventListener('click', startEdit)
  },
}
