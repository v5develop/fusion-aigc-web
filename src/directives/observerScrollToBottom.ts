import type { Directive, DirectiveBinding } from 'vue'

/**
 * 触底加载指令的回调函数类型
 */
interface IBindingValue {
  callback?: () => void
  distance?: number
  onScroll?: (scrollTop: number) => void
}

/**
 * IntersectionObserver 实例挂载到元素上的类型扩展
 */
interface ObserverHTMLElement extends HTMLElement {
  _observer?: IntersectionObserver
  _scrollHandler?: () => void
}

/**
 * 监听滚动到底部的自定义指令
 */
const observerBottomDirective: Directive<ObserverHTMLElement, IBindingValue> = {
  mounted(el: ObserverHTMLElement, binding: DirectiveBinding<IBindingValue>) {
    const { callback, distance = 20, onScroll } = binding.value || {}

    // 添加滚动监听
    if (onScroll) {
      const scrollHandler = () => {
        onScroll(el.scrollTop)
      }
      el._scrollHandler = scrollHandler
      el.addEventListener('scroll', scrollHandler)
    }

    // 1. 创建底部哨兵元素（不可见）
    const observerLine = document.createElement('div')
    observerLine.style.height = '1px'
    observerLine.style.visibility = 'hidden'
    observerLine.style.margin = '0'
    el.appendChild(observerLine)

    // 2. 初始化触底监听
    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          callback?.()
        }
      },
      {
        root: el,
        rootMargin: `0px 0px ${distance}px 0px`,
        threshold: 0,
      },
    )

    // 3. 挂载 observer 到元素上，方便销毁
    el._observer = observer
    observer.observe(observerLine)
  },

  unmounted(el: ObserverHTMLElement) {
    if (el._observer) {
      el._observer.disconnect()
      delete el._observer
    }
    if (el._scrollHandler) {
      el.removeEventListener('scroll', el._scrollHandler)
      delete el._scrollHandler
    }
  },
}

export default observerBottomDirective
