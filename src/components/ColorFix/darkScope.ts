/**
 * 「调色台深色作用域」：全屏调色（ColorFixFullscreen）永远是深色，与站点外观无关。
 *
 * <p>我们的 `--xq-*` 令牌按 DOM 祖先的 `[data-theme]` 取值，而 naive 的 n-modal / n-dropdown / n-popover 等
 * 会把内容 teleport 到 `<body>`，脱离全屏根节点的 `data-theme="dark"` 子树，令牌就回落成浅色。
 * naive 自己的主题走 inject（组件树，不受 teleport 影响），所以 naive 部件是深色、我们的自定义内容却是浅色——混色。
 *
 * <p>机制：全屏层 {@link provideColorFixTheme}('dark')；组件树里任何后代（包括嵌套弹窗）用 {@link useColorFixTheme}
 * 取到 'dark'，在自己 teleport 出去的根节点上写 `:data-theme="scope ?? undefined"`。
 * 不在全屏里 = null = 不写属性，照常跟站点外观走。naive 部件的深色主题已由全屏根 div 内的
 * n-config-provider 经组件树继承（嵌套弹窗同样在那棵树下），不需要再包一层 provider。
 *
 * <p>n-modal 只认第一个子节点做显隐：data-theme 只能写在这个根 div 上，不能在 n-modal 外再包组件。
 */
import { inject, provide, type InjectionKey } from 'vue'

export type ColorFixThemeScope = 'dark'

const KEY: InjectionKey<ColorFixThemeScope> = Symbol('colorfix-theme-scope')

/** 在全屏调色层的 setup 里调用 */
export function provideColorFixTheme(theme: ColorFixThemeScope) {
  provide(KEY, theme)
}

/** 'dark' = 处在全屏调色里（teleport 出去的根节点要自己带 data-theme）；null = 跟站点外观 */
export function useColorFixTheme(): ColorFixThemeScope | null {
  return inject(KEY, null)
}
