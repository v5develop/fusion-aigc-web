import type { Directive, DirectiveBinding } from 'vue'

interface IBindingValue {
  /** 到达底部时触发 */
  callback?: () => void
  /** 距离底部多少 px 时提前触发（默认 20） */
  distance?: number
  /** 到达顶部时触发 */
  callbackTop?: () => void
  /** 距离顶部多少 px 时提前触发（默认 200） */
  distanceTop?: number
  /** 滚动事件回调 */
  onScroll?: (scrollTop: number) => void
}

interface ObserverHTMLElement extends HTMLElement {
  _observer?: IntersectionObserver
  _scrollHandler?: () => void
  _topTriggered?: boolean
}

/** 创建不可见的 1px 哨兵元素 */
function createSentinel(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'height:1px;visibility:hidden;margin:0'
  return el
}

/**
 * 监听滚动到底部/顶部的自定义指令
 *
 * 底部用 IntersectionObserver（适合无限滚动）
 * 顶部用 scroll 事件 + 防重复触发（模仿豆包/ChatGPT 的做法）
 */
const observerScrollDirective: Directive<ObserverHTMLElement, IBindingValue> = {
  mounted(el: ObserverHTMLElement, binding: DirectiveBinding<IBindingValue>) {
    const { callback, distance = 20, callbackTop, distanceTop = 200, onScroll } = binding.value || {}

    // ==================== 底部检测（IntersectionObserver） ====================
    if (callback) {
      const sentinel = createSentinel()
      el.appendChild(sentinel)

      el._observer = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]) => {
          if (entries[0]?.isIntersecting) callback()
        },
        {
          root: el,
          rootMargin: `0px 0px ${distance}px 0px`,
          threshold: 0,
        },
      )
      el._observer.observe(sentinel)
    }

    // ==================== 顶部检测（scroll 事件） ====================
    // 用 scroll 事件而非 IntersectionObserver，因为：
    // 1. 阈值设小了用户看到 loading，设大了可能漏触发
    // 2. 防重复触发：加载新内容后 scrollTop 被推高，自动解除触发状态
    // 3. 快速拖动也能捕获（scroll 事件持续触发）
    const scrollHandler = () => {
      const { scrollTop } = el
      onScroll?.(scrollTop)

      if (!callbackTop) return

      if (scrollTop <= distanceTop) {
        if (!el._topTriggered) {
          el._topTriggered = true
          callbackTop()
        }
      } else {
        // 用户滚回下方后重置，允许再次触发
        el._topTriggered = false
      }
    }

    el._scrollHandler = scrollHandler
    el.addEventListener('scroll', scrollHandler, { passive: true })
  },

  unmounted(el: ObserverHTMLElement) {
    el._observer?.disconnect()
    delete el._observer
    if (el._scrollHandler) {
      el.removeEventListener('scroll', el._scrollHandler)
      delete el._scrollHandler
    }
    delete el._topTriggered
  },
}

export default observerScrollDirective
