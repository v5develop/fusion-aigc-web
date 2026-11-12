/**
 * 路由转场（原型 components/motion/useRouteStagger.ts）：只在 AI 图片 / AI 视频 / 工具页之间切换时生效。
 *
 * - 新页淡入 260ms（延后 40ms）、旧页右移 14px 淡出 160ms；
 * - 分栏（selector 命中的子元素）三拍错峰从左推入：延后 30 / 200 / 500ms，时长 300 / 360 / 300ms，总长约 0.8s；
 * - prefers-reduced-motion 下整体关闭（name 换成不存在的 class、css=false、时长 0），别处的路由切换也不做任何过渡。
 *
 * 用法（views/layout/index.vue）：原生 `<transition>` 必须直接包路由内容，不要再套 slot 包装组件。
 */
import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import './route-stagger.css'

export interface RouteStaggerOptions {
  /** 要错峰的分栏选择器；空 = 只做整页淡入 */
  selector?: string
  enterDuration?: number
  leaveDuration?: number
  staggerDelays?: number[]
  staggerDurations?: number[]
}

/** 系统「减少动效」偏好（响应式；不支持 matchMedia 时按「不减少」） */
export function useReducedMotion() {
  const reduced = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return reduced
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = mql.matches
  const onChange = (e: MediaQueryListEvent) => (reduced.value = e.matches)
  mql.addEventListener('change', onChange)
  onBeforeUnmount(() => mql.removeEventListener('change', onChange))
  return reduced
}

export function useRouteStagger(active: Ref<boolean> | ComputedRef<boolean>, options: RouteStaggerOptions = {}) {
  const reduced = useReducedMotion()
  const selector = options.selector ?? ''
  const enterDuration = options.enterDuration ?? 840
  const leaveDuration = options.leaveDuration ?? 180
  const delays = options.staggerDelays ?? [30, 200, 500]
  const durations = options.staggerDurations ?? [300, 360, 300]
  const animate = computed(() => active.value && !reduced.value)
  const name = computed(() => (animate.value ? 'motion-route' : 'motion-route-none'))
  const css = computed(() => animate.value)
  const duration = computed(() => (animate.value ? { enter: enterDuration, leave: leaveDuration } : { enter: 0, leave: 0 }))

  const clear = (el: Element) => {
    el.querySelectorAll<HTMLElement>('.motion-stagger-col').forEach((col) => {
      col.classList.remove('motion-stagger-col')
      col.style.removeProperty('--motion-col-duration')
      col.style.removeProperty('--motion-col-delay')
    })
  }

  const apply = (el: Element, tries = 0) => {
    if (!animate.value || !selector || !el.isConnected) return
    const columns = [...el.querySelectorAll<HTMLElement>(selector)]
    if (!columns.length) {
      // 懒加载页面在 enter 钩子之后才挂好 DOM：再等几帧找
      if (tries < 20) requestAnimationFrame(() => apply(el, tries + 1))
      return
    }
    columns.forEach((col, i) => {
      col.style.setProperty('--motion-col-duration', `${durations[i] ?? durations.at(-1) ?? 300}ms`)
      col.style.setProperty('--motion-col-delay', `${delays[i] ?? delays.at(-1) ?? 0}ms`)
      col.classList.add('motion-stagger-col')
    })
  }

  const onEnter = (el: Element) => {
    if (!animate.value || !selector) return
    requestAnimationFrame(() => apply(el))
  }

  return { name, css, duration, onEnter, onAfter: clear }
}
