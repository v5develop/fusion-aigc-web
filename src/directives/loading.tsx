import type { Directive, DirectiveBinding } from 'vue'
import { render } from 'vue'
import { NSpin } from 'naive-ui'

/**
 * 扩展元素类型，存储相关实例
 */
interface LoadingHTMLElement extends HTMLElement {
  _loadingContainer?: HTMLDivElement
}

const template = () => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgb(var(--xq-surface-rgb) / 0.3)',
        zIndex: 9999,
      }}
    >
      {/*<NSpin style={{ color: 'var(--main-color)' }} size="small" />*/}
      <NSpin stroke="var(--main-color)" size="small" />
    </div>
  )
}
const loadingDirective: Directive<LoadingHTMLElement, boolean> = {
  mounted(el: LoadingHTMLElement, binding: DirectiveBinding<boolean>) {
    // 创建容器元素
    const container = document.createElement('div')
    // 将容器挂载到元素上
    el.appendChild(container)
    el._loadingContainer = container

    // 使用 render 函数渲染 NSpin 组件到容器中
    render(template(), container)

    // 根据初始值控制显示/隐藏
    container.style.display = binding.value ? 'flex' : 'none'
  },

  updated(el: LoadingHTMLElement, binding: DirectiveBinding<boolean>) {
    // 更新时控制显示/隐藏
    if (el._loadingContainer) {
      el._loadingContainer.style.display = binding.value ? 'flex' : 'none'
    }
  },

  unmounted(el: LoadingHTMLElement) {
    // 清理容器
    if (el._loadingContainer) {
      el.removeChild(el._loadingContainer)
      el._loadingContainer = undefined
    }
  },
}

export default loadingDirective
