import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 历史卡操作行自适应：行宽放不下「前导（时间 / 状态）+ 全部操作钮」时返回 collapsed=true，
 * 调用方据此把次要操作收进「更多」菜单（保留下载）。
 *
 * - 行元素（rowRef）里带 `data-fit-lead` 的是前导区（flex-1，会随行变宽），`data-fit-lead-content` 是前导内容本身
 *   （flex-none，宽度 = 内容固有宽度），`data-fit-actions` 是操作钮容器；
 * - 比较用前导内容的固有宽度：量 flex-1 的前导区会把空出来的地方也算进去，折叠后行再变宽也展不开；
 * - 展开态时按实际宽度记下操作区宽度，折叠后用它比较（避免来回抖动）；挂载时总是先按展开态量一次，
 *   所以两颗钮的行不会因为估值偏大而一上来就折叠。
 */
export function useFitActions(rowRef: Ref<HTMLElement | null | undefined>, gap = 6) {
  const collapsed = ref(false)
  /** 展开态操作区宽度；量到之前按 3 颗 sm 钮（24×3 + 8×2）估 */
  let expandedActions = 88
  let ro: ResizeObserver | null = null

  function measure() {
    const row = rowRef.value
    if (!row) return
    const content = row.querySelector<HTMLElement>('[data-fit-lead-content]')
    const lead = row.querySelector<HTMLElement>('[data-fit-lead]')
    const actions = row.querySelector<HTMLElement>('[data-fit-actions]')
    if (!actions) return
    if (!collapsed.value && actions.offsetWidth > 0) expandedActions = actions.offsetWidth
    const leadWidth = content
      ? content.offsetWidth
      : ((lead?.firstElementChild as HTMLElement | null)?.scrollWidth ?? 0)
    const need = leadWidth + gap + expandedActions
    collapsed.value = row.clientWidth > 0 && row.clientWidth < need
  }

  onMounted(() => {
    measure()
    if (typeof ResizeObserver === 'undefined' || !rowRef.value) return
    ro = new ResizeObserver(measure)
    ro.observe(rowRef.value)
  })
  onBeforeUnmount(() => ro?.disconnect())

  return { collapsed, measure }
}
